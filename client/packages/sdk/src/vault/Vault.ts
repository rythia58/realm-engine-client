import { VaultChest } from './VaultChest';
import { GiftChest } from './GiftChest';
import { Item } from '../types/items/Item';

export const Vault = {
    giftChest: GiftChest,

    get(index: number): VaultChest {
        throw new Error('Must be run inside RealmEngine client');
    },

    vaultChest: {
        get(index: number): VaultChest {
            throw new Error('Must be run inside RealmEngine client');
        },

        findChestWith(itemName: string): VaultChest | null {
            throw new Error('Must be run inside RealmEngine client');
        },

        getAll(): VaultChest[] {
            throw new Error('Must be run inside RealmEngine client');
        },
    },

    findItem(name: string): Item | null {
        throw new Error('Must be run inside RealmEngine client');
    },

    getAllItems(): Item[] {
        throw new Error('Must be run inside RealmEngine client');
    },
};
