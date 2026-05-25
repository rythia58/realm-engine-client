import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';

export class SlotObjectData {
  objectId = 0;
  slotId = 0;
  objectType = -1;

  read(reader: Reader): this {
    this.objectId = reader.readInt32();
    this.slotId = reader.readInt32();
    this.objectType = reader.readInt32();
    return this;
  }

  write(writer: Writer): void {
    writer.writeInt32(this.objectId);
    writer.writeInt32(this.slotId);
    writer.writeInt32(this.objectType);
  }
}
