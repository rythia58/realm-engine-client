import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class PingPacket extends Packet {
  readonly type = 'PING';
  serial = 0;

  read(reader: Reader): void {
    this.serial = reader.readInt32();
  }
}

