import { AxiosError, AxiosHeaders } from 'axios';
import { FigChainClient } from './client';
import { Config } from './config';
import { Transport, isTransitFailure, LONG_POLL_TIMEOUT_HEADER } from './transport';
import { SharedSecretTokenProvider } from './auth';

type Outcome = Error | null;

/** Records each request's wait and answers from a script (null = empty success). */
class FakeTransport {
  waits: number[] = [];
  constructor(private script: Outcome[], private onDone: () => void) {}

  async fetchUpdates(_ns: string, _cursor: string, waitSeconds = 0) {
    this.waits.push(waitSeconds);
    const outcome = this.script.shift() ?? null;
    if (this.script.length === 0) {this.onDone();}
    if (outcome) {throw outcome;}
    return { figFamilies: [], cursor: '' };
  }
}

const transitError = () => new AxiosError('timeout of 35000ms exceeded', 'ECONNABORTED');
const serverError = () => new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE',
  undefined, undefined,
  { status: 500, statusText: 'Internal Server Error', data: null, headers: {}, config: { headers: new AxiosHeaders() } });

async function runPoller(useLongPolling: boolean, script: Outcome[]): Promise<number[]> {
  const client = Object.create(FigChainClient.prototype) as FigChainClient;
  const internals = client as unknown as Record<string, unknown>;
  const config = new Config({ environmentId: 'env', useLongPolling, pollInterval: 0.001 });

  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const fake = new FakeTransport(script, () => { internals.isShutdown = true; finish(); });

  Object.assign(internals, {
    config,
    transport: fake,
    isShutdown: false,
    namespaceCursors: new Map<string, string>(),
    pollerTimeouts: new Set(),
  });
  (internals.pollNamespace as (ns: string) => void).call(client, 'ns');
  await finished;
  return fake.waits;
}

describe('poll loop', () => {
  beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
  afterEach(() => { jest.restoreAllMocks(); });

  it('long polling asks the server to wait', async () => {
    expect(await runPoller(true, [null, null, null])).toEqual([30, 30, 30]);
  });

  it('plain polling does not wait', async () => {
    expect(await runPoller(false, [null, null, null])).toEqual([0, 0, 0]);
  });

  it('falls back to polling after repeated transit failures', async () => {
    const waits = await runPoller(true, [transitError(), transitError(), transitError(), null, null]);
    expect(waits).toEqual([30, 30, 30, 0, 0]);
  });

  it('server errors do not trigger the fallback', async () => {
    const waits = await runPoller(true, [serverError(), serverError(), serverError(), serverError(), null]);
    expect(waits).toEqual([30, 30, 30, 30, 30]);
  });

  it('classifies transit vs server failures', () => {
    expect(isTransitFailure(transitError())).toBe(true);
    expect(isTransitFailure(serverError())).toBe(false);
    expect(isTransitFailure(new Error('other'))).toBe(false);
  });
});

describe('Transport.fetchUpdates', () => {
  it('sends the long-poll header and a matching timeout only when waiting', async () => {
    const transport = new Transport('http://api', new SharedSecretTokenProvider('secret'), 'env');
    const post = jest.fn().mockRejectedValue(new Error('stop'));
    (transport as unknown as { client: { post: typeof post } }).client.post = post;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(transport.fetchUpdates('ns', 'c', 30)).rejects.toThrow('stop');
    await expect(transport.fetchUpdates('ns', 'c')).rejects.toThrow('stop');

    const [longPoll, immediate] = post.mock.calls.map(call => call[2]);
    expect(longPoll.headers[LONG_POLL_TIMEOUT_HEADER]).toBe('30');
    expect(longPoll.timeout).toBe(35000);
    expect(immediate.headers[LONG_POLL_TIMEOUT_HEADER]).toBeUndefined();
    expect(immediate.timeout).toBe(5000);
  });
});

describe('Config', () => {
  it('reads FIGCHAIN_POLLING_INTERVAL_MS as milliseconds', () => {
    process.env.FIGCHAIN_POLLING_INTERVAL_MS = '15000';
    try {
      expect(Config.load().pollInterval).toBe(15);
    } finally {
      delete process.env.FIGCHAIN_POLLING_INTERVAL_MS;
    }
  });
});
