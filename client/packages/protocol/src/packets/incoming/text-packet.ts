import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class TextPacket extends Packet {
  readonly type = 'TEXT';
  name = '';
  objectId = -1;
  numStars = 0;
  bubbleTime = 0;
  recipient = '';
  text = '';
  cleanText = '';
  isSupporter = false;
  starBg = 0;

  read(reader: Reader): void {
    this.name = reader.readString();
    this.objectId = reader.readInt32();
    this.numStars = reader.readInt16();
    this.bubbleTime = reader.readUInt8();
    this.recipient = reader.readString();
    this.text = reader.readString();
    if (reader.remaining > 0) this.cleanText = reader.readString();
    if (reader.remaining > 0) this.isSupporter = reader.readBoolean();
    if (reader.remaining >= 4) this.starBg = reader.readInt32();
  }
}
