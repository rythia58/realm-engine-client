import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import { TradeItemData } from '../../data/trade-item-data.js';

export class TradeStartPacket extends Packet {
  readonly type = 'TRADESTART';

  clientItems: TradeItemData[] = [];
  partnerName = '';
  partnerItems: TradeItemData[] = [];

  read(reader: Reader): void {
    const clientLen = reader.readInt16();
    this.clientItems = [];
    for (let i = 0; i < clientLen; i++) {
      this.clientItems.push(new TradeItemData().read(reader));
    }
    this.partnerName = reader.readString();
    const partnerLen = reader.readInt16();
    this.partnerItems = [];
    for (let i = 0; i < partnerLen; i++) {
      this.partnerItems.push(new TradeItemData().read(reader));
    }
  }
}
