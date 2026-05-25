import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';
import { WorldPosData } from '../../data/world-pos-data.js';
import { SlotObjectData } from '../../data/slot-object-data.js';

export class InvSwapPacket extends Packet {
  readonly type = 'INVSWAP';

  time = 0;
  playerPos = new WorldPosData();
  slotObject1 = new SlotObjectData();
  slotObject2 = new SlotObjectData();

  read(reader: Reader): void {
    this.time = reader.readInt32();
    this.playerPos = new WorldPosData().read(reader);
    this.slotObject1 = new SlotObjectData().read(reader);
    this.slotObject2 = new SlotObjectData().read(reader);
  }

  write(writer: Writer): void {
    writer.writeInt32(this.time);
    this.playerPos.write(writer);
    this.slotObject1.write(writer);
    this.slotObject2.write(writer);
  }
}
