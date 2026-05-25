import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import { WorldPosData } from '../../data/world-pos-data.js';

export class ServerPlayerShootPacket extends Packet {
  readonly type = 'SERVERPLAYERSHOOT';

  bulletId = 0;
  ownerId = 0;
  containerType = 0;
  startingPos = new WorldPosData();
  angle = 0;
  damage = 0;
  summonerId = 0;
  bulletType = 0;
  bulletCount = 0;
  anglesBetweenBullets = 0;

  read(reader: Reader): void {
    this.bulletId = reader.readInt16();
    this.ownerId = reader.readInt32();
    this.containerType = reader.readInt32();
    this.startingPos = new WorldPosData().read(reader);
    this.angle = reader.readFloat();
    this.damage = reader.readInt16();
    this.summonerId = reader.readInt32();

    if (reader.remaining > 0) {
      this.bulletType = reader.readUInt8();
      if (reader.remaining > 0) {
        this.bulletCount = reader.readUInt8();
        if (reader.remaining > 0) {
          this.anglesBetweenBullets = reader.readFloat();
        }
      }
    }
  }
}

