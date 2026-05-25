import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class TradeChangedPacket extends Packet {
  readonly type = 'TRADECHANGED';
  offer: boolean[] = [];

  read(reader: Reader): void {
    const len = reader.readInt16();
    this.offer = [];
    for (let i = 0; i < len; i++) {
      this.offer.push(reader.readBoolean());
    }
  }
}
