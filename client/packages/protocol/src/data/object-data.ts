import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';
import { ObjectStatusData } from './object-status-data.js';

/** Static / dynamic entity in UPDATE `newObjs` (PyRelay `ObjectData`). */
export class ObjectData {
  objectType = 0;
  status = new ObjectStatusData();

  read(reader: Reader): this {
    this.objectType = reader.readUInt16();
    this.status = new ObjectStatusData().read(reader);
    return this;
  }

  write(writer: Writer): void {
    writer.writeUInt16(this.objectType);
    this.status.write(writer);
  }
}
