import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

export class HelloPacket extends Packet {
  readonly type = 'HELLO';

  // Matches pyrelay-master's HELLO layout (Unity):
  // gameId, buildVersion, accessToken, keyTime, key,
  // userPlatform, playPlatform, platformToken, userToken, token
  buildVersion = '';
  gameId = 0;
  accessToken = '';
  keyTime = 0;
  key: Buffer = Buffer.alloc(0);
  userPlatform = '';
  playPlatform = '';
  platformToken = '';
  userToken = '';
  token = 'XQpu8CWkMehb5rLVP3DG47FcafExRUvg';

  read(reader: Reader): void {
    this.gameId = reader.readInt32();
    this.buildVersion = reader.readString();
    this.accessToken = reader.readString();
    this.keyTime = reader.readInt32();
    this.key = reader.readByteArray();
    this.userPlatform = reader.readString();
    this.playPlatform = reader.readString();
    this.platformToken = reader.readString();
    this.userToken = reader.readString();
    this.token = reader.readString();
  }

  write(writer: Writer): void {
    writer.writeInt32(this.gameId);
    writer.writeString(this.buildVersion);
    writer.writeString(this.accessToken);
    writer.writeInt32(this.keyTime);
    writer.writeByteArray(this.key);
    writer.writeString(this.userPlatform);
    writer.writeString(this.playPlatform);
    writer.writeString(this.platformToken);
    writer.writeString(this.userToken);
    writer.writeString(this.token);
  }
}

