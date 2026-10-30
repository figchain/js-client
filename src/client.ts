
import { Config, ConfigOptions, BootstrapStrategy as BootstrapStrategyEnum } from './config';
import { Transport, isTransitFailure } from './transport';
import { Store } from './store';
import { Evaluator, Context } from './evaluation';
import { EncryptionService } from './encryption/service';
import { PrivateKeyTokenProvider, SharedSecretTokenProvider, TokenProvider } from './auth';
import { BootstrapStrategy, ServerStrategy, S3BackupStrategyImpl, FallbackStrategy, HybridStrategy } from './bootstrap/strategies';
import { S3BackupService } from './bootstrap/s3';
import { FigFamily, UpdateFetchResponse } from './models';
import * as avsc from 'avsc';
import { loadX25519PrivateKey } from './crypto';

/** How long the server may hold an update request open; under common proxy idle timeouts (often 60s). */
const LONG_POLL_WAIT_SECONDS = 30;
/** Consecutive in-transit failures in long-poll mode before a namespace falls back to polling. */
const LONG_POLL_FALLBACK_AFTER = 3;

export class FigChainClient {
  private config: Config;
  private transport: Transport;
  private longPollingTransport?: Transport;
  private store: Store;
  private evaluator: Evaluator;
  private encryptionService?: EncryptionService;
  private schemas: Map<string, avsc.Type> = new Map();
  private namespaceCursors: Map<string, string> = new Map();
  private pollerTimeouts = new Set<NodeJS.Timeout>();
  private isShutdown: boolean = false;
  private listeners: Map<string, ((val: unknown) => void)[]> = new Map();

  constructor(options?: ConfigOptions) {
    this.config = new Config(options); // Base config
    this.store = new Store();
    this.evaluator = new Evaluator();

    // Transport
    let tokenProvider: TokenProvider;
    if (this.config.authPrivateKey) {
        // Private Key Auth
        const serviceAccountId = this.config.authClientId || this.config.authCredentialId || this.config.environmentId;
        if (!serviceAccountId) {throw new Error("Service Account ID (clientId/credentialId/environmentId) required for Private Key Auth");}

        tokenProvider = new PrivateKeyTokenProvider(
            this.config.authPrivateKey,
            serviceAccountId,
            this.config.authCredentialId,
            this.config.tenantId,
            this.config.namespaces.size === 1 ? Array.from(this.config.namespaces)[0] : undefined
        );
    } else if (this.config.clientSecret) {
        tokenProvider = new SharedSecretTokenProvider(this.config.clientSecret);
    } else {
        throw new Error("Client Secret or Auth Private Key required");
    }

    if (!this.config.environmentId) {throw new Error("Environment ID is required");}

    this.transport = new Transport(
        this.config.baseUrl,
        tokenProvider,
        this.config.environmentId
    );

    // Long polling transport (if configured)
    if (this.config.longPollingBaseUrl) {
        this.longPollingTransport = new Transport(
            this.config.longPollingBaseUrl,
            tokenProvider,
            this.config.environmentId
        );
    }

    // Encryption
    if (this.config.encryptionPrivateKey) {
        const privKey = loadX25519PrivateKey(this.config.encryptionPrivateKey);
        let s3Service: S3BackupService | undefined;
        if (this.config.s3BackupEnabled) {
            s3Service = new S3BackupService(this.config);
        }
        this.encryptionService = new EncryptionService(this.transport, privKey, s3Service);
    }
  }

  static async create(configPath?: string, options?: ConfigOptions): Promise<FigChainClient> {
    const config = Config.load(configPath, options);
    const client = new FigChainClient(config);
    await client.init();
    return client;
  }

  async init() {
    // Bootstrap
    let strategy: BootstrapStrategy;
    const serverStrategy = new ServerStrategy(this.transport, this.config.asOf);

    if (this.config.s3BackupEnabled) {
        const s3Service = new S3BackupService(this.config);
        const s3Strategy = new S3BackupStrategyImpl(s3Service);

        switch (this.config.bootstrapStrategy) {
            case BootstrapStrategyEnum.S3_BACKUP_ONLY:
                strategy = s3Strategy;
                break;
            case BootstrapStrategyEnum.HYBRID:
                strategy = new HybridStrategy(s3Strategy, serverStrategy, this.transport);
                break;
            case BootstrapStrategyEnum.SERVER:
                strategy = serverStrategy;
                break;
            default:
                strategy = new FallbackStrategy(serverStrategy, s3Strategy);
        }
    } else {
        strategy = serverStrategy;
    }

    const namespaces = Array.from(this.config.namespaces);
    if (namespaces.length === 0) {
        console.warn("No namespaces configured");
    }

    const res = await strategy.bootstrap(namespaces);
    this.store.putAll(res.figFamilies);
    for (const [k, v] of Object.entries(res.cursors)) {
        this.namespaceCursors.set(k, v);
    }

    // Register Schemas
    for (const [uri, schemaStr] of Object.entries(res.schemas)) {
        try {
            this.registerSchema(uri, schemaStr);
        } catch (e) {
            console.warn(`Failed to register schema ${uri}:`, e);
        }
    }

    // Start Polling
    this.poll();
  }

  /** Starts one poller per namespace so a quiet namespace's long poll never delays another's updates. */
  private poll() {
    for (const ns of this.config.namespaces) {
      this.pollNamespace(ns);
    }
  }

