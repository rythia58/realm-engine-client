import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class PlayerTextPacket extends Packet {
  readonly type = 'PLAYERTEXT';
  text = '';

  read(reader: Reader): void {
    this.text = reader.readString();
  }

  write(writer: Writer): void {
    writer.writeString(this.text);
  }
}

