import type { Reader } from '../reader.js';

export class TradeItemData {
  item = -1;
  slotType = 0;
  tradeable = false;
  included = false;
  enchantment = '';

  read(reader: Reader): this {
    this.item = reader.readInt32();
    this.slotType = reader.readInt32();
    this.tradeable = reader.readBoolean();
    this.included = reader.readBoolean();
    this.enchantment = reader.readString();
    return this;
  }
}
