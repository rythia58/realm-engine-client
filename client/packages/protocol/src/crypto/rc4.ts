// Keys taken from abrn/realmlib reference (Unity-era).
// Update these if RealmShark keys differ for your targeted build.
export const OUTGOING_KEY = '5a4d2016bc16dc64883194ffd9';
export const INCOMING_KEY = 'c91d9eec420160730d825604e0';

export class RC4 {
  private i = 0;
  private j = 0;
  private readonly s: number[] = new Array(256);

  constructor(keyHex: string) {
    const key = Buffer.from(keyHex, 'hex');
    for (let i = 0; i < 256; i++) this.s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + this.s[i] + key[i % key.length]) & 0xff;
      const tmp = this.s[i];
      this.s[i] = this.s[j];
      this.s[j] = tmp;
    }
  }

  reset(): void {
    // Keys drift historically; for now, construct new RC4 for a reset.
    // This is intentionally left as a no-op because callers create fresh instances per connection.
    this.i = 0;
    this.j = 0;
  }

  process(data: Buffer): Buffer {
    const out = Buffer.allocUnsafe(data.length);
    for (let k = 0; k < data.length; k++) {
      this.i = (this.i + 1) & 0xff;
      this.j = (this.j + this.s[this.i]) & 0xff;
      const tmp = this.s[this.i];
      this.s[this.i] = this.s[this.j];
      this.s[this.j] = tmp;
      const t = (this.s[this.i] + this.s[this.j]) & 0xff;
      const keyByte = this.s[t];
      out[k] = data[k] ^ keyByte;
    }
    return out;
  }
}

