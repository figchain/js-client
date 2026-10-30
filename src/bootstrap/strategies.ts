
import { Transport, isAuthFailure } from '../transport';
import { S3BackupService } from './s3';
import { FigFamily } from '../models';

export interface BootstrapResult {
  figFamilies: FigFamily[];
  cursors: Record<string, string>;
  schemas: Record<string, string>;
}

export interface BootstrapStrategy {
  bootstrap(namespaces: string[]): Promise<BootstrapResult>;
}

export class ServerStrategy implements BootstrapStrategy {
  constructor(private transport: Transport, private asOf?: string) {}

  async bootstrap(namespaces: string[]): Promise<BootstrapResult> {
    const families: FigFamily[] = [];
    const cursors: Record<string, string> = {};
    const schemas: Record<string, string> = {};

    await Promise.all(namespaces.map(async (ns) => {
      try {
        const resp = await this.transport.fetchInitial(ns, this.asOf);
        families.push(...resp.figFamilies);
        cursors[ns] = resp.cursor;
        if (resp.schemas) {
            Object.assign(schemas, resp.schemas);
        }
      } catch (e) {
        console.error(`Failed to bootstrap namespace ${ns} from server:`, e);
        throw e;
      }
    }));

    return { figFamilies: families, cursors, schemas };
  }
}

export class S3BackupStrategyImpl implements BootstrapStrategy {
  constructor(private service: S3BackupService) {}

  async bootstrap(namespaces: string[]): Promise<BootstrapResult> {
    const res = await this.service.loadBackup();
    const families = res.families.filter(f => namespaces.includes(f.definition.namespace));
    
    // S3 backup provides single sync token, apply to all namespaces
    const cursors: Record<string, string> = {};
    if (res.cursor) {
        for (const ns of namespaces) {
            cursors[ns] = res.cursor;
        }
    }

    return { figFamilies: families, cursors, schemas: res.schemas ?? {} };
  }
}

// Bounds the hybrid catch-up loop.
const MAX_CATCH_UP_PAGES = 1000;

export class HybridStrategy implements BootstrapStrategy {
  constructor(
      private s3Strategy: BootstrapStrategy,
      private serverStrategy: BootstrapStrategy,
      private transport: Pick<Transport, 'fetchUpdates'>
  ) {}

  async bootstrap(namespaces: string[]): Promise<BootstrapResult> {
      // Load S3 first
      let s3Result: BootstrapResult;
      try {
          s3Result = await this.s3Strategy.bootstrap(namespaces);
      } catch (e) {
          console.warn("Hybrid bootstrap: S3 failed, falling back to server full", e);
          return this.serverStrategy.bootstrap(namespaces);
      }

      // Catch up from the backup's cursors before returning, so init() doesn't resolve with
      // stale values. The server returns changes a page at a time, so keep fetching until the
      // cursor stops advancing.
      const families = [...s3Result.figFamilies];
      const cursors = { ...s3Result.cursors };
      const schemas = { ...s3Result.schemas };
      for (const ns of namespaces) {
          let cursor = cursors[ns];
          if (!cursor) {
              continue;
          }
          try {
              for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
                  const resp = await this.transport.fetchUpdates(ns, cursor);
                  families.push(...resp.figFamilies);
                  Object.assign(schemas, resp.schemas ?? {});
                  if (resp.cursor) {
                      cursors[ns] = resp.cursor;
                  }
                  if (!resp.cursor || resp.cursor === cursor || resp.figFamilies.length === 0) {
                      break;
                  }
                  cursor = resp.cursor;
              }
          } catch (e) {
              console.warn(`Hybrid bootstrap: catch-up failed for ${ns}, polling will retry`, e);
          }
      }
      return { figFamilies: families, cursors, schemas };
  }
}

export class FallbackStrategy implements BootstrapStrategy {
    constructor(
        private primary: BootstrapStrategy,
        private secondary: BootstrapStrategy
    ) {}

    async bootstrap(namespaces: string[]): Promise<BootstrapResult> {
        try {
            return await this.primary.bootstrap(namespaces);
        } catch (e) {
            // A rejected credential is a configuration error, not an outage. Serving the
            // backup would hide it while every later update fails the same way.
            if (isAuthFailure(e)) {throw e;}
            console.warn("Primary bootstrap failed, trying secondary", e);
            return await this.secondary.bootstrap(namespaces);
        }
    }
}
