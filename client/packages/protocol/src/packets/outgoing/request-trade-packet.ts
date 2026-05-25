import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class RequestTradePacket extends Packet {
  readonly type = 'REQUESTTRADE';
  name = '';

  read(_reader: Reader): void {}

  write(writer: Writer): void {
    writer.writeString(this.name);
  }
}
