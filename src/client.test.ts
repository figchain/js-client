
import { FigChainClient } from './client';
import { Config } from './config';

describe('FigChainClient', () => {
  it('should be instantiable with minimal options', () => {
    const client = new FigChainClient({
      environmentId: 'test-env',
      authPrivateKey: '0000000000000000000000000000000000000000000000000000000000000000', // 32 bytes hex
      authCredentialId: 'test-cred'
    });
    expect(client).toBeInstanceOf(FigChainClient);
  });

  it('should load default config values', () => {
    const config = new Config({
        environmentId: 'test-env'
    });
    expect(config.baseUrl).toBe("https://app.figchain.io/api/");
    expect(config.pollInterval).toBe(60);
  });
});
