
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Config } from '../config';
import { FigFamily, Fig, Rule, Operator, FigDefinition } from '../models';
import * as crypto from 'crypto';
import { loadX25519PrivateKey, calculateFingerprint, decryptAesGcm, decryptX25519 } from '../crypto';
import { NamespaceKey } from '../transport';

export const SUPPORTED_BACKUP_VERSIONS = ['v2', 'v3'] as const;
export type BackupVersion = typeof SUPPORTED_BACKUP_VERSIONS[number];

/** Unencrypted public section of a v3 backup (schemas only). */
export interface BackupPublicData {
  generatedAt?: string;
  schemas?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BackupFile {
  version?: string;
  algorithm?: string;
  keyFingerprint?: string;
  encryptedKey?: string;
  encryptedData?: string;
  publicData?: string;
}

export interface DecryptedBackup {
  version: BackupVersion;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  publicData?: BackupPublicData;
}

/**
 * Decrypts a FigChain S3 backup document (v2 or v3).
 * For v3, the exact UTF-8 bytes of the publicData string are used as AES-GCM AAD.
 */
export function decryptBackup(backup: BackupFile, privateKey: crypto.KeyObject): DecryptedBackup {
  const version = backup.version;
  if (!version || !(SUPPORTED_BACKUP_VERSIONS as readonly string[]).includes(version)) {
    throw new Error(`Unsupported backup version: ${JSON.stringify(version)} (supported: ${SUPPORTED_BACKUP_VERSIONS.join(', ')})`);
  }
  const { encryptedKey, encryptedData } = backup;
  if (!encryptedKey || !encryptedData) {throw new Error("Invalid backup format");}

  let aad: Buffer | undefined;
  let publicData: BackupPublicData | undefined;
  if (version === 'v3') {
    if (typeof backup.publicData !== 'string') {
      throw new Error("Invalid v3 backup: publicData must be a JSON string");
    }
    aad = Buffer.from(backup.publicData, 'utf8');
  }

  const aesKey = decryptX25519(Buffer.from(encryptedKey, 'base64'), privateKey);
  const payloadJson = decryptAesGcm(Buffer.from(encryptedData, 'base64'), aesKey, aad).toString('utf8');
  const payload = JSON.parse(payloadJson);

  if (backup.publicData !== undefined && version === 'v3') {
    publicData = JSON.parse(backup.publicData) as BackupPublicData;
  }
  return { version: version as BackupVersion, payload, publicData };
}

export class S3BackupService {
  private s3: S3Client;
  private privateKey: crypto.KeyObject;
  private fingerprint: string;

  constructor(private config: Config) {
    if (!config.s3BackupEnabled) {
      throw new Error("S3 Backup is not enabled");
    }

    const region = config.s3BackupRegion || 'us-east-1';
    this.s3 = new S3Client({
      region,
      endpoint: config.s3BackupEndpoint,
      forcePathStyle: config.s3BackupPathStyleAccess
      // Credentials are automatically loaded from env or ~/.aws/credentials by SDK
    });

    const keyHex = config.authPrivateKey || config.encryptionPrivateKey;
    if (!keyHex) {
      throw new Error("Backup requires a private key (auth or encryption)");
    }

    // S3 backup decryption requires X25519 encryption key
    if (config.encryptionPrivateKey) {
        this.privateKey = loadX25519PrivateKey(config.encryptionPrivateKey);
    } else {
        throw new Error("S3 Backup requires encryptionPrivateKey to be configured for decryption.");
    }

    this.fingerprint = calculateFingerprint(this.privateKey);
  }

  async loadBackup(): Promise<{ families: FigFamily[]; cursor?: string }> {
      const bucket = this.config.s3BackupBucket;
      if (!bucket) {throw new Error("S3 Backup bucket not configured");}

      const prefix = this.config.s3BackupPrefix ? this.config.s3BackupPrefix.replace(/\/$/, '') : '';
      const key = prefix ? `${prefix}/${this.fingerprint}/backup.json` : `${this.fingerprint}/backup.json`;
      // Ensure no leading slash
      const cleanKey = key.replace(/^\//, '');

      try {
          const resp = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: cleanKey }));
          const bodyStr = await resp.Body?.transformToString();
          if (!bodyStr) {throw new Error("Empty backup body");}

          const { payload } = decryptBackup(JSON.parse(bodyStr), this.privateKey);

          return {
              families: ((payload.items as unknown[]) || []).map((d) => this.mapToFigFamily(d as Record<string, unknown>)),
              cursor: payload.syncToken
          };
      } catch (e: unknown) {
          throw new Error(`Failed to load backup from S3: ${e instanceof Error ? e.message : String(e)}`);
      }
  }

  async fetchNsk(namespace: string): Promise<NamespaceKey | null> {
      if (!this.config.authCredentialId && !this.config.authClientId) {return null;}
      const clientId = this.config.authCredentialId || this.config.authClientId;
      const bucket = this.config.s3BackupBucket;
      if (!bucket) {return null;}

      const prefix = this.config.s3BackupPrefix ? this.config.s3BackupPrefix.replace(/\/$/, '') : '';
      const key = prefix ? `${prefix}/devices/${clientId}/namespaces/${namespace}.json` : `devices/${clientId}/namespaces/${namespace}.json`;
       const cleanKey = key.replace(/^\//, '');

       try {
           const resp = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: cleanKey }));
           const bodyStr = await resp.Body?.transformToString();
           if (!bodyStr) {return null;}

           const data = JSON.parse(bodyStr);
           return {
               keyId: data.keyId,
               wrappedKey: data.wrappedKey
           };
       } catch {
           return null;
       }
  }

  private mapToFigFamily(d: Record<string, unknown>): FigFamily {
      // definition
      const def = d.definition as Record<string, unknown>;
      const definition: FigDefinition = {
          namespace: def.namespace as string,
          key: def.key as string,
          figId: def.figId as string,
          schemaUri: def.schemaUri as string,
          schemaVersion: def.schemaVersion as string,
          createdAt: def.createdAt as string,
          updatedAt: def.updatedAt as string
      };

      // figs
      const figs: Fig[] = ((d.figs as unknown[]) || []).map((f) => {
          const fig = f as Record<string, unknown>;
          return {
              figId: fig.figId as string,
              version: fig.version as string,
              payload: typeof fig.payload === 'string' ? Buffer.from(fig.payload as string, 'base64') : Buffer.from(fig.payload as ArrayBuffer),
              isEncrypted: fig.isEncrypted as boolean | undefined,
              wrappedDek: fig.wrappedDek ? (typeof fig.wrappedDek === 'string' ? Buffer.from(fig.wrappedDek as string, 'base64') : Buffer.from(fig.wrappedDek as ArrayBuffer)) : undefined,
              encryptionAlgorithm: fig.encryptionAlgorithm as string | undefined,
              keyId: fig.keyId as string | undefined
          };
      });

      // rules
      const rules: Rule[] = ((d.rules as unknown[]) || []).map((r) => {
          const rule = r as Record<string, unknown>;
          return {
              description: rule.description as string | undefined,
              targetVersion: rule.targetVersion as string,
              conditions: ((rule.conditions as unknown[]) || []).map((c) => {
                  const cond = c as Record<string, unknown>;
                  return {
                      variable: cond.variable as string,
                      operator: cond.operator as Operator,
                      values: cond.values as string[]
                  };
              })
          };
      });

      return {
          definition,
          figs,
          rules,
          defaultVersion: d.defaultVersion as string | undefined
      };
  }
}
