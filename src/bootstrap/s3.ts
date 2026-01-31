
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Config } from '../config';
import { FigFamily, Fig, Rule, Operator, FigDefinition } from '../models';
import * as crypto from 'crypto';
import { loadX25519PrivateKey, calculateFingerprint, decryptAesGcm, decryptX25519 } from '../crypto';
import { NamespaceKey } from '../transport';

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

          const backupData = JSON.parse(bodyStr) as { encryptedKey?: string; encryptedData?: string };

          // Decrypt
          const encryptedKey = backupData.encryptedKey;
          const encryptedData = backupData.encryptedData;

          if (!encryptedKey || !encryptedData) {throw new Error("Invalid backup format");}

          // Decrypt AES Key
          const aesKey = decryptX25519(Buffer.from(encryptedKey, 'base64'), this.privateKey);

          // Decrypt Payload
          const payloadJson = decryptAesGcm(Buffer.from(encryptedData, 'base64'), aesKey).toString('utf8');

          const payload = JSON.parse(payloadJson);

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
