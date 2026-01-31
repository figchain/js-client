
import * as crypto from 'crypto';
import { CryptoError } from './errors';

// DER Headers for PKCS#8 (Private Keys)
const ED25519_PKCS8_HEADER = Buffer.from("302e020100300506032b657004220420", "hex");
const X25519_PKCS8_HEADER = Buffer.from("302e020100300506032b656e04220420", "hex");

// DER Headers for SPKI (Public Keys)
const X25519_SPKI_HEADER = Buffer.from("302a300506032b656e032100", "hex");

export function loadEd25519PrivateKey(hexKey: string): crypto.KeyObject {
  try {
    const rawKey = Buffer.from(hexKey, 'hex');
    if (rawKey.length !== 32) {
      throw new Error(`Invalid key length: ${rawKey.length}`);
    }
    const der = Buffer.concat([ED25519_PKCS8_HEADER, rawKey]);
    return crypto.createPrivateKey({
      key: der,
      format: 'der',
      type: 'pkcs8'
    });
  } catch (e: unknown) {
    throw new CryptoError(`Failed to load Ed25519 private key: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function loadX25519PrivateKey(hexKey: string): crypto.KeyObject {
  try {
    const rawKey = Buffer.from(hexKey, 'hex');
    if (rawKey.length !== 32) {
      throw new Error(`Invalid key length: ${rawKey.length}`);
    }
    const der = Buffer.concat([X25519_PKCS8_HEADER, rawKey]);
    return crypto.createPrivateKey({
      key: der,
      format: 'der',
      type: 'pkcs8'
    });
  } catch (e: unknown) {
    throw new CryptoError(`Failed to load X25519 private key: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function signEd25519(message: Buffer, privateKey: crypto.KeyObject): Buffer {
  try {
    // Ed25519 signature
    // In Node.js, we can use crypto.sign(null, data, privateKey)
    return crypto.sign(null, message, privateKey);
  } catch (e: unknown) {
    throw new CryptoError(`Failed to sign message: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function decryptX25519(packedBlob: Buffer, privateKey: crypto.KeyObject): Buffer {
  try {
    if (packedBlob.length < 32 + 12) {
      throw new Error("Blob too short");
    }

    const ephemeralPubBytes = packedBlob.subarray(0, 32);
    const iv = packedBlob.subarray(32, 44);
    const ciphertext = packedBlob.subarray(44);

    // Load Ephemeral Public Key
    const pubDer = Buffer.concat([X25519_SPKI_HEADER, ephemeralPubBytes]);
    const ephemeralPubKey = crypto.createPublicKey({
      key: pubDer,
      format: 'der',
      type: 'spki'
    });

    // ECDH
    const sharedSecret = crypto.diffieHellman({
      privateKey: privateKey,
      publicKey: ephemeralPubKey
    });

    // HKDF: derive key encryption key from shared secret
    const kek = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.alloc(0), 32);

    // Decrypt AES-GCM
    return decryptAesGcm(Buffer.concat([iv, ciphertext]), Buffer.from(kek));

  } catch (e: unknown) {
    throw new CryptoError(`X25519 Decryption failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function decryptAesGcm(encryptedData: Buffer, key: Buffer): Buffer {
  try {
    // Expected format: IV (12 bytes) + Ciphertext + Tag (16 bytes)
    if (encryptedData.length < 28) {
      throw new Error("Encrypted data too short");
    }

    const iv = encryptedData.subarray(0, 12);
    // Format: IV (12 bytes) + Ciphertext + Auth Tag (16 bytes)
    const tagLength = 16;
    const ciphertextLength = encryptedData.length - 12 - tagLength;
    const ciphertext = encryptedData.subarray(12, 12 + ciphertextLength);
    const tag = encryptedData.subarray(12 + ciphertextLength);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted;
  } catch (e: unknown) {
    throw new CryptoError(`AES-GCM Decryption failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function calculateFingerprint(key: crypto.KeyObject): string {
  try {
      // Calculate SHA256 of Raw Public Key bytes
      let pubKeyBytes: Buffer;
      if (key.type === 'private') {
          const pubKeyObject = crypto.createPublicKey(key);
          const jwk = pubKeyObject.export({ format: 'jwk' });
          if (!jwk.x) {throw new Error("Could not extract public key from private key");}
          pubKeyBytes = Buffer.from(jwk.x, 'base64url');
      } else {
          // Public key
           const jwk = key.export({ format: 'jwk' });
           if (!jwk.x) {throw new Error("Could not extract public key");}
           pubKeyBytes = Buffer.from(jwk.x, 'base64url');
      }

      return crypto.createHash('sha256').update(pubKeyBytes).digest('hex');
  } catch (e: unknown) {
      throw new CryptoError(`Failed to calculate fingerprint: ${e instanceof Error ? e.message : String(e)}`);
  }
}
