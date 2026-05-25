import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class AcceptTradePacket extends Packet {
  readonly type = 'ACCEPTTRADE';
  clientOffer: boolean[] = [];
  partnerOffer: boolean[] = [];

  read(_reader: Reader): void {}

  write(writer: Writer): void {
    writer.writeInt16(this.clientOffer.length);
    for (const v of this.clientOffer) writer.writeBoolean(v);
    writer.writeInt16(this.partnerOffer.length);
    for (const v of this.partnerOffer) writer.writeBoolean(v);
  }
}
