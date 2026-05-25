import { Packet, type PacketConstructor } from './packet.js';

export type PacketRegistry = Record<string, PacketConstructor>;

export class RawPacket extends Packet {
  readonly type: string;
  raw: Buffer = Buffer.alloc(0);

  constructor(type: string) {
    super();
    this.type = type;
  }

  read(reader: import('./reader.js').Reader): void {
    this.raw = reader.readRemaining();
  }

  write(writer: import('./writer.js').Writer): void {
    writer.writeBytes(this.raw);
  }
}

export function createPacket(type: string, registry: PacketRegistry): Packet {
  const Ctor = registry[type];
  if (!Ctor) return new RawPacket(type);
  return new Ctor();
}

