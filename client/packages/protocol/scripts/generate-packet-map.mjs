import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), 'packages', 'protocol');
const packetTypeJava = process.env.REALMSHARK_PACKETTYPE_JAVA
  ?? 'C:\\\\Users\\\\trump\\\\Desktop\\\\References\\\\RealmShark-realmshark\\\\src\\\\main\\\\java\\\\packets\\\\PacketType.java';

const javaText = fs.readFileSync(packetTypeJava, 'utf8');

// Matches lines like:  HELLO( 74, Outgoing, HelloPacket::new),
const re = /^\s*([A-Z0-9_]+)\(\s*([0-9]+)\s*,\s*(Incoming|Outgoing)\s*,/gm;

/** @type {Record<string,string>} */
const byId = {};
/** @type {Record<string,'Incoming'|'Outgoing'>} */
const directionByName = {};

for (const m of javaText.matchAll(re)) {
  const name = m[1];
  const id = m[2];
  const dir = m[3];
  byId[id] = name;
  directionByName[name] = dir;
}

const entries = Object.entries(byId)
  .map(([id, name]) => [Number(id), name])
  .sort((a, b) => a[0] - b[0]);

const outObjLines = entries.map(([id, name]) => `  "${id}": "${name}",`);

const outPath = path.join(repoRoot, 'src', 'generated', 'packet-map.ts');
const names = [...new Set(Object.values(byId))].sort();
const packetTypeEnumLines = names.map((n) => `  ${n} = "${n}",`);
const directionLines = names.map((n) => `  ${n}: "${directionByName[n]}",`);

const file = `import type { PacketMap } from '../packet-map.js';\nimport { invertPacketMap } from '../packet-map.js';\n\n// AUTO-GENERATED from RealmShark PacketType.java\n// Source: ${packetTypeJava.replace(/\\/g, '\\\\')}\nexport const PACKET_MAP: PacketMap = {\n${outObjLines.join('\n')}\n};\n\nexport const BIDIR_PACKET_MAP: PacketMap = invertPacketMap(PACKET_MAP);\n\nexport enum PacketType {\n${packetTypeEnumLines.join('\n')}\n}\n\nexport const PACKET_DIRECTION: Record<PacketType, "Incoming" | "Outgoing"> = {\n${directionLines.join('\n')}\n};\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, file, 'utf8');

console.log(`Wrote ${outPath} with ${entries.length} packet ids.`);

