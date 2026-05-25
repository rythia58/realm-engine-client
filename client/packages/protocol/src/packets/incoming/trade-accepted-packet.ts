import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

/** Incoming: server notifies us that the trade partner accepted (ID 14). */
export class TradeAcceptedPacket extends Packet {
  readonly type = 'TRADEACCEPTED';
  clientOffer: boolean[] = [];
  partnerOffer: boolean[] = [];

  read(reader: Reader): void {
    const clientLen = reader.readInt16();
    this.clientOffer = [];
    for (let i = 0; i < clientLen; i++) {
      this.clientOffer.push(reader.readBoolean());
    }
    const partnerLen = reader.readInt16();
    this.partnerOffer = [];
    for (let i = 0; i < partnerLen; i++) {
      this.partnerOffer.push(reader.readBoolean());
    }
  }
}
