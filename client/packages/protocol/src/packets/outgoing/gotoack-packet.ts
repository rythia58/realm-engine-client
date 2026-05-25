import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class GotoAckPacket extends Packet {
  readonly type = 'GOTOACK';

  time = 0;
  reset = false;

  read(reader: Reader): void {
    this.time = reader.readInt32();
    this.reset = reader.readBoolean();
  }

  write(writer: Writer): void {
    writer.writeInt32(this.time);
    writer.writeBoolean(this.reset);
  }
}

