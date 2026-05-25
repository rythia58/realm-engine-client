import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

/** NOTIFICATION (id 67). Variable layout based on typeValue.
 *  We capture typeValue + the raw remaining payload so callers can decode further. */
export class NotificationPacket extends Packet {
  readonly type = 'NOTIFICATION';
  typeValue = 0;
  textByte = 0;
  /** Remaining bytes after the two header bytes. */
  raw: Buffer = Buffer.alloc(0);
  /** Best-effort decoded text — server often follows the header with a length-prefixed string. */
  decodedText = '';

  read(reader: Reader): void {
    this.typeValue = reader.readUInt8();
    this.textByte = reader.readUInt8();
    this.raw = reader.readRemaining();
    // Best effort: try to decode the raw bytes as a length-prefixed UTF-8 string,
    // which is the most common shape in practice.
    if (this.raw.length >= 2) {
      try {
        const len = this.raw.readUInt16BE(0);
        if (len > 0 && len <= this.raw.length - 2) {
          this.decodedText = this.raw.subarray(2, 2 + len).toString('utf8');
        }
      } catch {
        this.decodedText = '';
      }
    }
  }
}
