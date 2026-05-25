#pragma once

#include <cstdint>

// Windows file mapping `Local\RotMGBotShared` — layout must match bot-client
// src/native/rotmg-shared.ts (128 bytes, #pragma pack(1)).

#pragma pack(push, 1)
struct RotMGBotSharedLayout {
    uint32_t magic;                 // 0x4D544F52 "ROTM" LE
    float    posX;
    float    posY;
    int32_t  defense;               // INT32_MIN = unset → use LocalPlayer
    int32_t  classType;             // 0 = unset → use LocalPlayer::GetObjType()
    uint8_t  autoAimEnabled;
    int32_t  aimMode;               // 0 = closest player, 1 = closest mouse
    uint8_t  dodgeMode;             // TestTAB::DodgeMode 0..3
    float    dodgeHorizonMs;
    float    dodgeHitboxPadding;
    uint8_t  dodgeWallAvoid;
    uint8_t  autoAbilityEnabled;
    float    abilityMpPct;
    int32_t  wizardAbilityTargetMode;
    float    walkTargetX;
    float    walkTargetY;
    uint8_t  walkTargetActive;
    uint8_t  needsNexus;            // 53 — C++ sets 1 to request nexus; bot-client clears after sending ESCAPE
    uint8_t  _reserved[74];
};
#pragma pack(pop)

namespace SharedMemory {

constexpr uint32_t kMagic = 0x4D544F52;
constexpr int32_t  kDefenseUnset = static_cast<int32_t>(0x80000000u); // INT32_MIN

bool Init();
void Shutdown();
void Tick();

// Effective stats for C++ consumers (prefer pipe-fed telemetry, fall back to shared/local reads).
int32_t GetClientDefense();
int32_t GetClientClassType();

// Set by C++ when auto-nexus triggers; cleared by bot-client after sending ESCAPE.
void SetNeedsNexus(bool v);

} // namespace SharedMemory
