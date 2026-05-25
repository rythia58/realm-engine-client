import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class EscapePacket extends Packet {
  readonly type = 'ESCAPE';
  read(_reader: Reader): void {}
  write(_writer: Writer): void {}
}
