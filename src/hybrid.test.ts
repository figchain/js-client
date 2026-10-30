import { HybridStrategy, BootstrapStrategy } from './bootstrap/strategies';
import { FigFamily, UpdateFetchResponse } from './models';

const family = (version: string) => ({ definition: { namespace: 'ns', key: 'k' }, figs: [{ version }] } as unknown as FigFamily);

describe('HybridStrategy', () => {
  it('catches up through every page after loading the backup', async () => {
    const s3: BootstrapStrategy = { bootstrap: async () => ({ figFamilies: [family('v1')], cursors: { ns: 'c1' }, schemas: {} }) };
    const server: BootstrapStrategy = { bootstrap: async () => { throw new Error('not used'); } };
    // One change per call, like the server does
    const pages: Record<string, UpdateFetchResponse> = {
      c1: { figFamilies: [family('v2')], cursor: 'c2' },
      c2: { figFamilies: [family('v3')], cursor: 'c3' },
      c3: { figFamilies: [], cursor: 'c3' },
    };
    const transport = { fetchUpdates: jest.fn(async (_ns: string, cursor: string) => pages[cursor]) };

    const res = await new HybridStrategy(s3, server, transport).bootstrap(['ns']);

    expect(res.figFamilies.map(f => f.figs[0].version)).toEqual(['v1', 'v2', 'v3']);
    expect(res.cursors).toEqual({ ns: 'c3' });
    expect(transport.fetchUpdates).toHaveBeenCalledTimes(3);
  });
});
