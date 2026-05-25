import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class ShootAckPacket extends Packet {
  readonly type = 'SHOOT_ACK';

  time = 0;
  ack = 0;

  read(reader: Reader): void {
    this.time = reader.readInt32();
    this.ack = reader.readInt16();
  }

  write(writer: Writer): void {
    writer.writeInt32(this.time);
    writer.writeInt16(this.ack);
  }
}

