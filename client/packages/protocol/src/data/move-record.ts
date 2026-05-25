import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';
import { WorldPosData } from './world-pos-data.js';

export class MoveRecord {
  time = 0;
  pos = new WorldPosData();

  read(reader: Reader): this {
    this.time = reader.readInt32();
    this.pos = new WorldPosData().read(reader);
    return this;
  }

  write(writer: Writer): void {
    writer.writeInt32(this.time);
    this.pos.write(writer);
  }
}

