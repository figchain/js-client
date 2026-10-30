import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { decryptBackup, BackupFile } from './bootstrap/s3';
import { loadX25519PrivateKey, calculateFingerprint } from './crypto';

// Throwaway local-dev key matching src/__fixtures__/backup-v3.json
const V3_KEY_HEX = '807c5fb05b1ea661625cade3c12c5db6059b95d40e91381233d26d5b1574e440';
const loadV3 = (): BackupFile =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'backup-v3.json'), 'utf8'));

function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) {c.setAAD(aad);}
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

function buildBackup(recipient: crypto.KeyObject, payload: object, version: string, publicData?: string): BackupFile {
  const eph = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: crypto.createPublicKey(recipient) });
  const kek = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.alloc(0), 32));
  const dek = crypto.randomBytes(32);
  const ephPub = Buffer.from(eph.publicKey.export({ format: 'jwk' }).x as string, 'base64url');
  const encryptedKey = Buffer.concat([ephPub, aesGcmEncrypt(kek, dek)]).toString('base64');
  const aad = publicData !== undefined ? Buffer.from(publicData, 'utf8') : undefined;
  const encryptedData = aesGcmEncrypt(dek, Buffer.from(JSON.stringify(payload)), aad).toString('base64');
  return { version, algorithm: 'X25519-ECIES', keyFingerprint: 'x', encryptedKey, encryptedData, publicData };
}

describe('decryptBackup', () => {
  const v3Key = loadX25519PrivateKey(V3_KEY_HEX);

  it('derives the fingerprint as SHA-256 of the raw X25519 public key', () => {
    // Note: the keyFingerprint field in the fixture was computed incorrectly by the server; do not match it.
    expect(calculateFingerprint(v3Key)).toBe('1560c7168e948cebfb07a001592a7cc8be5032230abfd9e056b4e7422299ad5f');
  });

  it('decrypts the real v3 test vector', () => {
    const result = decryptBackup(loadV3(), v3Key);
    expect(result.version).toBe('v3');
    expect(result.payload.tenantId).toBe('plugin_e2e');
    expect(result.payload.items).toHaveLength(2);
    expect(result.publicData).toBeDefined();
    expect(typeof result.publicData?.generatedAt).toBe('string');
    expect(typeof result.publicData?.schemas).toBe('object');
  });

  it('still decrypts v2 backups (no AAD)', () => {
    const key = crypto.generateKeyPairSync('x25519').privateKey;
    const backup = buildBackup(key, { tenantId: 't2', items: [] }, 'v2');
    const result = decryptBackup(backup, key);
    expect(result.version).toBe('v2');
    expect(result.payload.tenantId).toBe('t2');
    expect(result.publicData).toBeUndefined();
  });

  it('fails when publicData is tampered with', () => {
    const backup = loadV3();
    backup.publicData = backup.publicData!.replace('"schemas"', ' "schemas"');
    expect(() => decryptBackup(backup, v3Key)).toThrow(/AES-GCM Decryption failed/);
  });

  it('fails when a v3 backup is relabelled as v2', () => {
    expect(() => decryptBackup({ ...loadV3(), version: 'v2' }, v3Key)).toThrow(/AES-GCM Decryption failed/);
  });

  it('rejects a v3 backup missing publicData', () => {
    expect(() => decryptBackup({ ...loadV3(), publicData: undefined }, v3Key)).toThrow(/publicData/);
  });

  it('rejects unknown versions', () => {
    expect(() => decryptBackup({ ...loadV3(), version: 'v4' }, v3Key)).toThrow(/Unsupported backup version: "v4"/);
    expect(() => decryptBackup({ ...loadV3(), version: undefined }, v3Key)).toThrow(/Unsupported backup version/);
  });
});
