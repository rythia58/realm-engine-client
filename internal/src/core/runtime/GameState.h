#pragma once
#include <cstdint>

// ─────────────────────────────────────────────────────────────────────────────
// GameState — single authoritative source for AppMgr, WorldMgr, and the
//             local player pointer.
//
// CALL ORDER (from dPresent, once per frame, before any other consumer):
//   GameState::Tick()
//
// COST after first resolution:
//   AppMgr  — cached forever (never changes between sessions in the same process)
//   WorldMgr — 1 raw pointer dereference per frame (changes on realm entry)
//   LocalPtr — 1 raw pointer dereference per frame (changes on realm entry)
//
// All other modules (LocalPlayer, AutoAim, WorldTAB, SkinChanger …) call the
// getters.  Nobody else walks AppMgr → WorldMgr themselves.
// ─────────────────────────────────────────────────────────────────────────────

namespace GameState {

    // ── Per-frame update — must be first in dPresent chain ───────────────────
    void Tick();

    // ── Getters ───────────────────────────────────────────────────────────────
    void* GetAppMgr();      // ApplicationManager* — valid once after first Tick
    void* GetWorldMgr();    // HJMBOMEHGDJ* — re-read each Tick; null between realms
    void* GetLocalPtr();    // FKALGHJIADI* — re-read each Tick; null in nexus/lobby

    // ── Out-of-band notify (from hooks that capture thisPtr directly) ─────────
    // Overwrites the cached local ptr if the supplied address looks valid.
    void NotifyLocalPtr(void* ptr);

} // namespace GameState
