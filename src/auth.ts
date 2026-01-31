
import { v4 as uuidv4 } from 'uuid';
import { loadEd25519PrivateKey, signEd25519 } from './crypto';
import * as crypto from 'crypto';

export interface TokenProvider {
  getToken(): Promise<string>;
}

export class SharedSecretTokenProvider implements TokenProvider {
  constructor(private clientSecret: string) {}

  getToken(): Promise<string> {
    return Promise.resolve(this.clientSecret);
  }
}

export class PrivateKeyTokenProvider implements TokenProvider {
  private privateKey: crypto.KeyObject;
  private serviceAccountId: string;
  private keyId?: string;
  private tenantId?: string;
  private namespace?: string;

  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    privateKeyHex: string,
    serviceAccountId: string,
    keyId?: string,
    tenantId?: string,
    namespace?: string
  ) {
    this.privateKey = loadEd25519PrivateKey(privateKeyHex);
    this.serviceAccountId = serviceAccountId;
    this.keyId = keyId;
    this.tenantId = tenantId;
    this.namespace = namespace;
  }

  getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && now < this.tokenExpiry - 300) { // Refresh 5 mins early
      return Promise.resolve(this.cachedToken);
    }

    const payload: Record<string, unknown> = {
      iss: this.serviceAccountId,
      sub: this.serviceAccountId,
      // aud: "https://app.figchain.io", // Python client does not send aud
      iat: now,
      nbf: now,
      exp: now + 3600,
      jti: uuidv4()
    };

    if (this.tenantId) {payload.tenant_id = this.tenantId;}
    if (this.namespace) {payload.namespace = this.namespace;}

    // Manual JWT construction: Header.Payload.Signature
    
    const header = {
      alg: "EdDSA",
      typ: "JWT",
      kid: this.keyId
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    
    const signature = signEd25519(Buffer.from(signingInput), this.privateKey);
    const encodedSignature = signature.toString('base64url');

    this.cachedToken = `${signingInput}.${encodedSignature}`;
    this.tokenExpiry = payload.exp as number;
    
    return Promise.resolve(this.cachedToken);
  }
}
