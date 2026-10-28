import axios, { AxiosInstance } from 'axios';
import * as avsc from 'avsc';
import { TokenProvider } from './auth';
import {
  InitialFetchResponse,
  UpdateFetchResponse
} from './models';

// Embedded Avro schema for FigChain protocol messages
const SCHEMA_JSON = [
    {
        "type": "enum",
        "name": "Operator",
        "namespace": "io.figchain.avro.model",
        "symbols": ["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "CONTAINS", "IN", "NOT_IN", "SPLIT"]
    },
    {
        "type": "record",
        "name": "Condition",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {"name": "variable", "type": "string"},
            {"name": "operator", "type": "io.figchain.avro.model.Operator"},
            {"name": "values", "type": {"type": "array", "items": "string"}}
        ]
    },
    {
        "type": "record",
        "name": "Rule",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {"name": "description", "type": ["null", "string"], "default": null},
            {"name": "conditions", "type": {"type": "array", "items": "io.figchain.avro.model.Condition"}},
            {"name": "targetVersion", "type": {"type": "string", "logicalType": "uuid"}}
        ]
    },
    {
        "type": "record",
        "name": "FigDefinition",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {
                "name": "namespace",
                "type": "string"
            },
            {
                "name": "key",
                "type": "string"
            },
            {
                "name": "figId",
                "type": {
                    "type": "string",
                    "logicalType": "uuid"
                }
            },
            {
                "name": "schemaUri",
                "type": {
                    "type": "string",
                    "logicalType": "uri"
                }
            },
            {
                "name": "schemaVersion",
                "type": "string"
            },
            {
                "name": "createdAt",
                "type": {
                    "type": "long",
                    "logicalType": "timestamp-millis"
                }
            },
            {
                "name": "updatedAt",
                "type": {
                    "type": "long",
                    "logicalType": "timestamp-millis"
                }
            }
        ]
    },
    {
        "type": "record",
        "name": "Fig",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {
                "name": "figId",
                "type": {
                    "type": "string",
                    "logicalType": "uuid"
                }
            },
            {
                "name": "version",
                "type": {
                    "type": "string",
                    "logicalType": "uuid"
                }
            },
            {
                "name": "payload",
                "type": "bytes"
            },
            {
                "name": "isEncrypted",
                "type": "boolean",
                "default": false
            },
            {
                "name": "wrappedDek",
                "type": ["null", "bytes"],
                "default": null
            },
            {
                "name": "encryptionAlgorithm",
                "type": ["null", "string"],
                "default": null
            },
            {
                "name": "keyId",
                "type": ["null", "string"],
                "default": null
            }
        ]
    },
    {
        "type": "record",
        "name": "FigFamily",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {
                "name": "definition",
                "type": "io.figchain.avro.model.FigDefinition"
            },
            {
                "name": "figs",
                "type": {
                    "type": "array",
                    "items": "io.figchain.avro.model.Fig"
                }
            },
            {
                "name": "rules",
                "type": {
                    "type": "array",
                    "items": "io.figchain.avro.model.Rule"
                },
                "default": []
            },
            {
                "name": "defaultVersion",
                "type": ["null", {"type": "string", "logicalType": "uuid"}],
                "default": null
            }
        ]
    },
    {
        "type": "record",
        "name": "InitialFetchRequest",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {
                "name": "namespace",
                "type": "string"
            },
            {
                "name": "environmentId",
                "type": {
                    "type": "string",
                    "logicalType": "uuid"
                }
            },
            {
                "name": "asOfTimestamp",
                "type": [
                    "null",
                    {
                        "type": "long",
                        "logicalType": "timestamp-millis"
                    }
                ],
                "default": null
            }
        ]
    },
    {
        "type": "record",
        "name": "InitialFetchResponse",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {
                "name": "figFamilies",
                "type": {
                    "type": "array",
                    "items": "io.figchain.avro.model.FigFamily"
                }
            },
            {
                "name": "cursor",
                "type": "string"
            },
            {
                "name": "environmentId",
                "type": {
                    "type": "string",
                    "logicalType": "uuid"
                }
            },
            {
                "name": "schemas",
                "type": {
                    "type": "map",
                    "values": "string"
                },
                "default": {}
            }
        ]
    },
    {
        "type": "record",
        "name": "UpdateFetchRequest",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {
                "name": "namespace",
                "type": "string"
            },
            {
                "name": "cursor",
                "type": "string"
            },
            {
                "name": "environmentId",
                "type": {
                    "type": "string",
                    "logicalType": "uuid"
                }
            }
        ]
    },
    {
        "type": "record",
        "name": "UpdateFetchResponse",
        "namespace": "io.figchain.avro.model",
        "fields": [
            {
                "name": "figFamilies",
                "type": {
                    "type": "array",
                    "items": "io.figchain.avro.model.FigFamily"
                }
            },
            {
                "name": "cursor",
                "type": "string"
            },
            {
                "name": "schemas",
                "type": {
                    "type": "map",
                    "values": "string"
                },
                "default": {}
            }
        ]
    }
];



// Types
const registry: Record<string, avsc.Type> = {};
// Register all types in the registry
for (const schema of SCHEMA_JSON) {
    avsc.Type.forSchema(schema as avsc.Schema, { registry });
}

const initialFetchRequestType = registry['io.figchain.avro.model.InitialFetchRequest'];
const updateFetchRequestType = registry['io.figchain.avro.model.UpdateFetchRequest'];


export interface NamespaceKey {
  wrappedKey: string; // Base64 encoded
  keyId: string;
}


import { Readable } from 'stream';

