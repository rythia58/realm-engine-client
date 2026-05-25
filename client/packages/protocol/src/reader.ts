export class Reader {
  private buf: Buffer = Buffer.alloc(0);
  private idx = 0;

  reset(buffer: Buffer, offset = 0): void {
    this.buf = buffer;
    this.idx = offset;
  }

  get offset(): number {
    return this.idx;
  }

  get remaining(): number {
    return Math.max(0, this.buf.length - this.idx);
  }

  skip(n: number): void {
    this.idx = Math.min(this.buf.length, this.idx + n);
  }

  readUInt8(): number {
    const v = this.buf.readUInt8(this.idx);
    this.idx += 1;
    return v;
  }

  readUnsignedByte(): number {
    return this.readUInt8();
  }

  readInt16(): number {
    const v = this.buf.readInt16BE(this.idx);
    this.idx += 2;
    return v;
  }

  readUInt16(): number {
    const v = this.buf.readUInt16BE(this.idx);
    this.idx += 2;
    return v;
  }

  readUnsignedShort(): number {
    return this.readUInt16();
  }

  readInt32(): number {
    const v = this.buf.readInt32BE(this.idx);
    this.idx += 4;
    return v;
  }

  readUInt32(): number {
    const v = this.buf.readUInt32BE(this.idx);
    this.idx += 4;
    return v;
  }

  readUnsignedInt(): number {
    return this.readUInt32();
  }

  readFloat(): number {
    const v = this.buf.readFloatBE(this.idx);
    this.idx += 4;
    return v;
  }

  readBoolean(): boolean {
    return this.readUInt8() !== 0;
  }

  readBytes(length: number): Buffer {
    const end = Math.min(this.buf.length, this.idx + length);
    const slice = this.buf.subarray(this.idx, end);
    this.idx = end;
    return slice;
  }

  readByteArray(): Buffer {
    const len = this.readInt16();
    if (len <= 0) return Buffer.alloc(0);
    return this.readBytes(len);
  }

  readString(): string {
    const len = this.readUInt16();
    if (len === 0) return '';
    const bytes = this.readBytes(len);
    return bytes.toString('utf8');
  }

  readRemaining(): Buffer {
    return this.readBytes(this.remaining);
  }

  readCompressedInt(): number {
    // RealmShark / RotMG CompressedInt:
    // first byte: [continuation(1) | sign(1) | 6 bits payload]
    // next bytes: [continuation(1) | 7 bits payload]
    let uByte = this.readUnsignedByte();
    const isNegative = (uByte & 64) !== 0;
    let shift = 6;
    let value = uByte & 63;
    while ((uByte & 128) !== 0) {
      uByte = this.readUnsignedByte();
      value |= (uByte & 127) << shift;
      shift += 7;
    }
    return isNegative ? -value : value;
  }
}

