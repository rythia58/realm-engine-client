import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import { WorldPosData } from '../../data/world-pos-data.js';
import { GroundTileData } from '../../data/ground-tile-data.js';
import { ObjectData } from '../../data/object-data.js';

/**
 * Full UPDATE (PyRelay) — required so the reader consumes the full payload
 * and we can read vault portal positions from `newObjs`.
 */
export class UpdatePacket extends Packet {
  readonly type = 'UPDATE';

  pos = new WorldPosData();
  levelType = 0;
  tiles: GroundTileData[] = [];
  newObjs: ObjectData[] = [];
  drops: number[] = [];
  /** Present on some protocol builds when extra trailer byte is sent. */
  unknownByte: number | undefined;

  read(reader: Reader): void {
    this.pos = new WorldPosData().read(reader);
    this.levelType = reader.readUInt8();
    const tilesLen = reader.readCompressedInt();
    this.tiles = new Array(tilesLen);
    for (let i = 0; i < tilesLen; i++) {
      this.tiles[i] = new GroundTileData().read(reader);
    }
    const objLen = reader.readCompressedInt();
    this.newObjs = new Array(objLen);
    for (let i = 0; i < objLen; i++) {
      this.newObjs[i] = new ObjectData().read(reader);
    }
    const dropsLen = reader.readCompressedInt();
    this.drops = new Array(dropsLen);
    for (let i = 0; i < dropsLen; i++) {
      this.drops[i] = reader.readCompressedInt();
    }
    if (reader.remaining > 0) {
      this.unknownByte = reader.readUInt8();
      // Consume any protocol extension bytes so the reader matches the full frame.
      if (reader.remaining > 0) {
        reader.skip(reader.remaining);
      }
    }
  }
}
