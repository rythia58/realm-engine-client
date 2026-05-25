import * as fs from 'node:fs';
import * as path from 'node:path';

export class Environment {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  pathTo(...rel: string[]): string {
    return path.join(this.root, ...rel);
  }

  readText(...rel: string[]): string | undefined {
    const p = this.pathTo(...rel);
    try {
      return fs.readFileSync(p, { encoding: 'utf8' });
    } catch (err: any) {
      if (err?.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  readJSON<T>(...rel: string[]): T | undefined {
    const txt = this.readText(...rel);
    if (txt === undefined) return undefined;
    return JSON.parse(txt) as T;
  }
}

