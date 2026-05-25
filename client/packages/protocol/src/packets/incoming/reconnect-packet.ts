import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

export class ReconnectPacket extends Packet {
  readonly type = 'RECONNECT';

  name = '';
  host = '';
  port = 0;
  gameId = 0;
  keyTime = 0;
  key: Buffer = Buffer.alloc(0);

  read(reader: Reader): void {
    this.name = reader.readString();
    this.host = reader.readString();
    this.port = reader.readUnsignedShort();
    this.gameId = reader.readInt32();
    this.keyTime = reader.readInt32();
    this.key = reader.readByteArray();
  }
}

