import { describe, expect, it } from 'vitest';
import { HelloPacket } from '../packets/outgoing/hello-packet.js';
import { Reader } from '../reader.js';
import { Writer } from '../writer.js';

describe('HelloPacket', () => {
  it('round-trips fields', () => {
    const pkt = new HelloPacket();
    pkt.gameId = 123;
    pkt.buildVersion = '1.2.3';
    pkt.accessToken = 'abc';
    pkt.keyTime = 456;
    pkt.key = Buffer.from([1, 2, 3]);
    pkt.userPlatform = 'rotmg';
    pkt.playPlatform = 'rotmg';
    pkt.platformToken = '';
    pkt.userToken = 'user-token';
    pkt.token = 'XQpu8CWkMehb5rLVP3DG47FcafExRUvg';

    const w = new Writer();
    pkt.write(w);
    const buf = w.toBuffer();

    const read = new HelloPacket();
    const r = new Reader();
    r.reset(buf);
    read.read(r);

    expect(read.gameId).toBe(pkt.gameId);
    expect(read.buildVersion).toBe(pkt.buildVersion);
    expect(read.accessToken).toBe(pkt.accessToken);
    expect(read.keyTime).toBe(pkt.keyTime);
    expect(read.key.equals(pkt.key)).toBe(true);
    expect(read.userToken).toBe(pkt.userToken);
    expect(read.token).toBe(pkt.token);
  });
});

