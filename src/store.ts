

import { FigFamily } from './models';

export class Store {
  // Map<namespace, Map<key, FigFamily>>
  private families: Map<string, Map<string, FigFamily>> = new Map();

  putAll(families: FigFamily[]): void {
    for (const family of families) {
      const ns = family.definition.namespace;
      const key = family.definition.key;

      if (!this.families.has(ns)) {
        this.families.set(ns, new Map());
      }
      this.families.get(ns)!.set(key, family);
    }
  }

  getFigFamily(namespace: string, key: string): FigFamily | undefined {
    return this.families.get(namespace)?.get(key);
  }

  findFigFamily(key: string): FigFamily | undefined {
    for (const nsMap of this.families.values()) {
        if (nsMap.has(key)) {return nsMap.get(key);}
    }
    return undefined;
  }
}
