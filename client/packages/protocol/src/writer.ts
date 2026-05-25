export class Writer {
  private chunks: Buffer[] = [];

  reset(): void {
    this.chunks = [];
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  writeUInt8(v: number): void {
    const b = Buffer.allocUnsafe(1);
    b.writeUInt8(v & 0xff, 0);
    this.chunks.push(b);
  }

  writeInt16(v: number): void {
    const b = Buffer.allocUnsafe(2);
    b.writeInt16BE(v, 0);
    this.chunks.push(b);
  }

  writeUInt16(v: number): void {
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16BE(v, 0);
    this.chunks.push(b);
  }

  writeInt32(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeInt32BE(v, 0);
    this.chunks.push(b);
  }

  writeUInt32(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32BE(v, 0);
    this.chunks.push(b);
  }

  writeUnsignedInt(v: number): void {
    this.writeUInt32(v);
  }

  writeFloat(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeFloatBE(v, 0);
    this.chunks.push(b);
  }

  writeBoolean(v: boolean): void {
    this.writeUInt8(v ? 1 : 0);
  }

  writeBytes(bytes: Buffer | Uint8Array): void {
    this.chunks.push(Buffer.from(bytes));
  }

  writeByteArray(bytes: Buffer | Uint8Array): void {
    const b = Buffer.from(bytes);
    this.writeInt16(b.length);
    if (b.length > 0) this.writeBytes(b);
  }

  writeString(str: string): void {
    const b = Buffer.from(str ?? '', 'utf8');
    this.writeUInt16(b.length);
    if (b.length > 0) this.writeBytes(b);
  }

  writeCompressedInt(n: number): void {
    // RealmShark / RotMG CompressedInt writer (mirrors pyrelay Writer.writeCompressedInt)
    let uByte = 0;
    uByte |= 64 * (n < 0 ? 1 : 0);
    let value = Math.abs(n);
    uByte |= value & 63;
    value >>= 6;
    uByte |= 128 * (value > 0 ? 1 : 0);
    this.writeUInt8(uByte);
    while (value > 0) {
      let next = value & 127;
      value >>= 7;
      next |= 128 * (value > 0 ? 1 : 0);
      this.writeUInt8(next);
    }
  }
}

