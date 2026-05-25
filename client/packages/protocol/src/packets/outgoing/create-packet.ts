import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class CreatePacket extends Packet {
  readonly type = 'CREATE';

  classType = 0;
  skinType = 0;
  isChallenger = false;
  isSeasonal = false;
  /** Added in current pyrelay protocol — send false to opt out of bonus character slot. */
  isBonus = false;

  read(reader: Reader): void {
    this.classType = reader.readInt16();
    this.skinType = reader.readInt16();
    this.isChallenger = reader.readBoolean();
    this.isSeasonal = reader.readBoolean();
    if (reader.remaining > 0) this.isBonus = reader.readBoolean();
  }

  write(writer: Writer): void {
    writer.writeInt16(this.classType);
    writer.writeInt16(this.skinType);
    writer.writeBoolean(this.isChallenger);
    writer.writeBoolean(this.isSeasonal);
    writer.writeBoolean(this.isBonus);
  }
}

