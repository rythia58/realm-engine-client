import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class UsePortalPacket extends Packet {
  readonly type = 'USEPORTAL';

  objectId = 0;

  read(reader: Reader): void {
    this.objectId = reader.readInt32();
  }

  write(writer: Writer): void {
    writer.writeInt32(this.objectId);
  }
}
