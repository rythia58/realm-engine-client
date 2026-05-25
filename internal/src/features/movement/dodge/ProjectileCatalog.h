#pragma once

#include <cstdint>

struct WorldProjectile;

// ProjectileCatalog — runtime per-dungeon lookup table.
//
// Keyed by (ownerObjectType, bulletType). The first time we see a shot with a
// given key we snapshot its motion signature + a stable viz color. Later shots
// of the same key can be classified / recolored without re-reading properties.
//
// The DangerPlanner never reads this table — it uses live WorldProjectile
// fields. This exists purely for display (debug map color coding, dungeon
// reconnaissance UI) and the "we've seen N unique shot types" idea.
namespace ProjectileCatalog {

struct Entry {
    int32_t  ownerObjType;  // ObjectProperties.type of the shooter (0 if unresolved)
    int32_t  bulletType;    // WorldProjectile::bulletId
    uint32_t firstSeenTickMs;
    uint32_t lastSeenTickMs;
    uint32_t count;         // number of spawns observed this session

    // Motion signature snapshot from the first-seen shot.
    float    speed;              // raw int as float (divide by 10000 for tiles/ms)
    float    lifetime;           // ms
    float    amplitude;
    float    frequency;
    float    magnitude;
    float    turnRate;
    float    turnStopTime;
    float    laserDistance;
    float    projHalfSize;
    bool     wavy;
    bool     parametric;
    bool     boomerang;
    bool     laser;
    bool     isTurning;
    bool     isCircleTurnDelayed;
    bool     isTurningDelayed;
    bool     isAccelerating;

    // Stable display color (RGB, 0-255) derived from key hash.
    uint8_t  colorR, colorG, colorB;
};

// Record a spawn. Safe to call from the spawn detour (game thread). The owner
// object type may be 0 if we couldn't resolve it yet; callers should prefer to
// pass the resolved type when available (from WorldTAB entity dict), otherwise
// leave it at 0 and RecordSpawn will treat it as a separate bucket.
void RecordSpawn(int32_t ownerObjectType, const WorldProjectile& proj);

// Lookup existing entry; writes to `out` and returns true if found.
bool Get(int32_t ownerObjectType, int32_t bulletType, Entry& out);

// Iterate every entry (debug UI / stats). cb returns false to stop early.
using IterCb = bool (*)(const Entry& e, void* user);
void ForEach(IterCb cb, void* user);

// Cleared on map transition / dungeon change.
void Clear();

// Number of unique entries currently in the table.
int Count();

} // namespace ProjectileCatalog
