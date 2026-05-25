import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';

export class WorldPosData {
  x = 0;
  y = 0;

  read(reader: Reader): this {
    this.x = reader.readFloat();
    this.y = reader.readFloat();
    return this;
  }

  write(writer: Writer): void {
    writer.writeFloat(this.x);
    writer.writeFloat(this.y);
  }
}

