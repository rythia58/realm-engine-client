import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';

// DECA CompressedInt (varint zigzag-ish) used in newer Unity packets.
export function readCompressedInt(reader: Reader): number {
  let uByte = reader.readUnsignedByte();
  const isNegative = (uByte & 64) !== 0;
  let shift = 6;
  let value = uByte & 63;
  while ((uByte & 128) !== 0) {
    uByte = reader.readUnsignedByte();
    value |= (uByte & 127) << shift;
    shift += 7;
  }
  return isNegative ? -value : value;
}

export function writeCompressedInt(writer: Writer, n: number): void {
  let uByte = 0;
  uByte |= 64 * (n < 0 ? 1 : 0);
  let value = Math.abs(n);
  uByte |= value & 63;
  value >>= 6;
  uByte |= 128 * (value > 0 ? 1 : 0);
  writer.writeUInt8(uByte);
  while (value > 0) {
    let next = value & 127;
    value >>= 7;
    next |= 128 * (value > 0 ? 1 : 0);
    writer.writeUInt8(next);
  }
}

