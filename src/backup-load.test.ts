import * as fs from 'fs';
import * as path from 'path';
import { S3Client } from '@aws-sdk/client-s3';
import { FigChainClient } from './client';
import { BootstrapStrategy } from './config';
import { mapLatestFig } from './bootstrap/s3';

// Throwaway local-dev key; fixture is a live v3 backup whose items are { definition, latestFig }
const KEY_HEX = '807c5fb05b1ea661625cade3c12c5db6059b95d40e91381233d26d5b1574e440';
const FIXTURE = fs.readFileSync(path.join(__dirname, '__fixtures__', 'backup-v3-latest-fig.json'), 'utf8');

describe('S3 backup loading (latestFig items)', () => {
  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({
      Body: { transformToString: async () => FIXTURE }
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('bootstraps backup-only and decodes the fig with schemas from the backup, without the server', async () => {
    const client = new FigChainClient({
      baseUrl: 'http://127.0.0.1:9/api/',
      clientSecret: 'x',
      environmentId: 'env',
      namespaces: ['shop'],
      encryptionPrivateKey: KEY_HEX,
      s3BackupEnabled: true,
      s3BackupBucket: 'b',
      s3BackupPrefix: 'backups/plugin_e2e',
      bootstrapStrategy: BootstrapStrategy.S3_BACKUP_ONLY,
      useLongPolling: false,
      pollInterval: 3600
    });
    // Keep the poller from reaching the network
    jest.spyOn(client as unknown as { poll: () => void }, 'poll').mockImplementation(() => undefined);
    await client.init();
    expect(sendSpy).toHaveBeenCalled();
    expect(await client.getFig('checkout')).toEqual({ currency: 'USD', maxItems: 20 });
    client.close();
  });
});

describe('mapLatestFig', () => {
  it('maps binaryData, stringData and encryption fields', () => {
    const bin = mapLatestFig({ figId: 'f', version: 'v', encrypted: false, payload: { data: { binaryData: 'BlVTRCg=' } } });
    expect(bin.payload).toEqual(Buffer.from('BlVTRCg=', 'base64'));
    expect(bin.isEncrypted).toBe(false);

    const str = mapLatestFig({ figId: 'f', version: 'v', payload: { data: { stringData: 'abc' } } });
    expect(str.payload).toEqual(Buffer.from('abc'));

    const enc = mapLatestFig({ figId: 'f', version: 'v', encrypted: true, wrappedDek: 'AAE=', keyId: 'k',
      encryptionAlgorithm: 'AES', payload: { data: { binaryData: 'AA==' } } });
    expect(enc.isEncrypted).toBe(true);
    expect(enc.wrappedDek).toEqual(Buffer.from([0, 1]));
    expect(enc.keyId).toBe('k');
  });
});
