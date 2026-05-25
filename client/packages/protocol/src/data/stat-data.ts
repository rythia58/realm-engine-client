import type { Reader } from '../reader.js';
import type { Writer } from '../writer.js';

export class StatData {
  statTypeNum = 0;
  statValue = 0;
  stringStatValue: string | undefined;
  statValueTwo = 0;

  read(reader: Reader): this {
    this.statTypeNum = reader.readUnsignedByte();

    // RealmShark checks StatType enum for string-stat types; for protocol coverage we emulate via a set.
    if (STRING_STATS.has(this.statTypeNum)) {
      this.stringStatValue = reader.readString();
      this.statValue = 0;
    } else {
      this.stringStatValue = undefined;
      this.statValue = reader.readCompressedInt();
    }
    this.statValueTwo = reader.readCompressedInt();
    return this;
  }

  write(writer: Writer): void {
    writer.writeUInt8(this.statTypeNum);
    if (STRING_STATS.has(this.statTypeNum)) {
      writer.writeString(this.stringStatValue ?? '');
    } else {
      writer.writeCompressedInt(this.statValue);
    }
    writer.writeCompressedInt(this.statValueTwo);
  }
}

// Based on RealmShark StatData.isStringStat()
const STRING_STATS = new Set<number>([
  6, // EXP_STAT
  31, // NAME_STAT
  38, // ACCOUNT_ID_STAT
  54, // OWNER_ACCOUNT_ID_STAT
  62, // GUILD_NAME_STAT
  71, // MATERIAL_STAT
  72, // MATERIAL_CAP_STAT
  80, // UNIQUE_DATA_STRING
  82, // PET_NAME_STAT
  115, // GRAVE_ACCOUNT_ID
  121, // MODIFIERS_STAT
  127, // DUST_STAT
  128, // CRUCIBLE_STAT
  147, // DUST_AMOUNT_STAT
  155 // BloodRitualStat
]);

