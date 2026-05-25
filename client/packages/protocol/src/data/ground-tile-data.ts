import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';

/** Ground tile in UPDATE (PyRelay `GroundTileData`). */
export class GroundTileData {
  x = 0;
  y = 0;
  type = 0;

  read(reader: Reader): this {
    this.x = reader.readInt16();
    this.y = reader.readInt16();
    this.type = reader.readUInt16();
    return this;
  }

  write(writer: Writer): void {
    writer.writeInt16(this.x);
    writer.writeInt16(this.y);
    writer.writeUInt16(this.type);
  }
}
