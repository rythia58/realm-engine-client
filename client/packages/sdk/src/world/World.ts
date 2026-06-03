import type { BeaconObject } from '../types/events';

export class World {
    static isNexus(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static isRealm(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static isDungeon(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static isVault(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static getName(): string {
        throw new Error('Must be run inside RealmEngine client');
    }

    /**
     * Find a beacon in the current map by partial name match (case-insensitive).
     * Returns the nearest matching beacon, or null if not found.
     */
    static findBeacon(name: string): BeaconObject | null {
        throw new Error('Must be run inside RealmEngine client');
    }

    /**
     * Walk to the realm portal in the Nexus and enter it.
     * Must be called while in the Nexus. Returns true if movement started.
     */
    static enterRealm(): Promise<boolean> {
        throw new Error('Must be run inside RealmEngine client');
    }

    /**
     * Find a portal by partial name match, walk to it, and send USEPORTAL.
     * Works from any map. Returns true if the portal was found and entered.
     * Example: world.enterPortal('Sprite World')
     */
    static enterPortal(name: string): Promise<boolean> {
        throw new Error('Must be run inside RealmEngine client');
    }
}
