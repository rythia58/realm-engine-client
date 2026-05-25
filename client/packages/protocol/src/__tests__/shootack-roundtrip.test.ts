import { describe, expect, it } from 'vitest';
import { ShootAckPacket } from '../packets/outgoing/shootack-packet.js';
import { Reader } from '../reader.js';
import { Writer } from '../writer.js';

describe('ShootAckPacket', () => {
  it('round-trips time and ack', () => {
    const pkt = new ShootAckPacket();
    pkt.time = 123456;
    pkt.ack = 321;

    const w = new Writer();
    pkt.write(w);
    const buf = w.toBuffer();

    const r = new Reader();
    r.reset(buf);
    const read = new ShootAckPacket();
    read.read(r);

    expect(read.time).toBe(pkt.time);
    expect(read.ack).toBe(pkt.ack);
  });
});

