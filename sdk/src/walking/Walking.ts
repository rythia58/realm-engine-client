import { Position } from '../types/world/Position';
import { Enemy } from '../types/entities/Enemy';

export class Walking {
    /**
     * Request movement toward a tile. Pass world **X** and **Y** as two separate numbers
     * (same units as engine/player world coordinates, e.g. from `RealmEngine.self.getX()` / `getY()`).
     */
    static walkTo(x: number, y: number): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToPosition(position: Position): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToEnemy(enemy: Enemy): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToPortal(name: string): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToNearestPortal(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToNexusPortal(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToLeftWall(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToRightWall(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToTopWall(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static walkToBottomWall(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static followPlayer(name: string): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static flee(enemy: Enemy): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static fleePosition(position: Position): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static stopMoving(): void {
        throw new Error('Must be run inside RealmEngine client');
    }

    static isMoving(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static hasReached(position: Position, tolerance?: number): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static nexus(): void {
        throw new Error('Must be run inside RealmEngine client');
    }

    static getDodgePosition(): Position | null {
        throw new Error('Must be run inside RealmEngine client');
    }

    static dodge(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static dodgeFrom(enemy: Enemy): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static canTeleport(): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static teleportToPlayer(name: string): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }

    static teleportToBeacon(objectId: number): boolean {
        throw new Error('Must be run inside RealmEngine client');
    }
}
