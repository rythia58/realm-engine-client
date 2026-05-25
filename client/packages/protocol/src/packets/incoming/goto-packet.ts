import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import { WorldPosData } from '../../data/world-pos-data.js';

export class GotoPacket extends Packet {
  readonly type = 'GOTO';

  objectId = 0;
  position = new WorldPosData();
  unknownInt = 0;

  read(reader: Reader): void {
    this.objectId = reader.readInt32();
    this.position = new WorldPosData().read(reader);
    this.unknownInt = reader.readInt32();
  }
}

