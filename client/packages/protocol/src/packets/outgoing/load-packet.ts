import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import type { Writer } from '../../writer.js';

/**
 * Outgoing LOAD after MAPINFO. Matches PyRelay `LoadPacket.py`: int32 charId + bool isFromArena
 * (default false when only `charId` is set in the client).
 */
export class LoadPacket extends Packet {
  readonly type = 'LOAD';

  charId = 0;
  isFromArena = false;

  read(reader: Reader): void {
    this.charId = reader.readInt32();
    this.isFromArena = reader.readBoolean();
  }

  write(writer: Writer): void {
    writer.writeInt32(this.charId);
    writer.writeBoolean(this.isFromArena);
  }
}
