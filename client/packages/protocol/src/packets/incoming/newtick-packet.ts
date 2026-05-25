import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';
import { ObjectStatusData } from '../../data/object-status-data.js';

export class NewTickPacket extends Packet {
  readonly type = 'NEWTICK';

  tickId = 0;
  tickTime = 0;
  serverRealTimeMS = 0;
  serverLastTimeRTTMS = 0;
  status: ObjectStatusData[] = [];

  read(reader: Reader): void {
    this.tickId = reader.readInt32();
    this.tickTime = reader.readInt32();
    this.serverRealTimeMS = reader.readUnsignedInt();
    this.serverLastTimeRTTMS = reader.readUnsignedShort();
    const count = reader.readInt16();
    this.status = new Array(count);
    for (let i = 0; i < count; i++) {
      this.status[i] = new ObjectStatusData().read(reader);
    }
  }
}

