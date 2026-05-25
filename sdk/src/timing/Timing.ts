import type { Unsubscribe } from '../types/chat';

export class Timing {
    static now(): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    static timeSince(timestamp: number): number {
        throw new Error('Must be run inside RealmEngine client');
    }

    static sleep(ms: number): Promise<void> {
        throw new Error('Must be run inside RealmEngine client');
    }

    static every(_ms: number, _fn: () => void): Unsubscribe {
        throw new Error('Must be run inside RealmEngine client');
    }

    static after(_ms: number, _fn: () => void): Unsubscribe {
        throw new Error('Must be run inside RealmEngine client');
    }

    static debounce<T extends (...args: unknown[]) => void>(_ms: number, _fn: T): T {
        throw new Error('Must be run inside RealmEngine client');
    }
}
