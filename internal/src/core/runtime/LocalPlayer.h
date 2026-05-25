#pragma once
#include <cstdint>

// ─────────────────────────────────────────────────────────────────────────────
// LocalPlayer — central per-frame cache for the local FKALGHJIADI* pointer and
// its hot-path stats (HP, MP, cooldown, position, class).
//
// Call order in dPresent (before any Tick/Render):
//   1. RuntimeOffsets::EnsureAll()
//   2. LocalPlayer::Tick()          ← resolves ptr + reads stats
//   3. AutoAim::Tick()
//   4. CombatTAB::Tick() / etc.
//
// Consumer registration
// ─────────────────────────────────────────────────────────────────────────────
// Any feature that needs live HP/MP/cooldown registers itself:
//   LocalPlayer::AddConsumer()      when the feature is enabled
//   LocalPlayer::RemoveConsumer()   when the feature is disabled
//
// With zero consumers Tick() only validates the pointer + reads XY (2 floats).
// With ≥1 consumer  Tick() also reads HP, MaxHP, Defense, CurMP (float),
//                   MaxMP, ObjType, ability cooldown (see below), AbilityActive.
//
// WorldTAB integration
// ─────────────────────────────────────────────────────────────────────────────
// After WorldTAB::DoRefresh() finds the local player it calls NotifyPtr() so
// both share the same pointer without a duplicate WorldManager walk.
// ─────────────────────────────────────────────────────────────────────────────

namespace LocalPlayer {

    // ── Frame tick — call once per frame before all consumers ────────────────
    void Tick();

    // ── Consumer registration ─────────────────────────────────────────────────
    void AddConsumer();
    void RemoveConsumer();

    // ── Sync from WorldTAB after a full refresh ───────────────────────────────
    // Safe to call with nullptr (ignored).
    void NotifyPtr(void* ptr);

    // ── Accessors — return last-cached values (all on render thread) ──────────
    void*   GetPtr();               // FKALGHJIADI* — null if not found yet
    float   GetX();
    float   GetY();
    int32_t GetHP();
    int32_t GetMaxHP();
    int32_t GetDefense();
    float   GetCurMpF();            // FMHMGKEPIDN is float in il2cpp-types.h
    int32_t GetMaxMP();
    int32_t GetObjType();
    // Seconds remaining on ability cooldown for UI (0 = ready).
    // −1.f = on cooldown but no numeric time (show "active" only).
    float   GetCooldownRemaining();
    // DAGEMHFLJLK — authoritative from game; use for auto-ability gate.
    bool    IsAbilityInCooldown();
    bool    GetAbilityActive();     // BINDBHJLPMG byte flag (ability currently active/held)

} // namespace LocalPlayer
