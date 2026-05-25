import { Packet } from '../../packet.js';
import type { Reader } from '../../reader.js';

/** ID 117 — VAULT_UPDATE in TsPyrelay packet-map, VAULTCONTENT in bot-client. */
export class VaultContentPacket extends Packet {
  readonly type = 'VAULT_UPDATE';

  lastVaultUpdate = false;
  vaultChestObjectId = -1;
  materialChestObjectId = -1;
  giftChestObjectId = -1;
  potionStorageObjectId = -1;
  seasonalSpoilChestObjectId = -1;
  vaultContents: number[] = [];
  materialContents: number[] = [];
  giftContents: number[] = [];
  potionContents: number[] = [];
  seasonalSpoilContents: number[] = [];

  read(reader: Reader): void {
    this.lastVaultUpdate = reader.readBoolean();
    this.vaultChestObjectId = reader.readCompressedInt();
    this.materialChestObjectId = reader.readCompressedInt();
    this.giftChestObjectId = reader.readCompressedInt();
    this.potionStorageObjectId = reader.readCompressedInt();
    this.seasonalSpoilChestObjectId = reader.readCompressedInt();

    const vLen = reader.readCompressedInt();
    this.vaultContents = [];
    for (let i = 0; i < vLen; i++) this.vaultContents.push(reader.readCompressedInt());

    const mLen = reader.readCompressedInt();
    this.materialContents = [];
    for (let i = 0; i < mLen; i++) this.materialContents.push(reader.readCompressedInt());

    const gLen = reader.readCompressedInt();
    this.giftContents = [];
    for (let i = 0; i < gLen; i++) this.giftContents.push(reader.readCompressedInt());

    const pLen = reader.readCompressedInt();
    this.potionContents = [];
    for (let i = 0; i < pLen; i++) this.potionContents.push(reader.readCompressedInt());

    const sLen = reader.readCompressedInt();
    this.seasonalSpoilContents = [];
    for (let i = 0; i < sLen; i++) this.seasonalSpoilContents.push(reader.readCompressedInt());

    // Upgrade costs / other fields — consume remainder
    if (reader.remaining > 0) reader.skip(reader.remaining);
  }
}
