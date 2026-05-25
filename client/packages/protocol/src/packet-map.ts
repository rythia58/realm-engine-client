export type PacketMap = Record<string, string>;

export function invertPacketMap(map: PacketMap): PacketMap {
  const out: PacketMap = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = v;
    out[v] = k;
  }
  return out;
}

