import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class TradeRequestedPacket extends Packet {
  readonly type = 'TRADEREQUESTED';
  name = '';

  read(reader: Reader): void {
    this.name = reader.readString();
  }
}
