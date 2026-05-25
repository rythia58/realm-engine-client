import { PlayerEntity } from '../types/entities/PlayerEntity';

/** How {@link Players.getPlayerGuild} (and similar lookups) match display names. */
export type PlayerNameMatchMode = 'equals' | 'contains';

/**
 * Tracked player-like entities on the current map (`RealmEngine.players`).
 * Wired in the client: names, positions, and vitals from world state status.
 */
export class Players {
    static getAll(): PlayerEntity[] {
        throw new Error('Must be run inside RealmEngine client');
    }

    static getNearest(): PlayerEntity | null {
        throw new Error('Must be run inside RealmEngine client');
    }

    static find(name: string): PlayerEntity | null {
        throw new Error('Must be run inside RealmEngine client');
    }

    static getHP(name: string): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    static getMaxHP(name: string): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    static getHPPercent(name: string): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    static getMP(name: string): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    /** Account fame for a player (stat **39**, same meaning as `RealmEngine.self.getAccountFame`). */
    static getAccountFame(name: string): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    /** Alive character fame for a player (stat **57**, same meaning as `RealmEngine.self.getCharacterFame`). */
    static getCharacterFame(name: string): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    static count(): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    /**
     * Guild name string (stat **62**) for a player matched by display name.
     * Empty string if no match or guild unknown.
     */
    static getPlayerGuild(_name: string, _match: PlayerNameMatchMode = 'equals'): string {
        void _name;
        void _match;
        throw new Error('Must be run inside RealmEngine client');
    }

    /**
     * Distinct guild names (stat **62**) for every tracked player on the current map
     * (same pool as {@link Players.getAll}), sorted alphabetically. Omits empty / unknown.
     */
    static getNearbyGuilds(): string[] {
        throw new Error('Must be run inside RealmEngine client');
    }
}
