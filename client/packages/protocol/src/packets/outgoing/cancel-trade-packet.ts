import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class CancelTradePacket extends Packet {
  readonly type = 'CANCELTRADE';
  read(_reader: Reader): void {}
  write(_writer: Writer): void {}
}
