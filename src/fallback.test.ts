import { AxiosError, AxiosHeaders } from 'axios';
import { FallbackStrategy, BootstrapStrategy } from './bootstrap/strategies';

const backup = { figFamilies: [], cursors: { ns: 'backup' }, schemas: {} };
const backupStrategy: BootstrapStrategy = { bootstrap: async () => backup };
const failing = (e: unknown): BootstrapStrategy => ({ bootstrap: async () => { throw e; } });
const httpError = (status: number) => new AxiosError('rejected', 'ERR_BAD_REQUEST', undefined, undefined,
  { status, statusText: '', data: '', headers: {}, config: { headers: new AxiosHeaders() } });

describe('FallbackStrategy', () => {
  it('uses the backup when the server is unreachable', async () => {
    const unreachable = new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
    await expect(new FallbackStrategy(failing(unreachable), backupStrategy).bootstrap(['ns'])).resolves.toBe(backup);
  });

  it.each([401, 403])('fails on a %d instead of serving the backup', async (status) => {
    const rejected = httpError(status);
    await expect(new FallbackStrategy(failing(rejected), backupStrategy).bootstrap(['ns'])).rejects.toBe(rejected);
  });
});
