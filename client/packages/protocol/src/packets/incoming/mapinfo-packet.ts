import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class MapInfoPacket extends Packet {
  readonly type = 'MAPINFO';

  width = 0;
  height = 0;
  name = '';
  displayName = '';
  realmName = '';
  fp = 0;
  seed = 0;
  background = 0;
  difficulty = 0;
  allowPlayerTeleport = false;
  noSave = false;
  showDisplays = false;
  maxPlayerCount = 0;
  gameOpenedTime = 0;
  versionNumber = '';
  unknown1 = 0;
  viewDistance = 0;
  unknown2 = false;
  unknownInt = 0;
  modifiersRaw = '';
  bgColor = 0;
  maxRealmScore = -1;
  currentRealmScore = -1;

  read(reader: Reader): void {
    this.width = reader.readInt32();
    this.height = reader.readInt32();
    this.name = reader.readString();
    this.displayName = reader.readString();
    this.realmName = reader.readString();
    this.fp = reader.readInt32();
    this.seed = this.fp;
    this.background = reader.readInt32();
    this.difficulty = reader.readFloat();
    this.allowPlayerTeleport = reader.readBoolean();
    this.noSave = reader.readBoolean();
    this.showDisplays = reader.readBoolean();
    this.maxPlayerCount = reader.readInt16();
    this.gameOpenedTime = reader.readInt32();
    this.versionNumber = reader.readString();
    this.unknown1 = reader.readInt16();
    this.viewDistance = reader.readInt16();
    this.unknown2 = reader.readBoolean();
    this.unknownInt = reader.readInt32();
    this.modifiersRaw = reader.readString();
    this.bgColor = reader.readInt16();
    if (reader.remaining >= 8) {
      this.maxRealmScore = reader.readInt32();
      this.currentRealmScore = reader.readInt32();
    }
  }
}

