import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import { SlotObjectData } from '../../data/slot-object-data.js';

/** ID 95 — server confirmation of an INVSWAP. */
export class InvResultPacket extends Packet {
  readonly type = 'INVRESULT';

  unknownBool = false;
  unknownByte = 0;
  fromSlot = new SlotObjectData();
  toSlot = new SlotObjectData();

  read(reader: Reader): void {
    this.unknownBool = reader.readBoolean();
    this.unknownByte = reader.readUInt8();
    this.fromSlot = new SlotObjectData().read(reader);
    this.toSlot = new SlotObjectData().read(reader);
    if (reader.remaining > 0) reader.skip(reader.remaining);
  }
}
