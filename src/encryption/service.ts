
import * as crypto from 'crypto';
import { Transport, NamespaceKey } from '../transport';
import { Fig } from '../models';
import { decryptAesGcm, decryptX25519 } from '../crypto';
import { S3BackupService } from '../bootstrap/s3';

export class EncryptionService {
  private nskCache: Map<string, Buffer> = new Map();

  constructor(
    private transport: Transport,
    private privateKey: crypto.KeyObject, // X25519 Private Key
    private s3BackupService?: S3BackupService
  ) {}

  async decrypt(fig: Fig, namespace: string): Promise<Buffer> {
    if (!fig.isEncrypted) {
      if (Buffer.isBuffer(fig.payload)) {return fig.payload;}
      if (typeof fig.payload === 'string') {return Buffer.from(fig.payload, 'base64');}
      throw new Error("Invalid payload type");
    }

    const nskId = fig.keyId;
    const wrappedDek = fig.wrappedDek;

    if (!wrappedDek) {
      throw new Error("Encrypted fig has no wrapped DEK");
    }
    
    // Ensure wrappedDek is Buffer
    let wrappedDekBuf: Buffer;
    if (Buffer.isBuffer(wrappedDek)) {wrappedDekBuf = wrappedDek;}
    else if (typeof wrappedDek === 'string') {wrappedDekBuf = Buffer.from(wrappedDek, 'base64');}
    else {throw new Error("Invalid wrappedDek type");}

    // Get NSK
    const nsk = await this.getNsk(namespace, nskId);

    // Unwrap DEK using AES-GCM (format: IV + Ciphertext + Tag)
    let dek: Buffer;
    try {
        dek = decryptAesGcm(wrappedDekBuf, nsk);
    } catch (e: unknown) {
        throw new Error(`Failed to unwrap DEK: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Decrypt Payload
    let payloadBuf: Buffer;
    if (Buffer.isBuffer(fig.payload)) {payloadBuf = fig.payload;}
    else {payloadBuf = Buffer.from(fig.payload, 'base64');}

    return decryptAesGcm(payloadBuf, dek);
  }

  private async getNsk(namespace: string, keyId?: string): Promise<Buffer> {
    if (keyId && this.nskCache.has(keyId)) {
      return this.nskCache.get(keyId)!;
    }

    let matchingKey: NamespaceKey | undefined;

    // Try API
    try {
      const keys = await this.transport.getNamespaceKeys(namespace);
      matchingKey = keys.find(k => k.keyId === keyId);
      if (!matchingKey && !keyId && keys.length > 0) {
        matchingKey = keys[0];
      }
    } catch (e) {
      console.warn(`Failed to fetch NSK from API:`, e);
    }

    // Try S3 Fallback
    if (!matchingKey && this.s3BackupService) {
        try {
            const s3Key = await this.s3BackupService.fetchNsk(namespace);
            if (s3Key) {
                if (keyId && s3Key.keyId !== keyId) {
                    // Mismatch
                } else {
                    matchingKey = s3Key;
                }
            }
        } catch (e) {
            console.warn(`Failed to fetch NSK from S3:`, e);
        }
    }

    if (!matchingKey) {
      throw new Error(`No matching key found for namespace ${namespace} and keyId ${keyId}`);
    }

    try {
      const wrappedKeyBuf = Buffer.from(matchingKey.wrappedKey, 'base64');
      const unwrappedNsk = decryptX25519(wrappedKeyBuf, this.privateKey);
      
      if (matchingKey.keyId) {
        this.nskCache.set(matchingKey.keyId, unwrappedNsk);
      }
      
      return unwrappedNsk;
    } catch (e: unknown) {
        throw new Error(`Failed to decrypt payload: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
