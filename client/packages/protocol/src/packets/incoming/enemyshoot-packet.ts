import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import { WorldPosData } from '../../data/world-pos-data.js';

export class EnemyShootPacket extends Packet {
  readonly type = 'ENEMYSHOOT';

  bulletId = 0;
  ownerId = 0;
  bulletType = 0;
  startingPos = new WorldPosData();
  angle = 0;
  damage = 0;
  numShots = 255;
  angleInc = 0;

  read(reader: Reader): void {
    this.bulletId = reader.readInt16();
    this.ownerId = reader.readInt32();
    this.bulletType = reader.readUInt8();
    this.startingPos = new WorldPosData().read(reader);
    this.angle = reader.readFloat();
    this.damage = reader.readInt16();
    if (reader.remaining > 0) {
      this.numShots = reader.readUInt8();
      this.angleInc = reader.readFloat();
    } else {
      this.numShots = 255;
      this.angleInc = 0;
    }
  }
}

