import type { Reader } from './reader.js';
import type { Writer } from './writer.js';

export abstract class Packet {
  abstract readonly type: string;

  read(_reader: Reader): void {
    // Default: no fields.
  }

  write(_writer: Writer): void {
    // Default: no fields.
  }
}

export type PacketConstructor<T extends Packet = Packet> = new () => T;

