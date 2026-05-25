import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';
import { MoveRecord } from '../../data/move-record.js';

export class MovePacket extends Packet {
  readonly type = 'MOVE';

  tickId = 0;
  time = 0;
  records: MoveRecord[] = [];

  read(reader: Reader): void {
    this.tickId = reader.readInt32();
    this.time = reader.readUnsignedInt();
    const count = reader.readInt16();
    this.records = new Array(count);
    for (let i = 0; i < count; i++) {
      this.records[i] = new MoveRecord().read(reader);
    }
  }

  write(writer: Writer): void {
    writer.writeInt32(this.tickId);
    writer.writeUnsignedInt(this.time);
    writer.writeInt16(this.records.length);
    for (const r of this.records) r.write(writer);
  }
}

