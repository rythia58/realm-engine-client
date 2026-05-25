import { Packet } from '../../packet.js';

export class UpdateAckPacket extends Packet {
  readonly type = 'UPDATEACK';
}