async function encodeOcf(type: avsc.Type, obj: unknown): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const encoder = new avsc.streams.BlockEncoder(type);
        const chunks: Buffer[] = [];
        encoder.on('data', (c: Buffer) => chunks.push(c));
        encoder.on('end', () => resolve(Buffer.concat(chunks)));
        encoder.on('error', reject);
        encoder.write(obj);
        encoder.end();
    });
}

async function decodeOcf(buffer: Buffer): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const decoder = new avsc.streams.BlockDecoder();
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);

        let result: unknown = null;
        stream.pipe(decoder);

        decoder.on('data', (val: unknown) => {
            if (!result) {result = val;}
        });
        decoder.on('end', () => {
            if (result) {resolve(result);}
            else {reject(new Error("No data in OCF"));}
        });
        decoder.on('error', reject);
    });
}

/** Tells the server how long it may hold an update request open; absent or 0 means respond now. */
export const LONG_POLL_TIMEOUT_HEADER = 'X-Long-Poll-Timeout';
const REQUEST_SLACK_SECONDS = 5;

/**
 * True when a request failed in transit (timeout, reset, dropped connection)
 * rather than the server answering with an error status.
 */
export function isTransitFailure(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response;
}

export class Transport {
  private client: AxiosInstance;

  constructor(
    private baseUrl: string,
    private tokenProvider: TokenProvider,
    private environmentId: string
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      responseType: 'arraybuffer', // Crucial for Avro
      timeout: 30000
    });
  }

  private async getHeaders(contentType: string = 'application/octet-stream'): Promise<Record<string, string>> {
    const token = await this.tokenProvider.getToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType
    };
  }

  async fetchInitial(namespace: string, asOf?: string): Promise<InitialFetchResponse> {
      const headers = await this.getHeaders();
      const req = {
          namespace,
          environmentId: this.environmentId,
          asOfTimestamp: asOf ? new Date(asOf).getTime() : null
      };

      const buf = await encodeOcf(initialFetchRequestType, req);

      try {
          const res = await this.client.post('/data/initial', buf, { headers });
          const data = res.data;
          const val = await decodeOcf(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
          return this.mapResponse(val) as InitialFetchResponse;
      } catch (e: unknown) {
          throw this.handleError(e);
      }
  }

  /**
   * Fetch updates after `cursor`. With `waitSeconds > 0` the server may hold
   * the request open that long until updates arrive (long polling); 0 returns
   * immediately. The client timeout allows the wait plus slack, so a
   * connection silently dropped mid-wait still fails promptly.
   */
  async fetchUpdates(namespace: string, cursor: string, waitSeconds = 0): Promise<UpdateFetchResponse> {
    const headers: Record<string, string> = { ...(await this.getHeaders()) };
    if (waitSeconds > 0) {
      headers[LONG_POLL_TIMEOUT_HEADER] = String(Math.floor(waitSeconds));
    }
    const req = {
      namespace,
      cursor: cursor || "",
      environmentId: this.environmentId
    };
    const buf = await encodeOcf(updateFetchRequestType, req);

    try {
      const res = await this.client.post('/data/updates', buf, {
        headers,
        timeout: (waitSeconds + REQUEST_SLACK_SECONDS) * 1000
      });
      const data = res.data;
      const val = await decodeOcf(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      return this.mapResponse(val) as UpdateFetchResponse;
    } catch (e: unknown) {
      throw this.handleError(e);
    }
  }

  async fetchSchema(namespace: string, name: string, version: number): Promise<string> {
      const token = await this.tokenProvider.getToken();
      // Schema endpoint returns string (text/plain or json)
      const res = await axios.get(
          `${this.baseUrl}/schemas/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${version}/content`,
          {
              headers: { 'Authorization': `Bearer ${token}` },
              responseType: 'text',
              timeout: 10000
          }
      );
      return res.data;
  }

  async getNamespaceKeys(namespace: string): Promise<NamespaceKey[]> {
      const headers = await this.getHeaders('application/json');
      const res = await axios.get(
          `${this.baseUrl}/envelopes`,
          {
              params: { namespace },
              headers: headers,
              responseType: 'json',
              timeout: 10000
          }
      );

      const keys: NamespaceKey[] = [];
      if (Array.isArray(res.data)) {
          for (const item of res.data) {
              const keyData = item.key;
              if (keyData && keyData.namespaceId === namespace) {
                  const encryptedBlob = item.encryptedBlob;
                  const nskVersion = keyData.nskVersion;
                  if (encryptedBlob && nskVersion !== undefined) {
                      keys.push({
                          wrappedKey: encryptedBlob,
                          keyId: `nsk-v${nskVersion}`
                      });
                  }
              }
          }
      }
      return keys;
  }

  private mapResponse(obj: unknown): unknown {

      if (Array.isArray(obj)) {
          return obj.map(o => this.mapResponse(o));
      }
      if (obj && typeof obj === 'object') {
          const record = obj as Record<string, unknown>;
          // Check for specific fields to convert
          if ('createdAt' in record && typeof record.createdAt === 'number') {
              record.createdAt = new Date(record.createdAt).toISOString();
          }
          if ('updatedAt' in record && typeof record.updatedAt === 'number') {
              record.updatedAt = new Date(record.updatedAt).toISOString();
          }

          // Recurse
          for (const key of Object.keys(record)) {
              record[key] = this.mapResponse(record[key]);
          }
      }
      return obj;
  }

  private handleError(e: unknown): Error {
      if (typeof e === 'object' && e !== null && 'response' in e) {
          const err = e as { response: { status: number; statusText: string; data: unknown } };
          console.error(`Request failed: ${err.response.status} ${err.response.statusText}`);
          if (Buffer.isBuffer(err.response.data)) {
              console.error(err.response.data.toString());
          }
      }
      return e instanceof Error ? e : new Error(String(e));
  }
}