import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class FailurePacket extends Packet {
  readonly type = 'FAILURE';

  errorId = 0;
  errorDescription = '';

  read(reader: Reader): void {
    this.errorId = reader.readInt32();
    this.errorDescription = reader.readString();
  }
}

