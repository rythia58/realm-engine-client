#include "pch-il2cpp.h"
#include "ProjectileCatalog.h"
#include "gui/tabs/WorldTAB.h"

#include <windows.h>
#include <mutex>
#include <unordered_map>

namespace {

struct Key {
    int32_t owner;
    int32_t bullet;
    bool operator==(const Key& o) const { return owner == o.owner && bullet == o.bullet; }
};
struct KeyHash {
    size_t operator()(const Key& k) const noexcept {
        return (static_cast<size_t>(static_cast<uint32_t>(k.owner)) * 0x9E3779B9u) ^
               static_cast<uint32_t>(k.bullet);
    }
};

std::mutex                                                           g_mtx;
std::unordered_map<Key, ProjectileCatalog::Entry, KeyHash>           g_table;

// 24-bit hash → RGB with minimum brightness so cells render visibly on a dark grid.
void ColorFromKey(const Key& k, uint8_t& r, uint8_t& g, uint8_t& b)
{
    uint32_t h = static_cast<uint32_t>(k.owner) * 2654435761u;
    h ^= static_cast<uint32_t>(k.bullet) * 40503u;
    h ^= (h >> 16);
    r = 64 + (h & 0xBF);
    g = 64 + ((h >> 8) & 0xBF);
    b = 64 + ((h >> 16) & 0xBF);
}

} // namespace

namespace ProjectileCatalog {

void RecordSpawn(int32_t ownerObjectType, const WorldProjectile& proj)
{
    const Key key{ ownerObjectType, proj.bulletId };
    const uint32_t now = GetTickCount();

    std::lock_guard<std::mutex> lock(g_mtx);
    auto it = g_table.find(key);
    if (it == g_table.end()) {
        Entry e{};
        e.ownerObjType         = ownerObjectType;
        e.bulletType           = proj.bulletId;
        e.firstSeenTickMs      = now;
        e.lastSeenTickMs       = now;
        e.count                = 1;
        e.speed                = proj.speed;
        e.lifetime             = proj.lifetime;
        e.amplitude            = proj.amplitude;
        e.frequency            = proj.frequency;
        e.magnitude            = proj.magnitude;
        e.turnRate             = proj.turnRate;
        e.turnStopTime         = proj.turnStopTime;
        e.laserDistance        = proj.laserDistance;
        e.projHalfSize         = (proj.runtimeChebyshevHalf > 0.f) ? proj.runtimeChebyshevHalf : proj.projHalfSize;
        e.wavy                 = proj.wavy;
        e.parametric           = proj.parametric;
        e.boomerang            = proj.boomerang;
        e.laser                = proj.laser;
        e.isTurning            = proj.isTurning;
        e.isCircleTurnDelayed  = proj.isCircleTurnDelayed;
        e.isTurningDelayed     = proj.isTurningDelayed;
        e.isAccelerating       = proj.isAccelerating;
        ColorFromKey(key, e.colorR, e.colorG, e.colorB);
        g_table.emplace(key, e);
    } else {
        it->second.lastSeenTickMs = now;
        ++it->second.count;
    }
}

bool Get(int32_t ownerObjectType, int32_t bulletType, Entry& out)
{
    std::lock_guard<std::mutex> lock(g_mtx);
    auto it = g_table.find(Key{ ownerObjectType, bulletType });
    if (it == g_table.end()) return false;
    out = it->second;
    return true;
}

void ForEach(IterCb cb, void* user)
{
    if (!cb) return;
    std::lock_guard<std::mutex> lock(g_mtx);
    for (const auto& kv : g_table) {
        if (!cb(kv.second, user)) break;
    }
}

void Clear()
{
    std::lock_guard<std::mutex> lock(g_mtx);
    g_table.clear();
}

int Count()
{
    std::lock_guard<std::mutex> lock(g_mtx);
    return static_cast<int>(g_table.size());
}

} // namespace ProjectileCatalog
