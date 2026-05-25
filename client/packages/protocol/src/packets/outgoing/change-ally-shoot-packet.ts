import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

/** PyRelay name `SHOWALLYSHOOT`; RealmShark / packet map: `CHANGE_ALLYSHOOT`. */
export class ChangeAllyShootPacket extends Packet {
  readonly type = 'CHANGE_ALLYSHOOT';

  /** 0 = off, 1 = on (ally projectiles). */
  toggle = 0;

  read(reader: Reader): void {
    this.toggle = reader.readInt32();
  }

  write(writer: Writer): void {
    writer.writeInt32(this.toggle);
  }
}
