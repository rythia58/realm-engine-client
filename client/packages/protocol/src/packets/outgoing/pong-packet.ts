import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class PongPacket extends Packet {
  readonly type = 'PONG';

  serial = 0;
  time = 0;

  read(reader: Reader): void {
    this.serial = reader.readInt32();
    this.time = reader.readInt32();
  }

  write(writer: Writer): void {
    writer.writeInt32(this.serial);
    writer.writeInt32(this.time);
  }
}

