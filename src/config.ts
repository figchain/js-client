
import fs from 'fs';

export enum BootstrapStrategy {
  SERVER = "server",
  SERVER_FIRST = "server-first",
  S3_BACKUP_ONLY = "s3-backup-only",
  HYBRID = "hybrid"
}

export interface ConfigOptions {
  baseUrl?: string;
  longPollingBaseUrl?: string;
  clientSecret?: string;
  environmentId?: string;
  namespaces?: string | string[] | Set<string>;
  asOf?: string;
  pollInterval?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  bootstrapStrategy?: BootstrapStrategy;
  tenantId?: string;
  useLongPolling?: boolean;

  // S3 Backup
  s3BackupEnabled?: boolean;
  s3BackupBucket?: string;
  s3BackupPrefix?: string;
  s3BackupRegion?: string;
  s3BackupEndpoint?: string;
  s3BackupPathStyleAccess?: boolean;

  // Encryption/Auth
  encryptionPrivateKey?: string; // Hex
  authPrivateKey?: string; // Hex
  authClientId?: string;
  authCredentialId?: string;
}

export class Config implements ConfigOptions {
  baseUrl: string = "https://app.figchain.io/api/";
  longPollingBaseUrl?: string;
  clientSecret?: string;
  environmentId?: string;
  namespaces: Set<string> = new Set();
  asOf?: string;
  pollInterval: number = 60;
  maxRetries: number = 3;
  retryDelayMs: number = 1000;
  bootstrapStrategy: BootstrapStrategy = BootstrapStrategy.SERVER_FIRST;
  tenantId: string = "default";
  useLongPolling: boolean = true;

  s3BackupEnabled: boolean = false;
  s3BackupBucket?: string;
  s3BackupPrefix: string = "";
  s3BackupRegion: string = "us-east-1";
  s3BackupEndpoint?: string;
  s3BackupPathStyleAccess: boolean = false;

  encryptionPrivateKey?: string;
  authPrivateKey?: string;
  authClientId?: string;
  authCredentialId?: string;

  constructor(options: ConfigOptions = {}) {
    Object.assign(this, options);
    // Normalize namespaces to Set<string>
    if (options.namespaces) {
      this.namespaces = this.normalizeNamespaces(options.namespaces);
    }
  }

  private normalizeNamespaces(input: string | string[] | Set<string>): Set<string> {
    if (input instanceof Set) {
      return input;
    }
    if (typeof input === 'string') {
      return new Set([input]);
    }
    return new Set(input);
  }

  static load(filePath?: string, overrides: ConfigOptions = {}): Config {
    const config = new Config();
    const configData: Record<string, unknown> = {};

    // 1. Load from file
    if (filePath) {
      Object.assign(configData, this.loadFromFile(filePath));
    } else {
      if (fs.existsSync("figchain.json")) {
        Object.assign(configData, this.loadFromFile("figchain.json"));
      }
    }

    // 2. Load from Environment
    const envMap: Record<string, keyof ConfigOptions> = {
      "FIGCHAIN_URL": "baseUrl",
      "FIGCHAIN_LONG_POLLING_URL": "longPollingBaseUrl",
      "FIGCHAIN_CLIENT_SECRET": "clientSecret",
      "FIGCHAIN_ENVIRONMENT_ID": "environmentId",
      "FIGCHAIN_POLLING_INTERVAL_MS": "pollInterval",
      "FIGCHAIN_MAX_RETRIES": "maxRetries",
      "FIGCHAIN_RETRY_DELAY_MS": "retryDelayMs",
      "FIGCHAIN_AS_OF_TIMESTAMP": "asOf",
      "FIGCHAIN_USE_LONG_POLLING": "useLongPolling",
      "FIGCHAIN_S3_BACKUP_ENABLED": "s3BackupEnabled",
      "FIGCHAIN_S3_BACKUP_BUCKET": "s3BackupBucket",
      "FIGCHAIN_S3_BACKUP_PREFIX": "s3BackupPrefix",
      "FIGCHAIN_S3_BACKUP_REGION": "s3BackupRegion",
      "FIGCHAIN_S3_BACKUP_ENDPOINT": "s3BackupEndpoint",
      "FIGCHAIN_S3_BACKUP_PATH_STYLE_ACCESS": "s3BackupPathStyleAccess",
      "FIGCHAIN_ENCRYPTION_PRIVATE_KEY": "encryptionPrivateKey",
      "FIGCHAIN_IDENTITY_PRIVATE_KEY": "authPrivateKey",
    };

    for (const [envKey, configKey] of Object.entries(envMap)) {
      const val = process.env[envKey];
      if (val !== undefined) {
        if (configKey === "pollInterval" || configKey === "maxRetries" || configKey === "retryDelayMs") {
          configData[configKey] = parseInt(val, 10);
        } else if (configKey === "s3BackupEnabled" || configKey === "s3BackupPathStyleAccess" || configKey === "useLongPolling") {
          configData[configKey] = val.toLowerCase() === "true" || val === "1";
        } else {
          configData[configKey] = val;
        }
      }
    }

    // Namespaces env var
    const nsVar = process.env["FIGCHAIN_NAMESPACES"];
    if (nsVar) {
      configData.namespaces = new Set(nsVar.split(",").map(s => s.trim()).filter(Boolean));
    }
    const singleNsVar = process.env["FIGCHAIN_NAMESPACE"];
    if (singleNsVar) {
      configData.namespaces = new Set([singleNsVar.trim()]);
    }

    // Bootstrap Strategy Env Var
    const strategyVar = process.env["FIGCHAIN_BOOTSTRAP_STRATEGY"];
    if (strategyVar) {
        configData.bootstrapStrategy = strategyVar as BootstrapStrategy;
    }

    // 3. Overrides
    Object.assign(configData, overrides);

    return new Config({ ...config, ...configData } as ConfigOptions);
  }

  private static loadFromFile(filePath: string): Partial<ConfigOptions> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, unknown>;
      return this.mapKeys(data);
    } catch (e: unknown) {
      console.warn(`Failed to load config from ${filePath}:`, e);
      return {};
    }
  }

  private static mapKeys(data: Record<string, unknown>): Partial<ConfigOptions> {
    const mapped: Record<string, unknown> = { ...data };

    const keyMap: Record<string, keyof ConfigOptions> = {
        "authPrivateKey": "authPrivateKey",
        "privateKey": "authPrivateKey",
        "encryptionPrivateKey": "encryptionPrivateKey",
        "tenantId": "tenantId",
        "environmentId": "environmentId",
        "credentialId": "authCredentialId",
        "s3BackupEnabled": "s3BackupEnabled",
        "s3BackupBucket": "s3BackupBucket",
        "s3BackupPrefix": "s3BackupPrefix",
        "s3BackupRegion": "s3BackupRegion",
        "s3BackupEndpoint": "s3BackupEndpoint"
    };

    for (const [jsonKey, configKey] of Object.entries(keyMap)) {
        if (jsonKey in data) {
            mapped[configKey] = data[jsonKey];
        }
    }

    if (data.namespaces) {
        mapped.namespaces = data.namespaces;
    }
    if (data.namespace && typeof data.namespace === 'string') {
        mapped.namespaces = data.namespace;
    }

    if (data.bootstrapMode) {
        // Simple mapping attempt
        mapped.bootstrapStrategy = data.bootstrapMode as BootstrapStrategy;
    }

    return mapped;
  }
}
