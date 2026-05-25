import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

/** Response to CREATE; matches PyRelay / RealmShark `CreateSuccessPacket`. */
export class CreateSuccessPacket extends Packet {
  readonly type = 'CREATE_SUCCESS';

  objectId = 0;
  charId = 0;
  /** Player stats XML string (PyRelay: `PCStats`). */
  stats = '';

  read(reader: Reader): void {
    this.objectId = reader.readInt32();
    this.charId = reader.readInt32();
    this.stats = reader.readString();
  }
}
