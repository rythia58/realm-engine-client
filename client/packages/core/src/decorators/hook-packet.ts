import 'reflect-metadata';
import { registerPacketHook } from '../core/hooks.js';

export function PacketHook(packetType: string): MethodDecorator {
  return (target, key) => {
    registerPacketHook({
      target: target.constructor.name,
      method: key.toString(),
      packet: packetType
    });
  };
}

