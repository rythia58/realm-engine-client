import { EventEmitter } from 'events';
import type { Socket } from 'net';
import { RC4, INCOMING_KEY, OUTGOING_KEY } from './crypto/rc4.js';
import type { Packet } from './packet.js';
import type { PacketMap } from './packet-map.js';
import { Reader } from './reader.js';
import { Writer } from './writer.js';
import type { PacketRegistry } from './registry.js';
import { createPacket } from './registry.js';
import { BIDIR_PACKET_MAP } from './generated/packet-map.js';

export interface RC4Config {
  incomingKey: string;
  outgoingKey: string;
}

export const DEFAULT_RC4: RC4Config = {
  incomingKey: INCOMING_KEY,
  outgoingKey: OUTGOING_KEY
};

export class PacketIO extends EventEmitter {
  socket: Socket | undefined;
  packetMap: PacketMap;
  registry: PacketRegistry;

  private readonly reader = new Reader();
  private readonly writer = new Writer();
  private sendRC4: RC4;
  private recvRC4: RC4;

  private recvBuffer: Buffer = Buffer.alloc(0);

  constructor(opts: { socket?: Socket; rc4?: RC4Config; packetMap?: PacketMap; registry?: PacketRegistry } = {}) {
    super();
    const rc4 = opts.rc4 ?? DEFAULT_RC4;
    this.sendRC4 = new RC4(rc4.outgoingKey);
    this.recvRC4 = new RC4(rc4.incomingKey);
    this.packetMap = opts.packetMap ?? BIDIR_PACKET_MAP;
    this.registry = opts.registry ?? {};
    if (opts.socket) this.attach(opts.socket);
  }

  attach(socket: Socket): void {
    this.socket = socket;
    socket.on('data', (data) => this.onData(data));
    socket.on('close', () => this.emit('close'));
    socket.on('error', (err) => this.emit('socketError', err));
  }

  detach(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('close');
    this.socket.removeAllListeners('error');
    this.socket = undefined;
  }

  send(packet: Packet): void {
    if (!this.socket) throw new Error('PacketIO has no attached socket');
    const type = packet.type;
    const idStr = this.packetMap[type];
    if (idStr === undefined) throw new Error(`Unknown packet type: ${type}`);
    const packetId = Number(idStr);

    this.writer.reset();
    packet.write(this.writer);
    const body = this.writer.toBuffer();
    const header = Buffer.allocUnsafe(5);
    header.writeInt32BE(body.length + 5, 0);
    header.writeUInt8(packetId & 0xff, 4);
    const encrypted = this.sendRC4.process(body);
    this.emit('packetSent', { type, id: packetId, payload: body });
    this.socket.write(Buffer.concat([header, encrypted]));
  }

  private onData(data: Buffer): void {
    this.recvBuffer = this.recvBuffer.length === 0 ? data : Buffer.concat([this.recvBuffer, data]);

    while (this.recvBuffer.length >= 5) {
      const size = this.recvBuffer.readInt32BE(0);
      if (size < 5) {
        // desync; drop buffer
        this.recvBuffer = Buffer.alloc(0);
        return;
      }
      if (this.recvBuffer.length < size) return;

      const frame = this.recvBuffer.subarray(0, size);
      this.recvBuffer = this.recvBuffer.subarray(size);

      const id = frame.readUInt8(4);
      const type = this.packetMap[String(id)] ?? `UNKNOWN_${id}`;
      const payloadEncrypted = frame.subarray(5);
      const payload = this.recvRC4.process(payloadEncrypted);

      const pkt = createPacket(type, this.registry);
      try {
        this.reader.reset(payload, 0);
        pkt.read(this.reader);
      } catch (err) {
        this.emit('packetError', { type, id, err });
      }
      this.emit('packetRaw', { type, id, payload });
      this.emit('packet', pkt);
      this.emit(type, pkt);
    }
  }
}

