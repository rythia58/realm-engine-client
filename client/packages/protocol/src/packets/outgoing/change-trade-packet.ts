import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class ChangeTradePacket extends Packet {
  readonly type = 'CHANGETRADE';
  offer: boolean[] = [];

  read(_reader: Reader): void {}

  write(writer: Writer): void {
    writer.writeInt16(this.offer.length);
    for (const v of this.offer) writer.writeBoolean(v);
  }
}