  /**
   * Single update loop for both transports. Long polling and plain polling
   * differ only in how long the server may hold the request (LONG_POLL_WAIT_SECONDS
   * vs 0) and how long we pause before the next request (0 vs pollInterval).
   */
  private pollNamespace(ns: string) {
    const pollTransport = this.longPollingTransport ?? this.transport;
    let longPoll = this.config.useLongPolling;
    let transitFailures = 0;

    const next = (delayMs: number) => {
      if (this.isShutdown) {return;}
      const timer = setTimeout(() => { this.pollerTimeouts.delete(timer); void once(); }, delayMs);
      this.pollerTimeouts.add(timer);
    };

    const once = async () => {
      if (this.isShutdown) {return;}
      let pauseMs = this.config.pollInterval * 1000;
      try {
        const resp = await pollTransport.fetchUpdates(
          ns,
          this.namespaceCursors.get(ns) || "",
          longPoll ? LONG_POLL_WAIT_SECONDS : 0
        );
        transitFailures = 0;
        this.applyUpdate(ns, resp);
        if (longPoll) {pauseMs = 0;} // the server already waited; reconnect now
      } catch (e) {
        console.warn(`Poll failed for ${ns}:`, e);
        if (longPoll && isTransitFailure(e) && ++transitFailures >= LONG_POLL_FALLBACK_AFTER) {
          console.warn(`Long polling for ${ns} failed ${transitFailures} times in transit; ` +
            `falling back to polling every ${this.config.pollInterval}s`);
          longPoll = false;
        }
      }
      next(pauseMs);
    };

    void once();
  }

  private applyUpdate(ns: string, resp: UpdateFetchResponse) {
    if (resp.cursor) {
      this.namespaceCursors.set(ns, resp.cursor);
    }
    if (resp.schemas) {
      for (const [uri, schemaStr] of Object.entries(resp.schemas)) {
        this.registerSchema(uri, schemaStr);
      }
    }
    if (resp.figFamilies && resp.figFamilies.length > 0) {
      this.store.putAll(resp.figFamilies);
      void this.notifyListeners(resp.figFamilies);
    }
  }

  private registerSchema(uri: string, schemaStr: string) {
      try {
          const type = avsc.Type.forSchema(JSON.parse(schemaStr) as avsc.Schema);
          this.schemas.set(uri, type);
      } catch (e) {
          console.warn(`Invalid schema for ${uri}:`, e);
      }
  }

    async getFig<T = unknown>(
        key: string,
        context: Context = {},
        namespace?: string,
        defaultValue?: T
    ): Promise<T | undefined> {
        let family: FigFamily | undefined;

        if (!namespace) {
            if (this.config.namespaces.size === 1) {
                namespace = Array.from(this.config.namespaces)[0];
            } else {
               // Find in any namespace
              const found = this.store.findFigFamily(key);
              if (found) {
                  family = found;
                  namespace = family.definition.namespace;
              }
            }
        }

        // If namespace determined (or explicitly passed), look it up directly if we didn't just find it
        if (namespace && !family) {
            family = this.store.getFigFamily(namespace, key);
        }
      if (!family) {return defaultValue;}

      const fig = this.evaluator.evaluate(family, context);
      if (!fig) {return defaultValue;}

      try {
          let payload = fig.payload;
          if (fig.isEncrypted) {
              if (!this.encryptionService) {
                  console.error(`Fig ${key} is encrypted but no encryption service configured`);
                  return defaultValue;
              }
              payload = await this.encryptionService.decrypt(fig, family.definition.namespace);
          }

          // Deserialize
          // Format: Avro Binary
          // Schema URI: family.definition.schemaUri
          const schemaUri = family.definition.schemaUri;
          let type = this.schemas.get(schemaUri);

          if (!type) {
              // Fetch on demand
              console.warn(`Schema ${schemaUri} not found, fetching...`);
              try {
                  // Parse URI to get name/version
                  // tag:figchain.io,2025:namespace:name:version
                  const parts = schemaUri.split(':');
                  if (parts.length >= 5) {
                      const ns = parts[2];
                      const name = parts[3];
                      const ver = parseInt(parts[4], 10);
                      const schemaStr = await this.transport.fetchSchema(ns, name, ver);
                      this.registerSchema(schemaUri, schemaStr);
                      type = this.schemas.get(schemaUri);
                  }
              } catch (e) {
                  console.error(`Failed to fetch schema ${schemaUri}`, e);
              }
          }

          if (!type) {
            console.error(`Schema ${schemaUri} missing for ${key}`);
            return defaultValue;
          }

          // Payload is Buffer (if not string).
          const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'base64');
          return type.fromBuffer(buf) as T;

      } catch (e) {
          console.error(`Failed to process fig ${key}`, e);
          return defaultValue;
      }
  }

  on(key: string, callback: (val: unknown) => void) {
      if (!this.listeners.has(key)) {
          this.listeners.set(key, []);
      }
      this.listeners.get(key)!.push(callback);
  }

  private async notifyListeners(families: FigFamily[]) {
      for (const family of families) {
          const key = family.definition.key;
          if (this.listeners.has(key)) {
              // Evaluate with empty context
              const val = await this.getFig(key, {}, family.definition.namespace);
              this.listeners.get(key)!.forEach(cb => cb(val));
          }
      }
  }

  close() {
      this.isShutdown = true;
      for (const timer of this.pollerTimeouts) {clearTimeout(timer);}
      this.pollerTimeouts.clear();
  }
}
