import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class TradeDonePacket extends Packet {
  readonly type = 'TRADEDONE';
  /** 0 = Successful, 1 = PlayerCancelled */
  code = 0;
  description = '';

  read(reader: Reader): void {
    this.code = reader.readInt32();
    this.description = reader.readString();
  }
}
