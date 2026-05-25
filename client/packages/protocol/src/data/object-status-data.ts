import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';
import { StatData } from './stat-data.js';
import { WorldPosData } from './world-pos-data.js';

export class ObjectStatusData {
  objectId = 0;
  pos = new WorldPosData();
  stats: StatData[] = [];

  read(reader: Reader): this {
    this.objectId = reader.readCompressedInt();
    this.pos = new WorldPosData().read(reader);
    const count = reader.readCompressedInt();
    this.stats = new Array(count);
    for (let i = 0; i < count; i++) {
      this.stats[i] = new StatData().read(reader);
    }
    return this;
  }

  write(writer: Writer): void {
    writer.writeCompressedInt(this.objectId);
    this.pos.write(writer);
    writer.writeCompressedInt(this.stats.length);
    for (const s of this.stats) s.write(writer);
  }
}

