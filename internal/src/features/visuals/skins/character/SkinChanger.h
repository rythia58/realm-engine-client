#pragma once
#include <cstdint>

// ─────────────────────────────────────────────────────────────────────────────
// SkinChanger — writes KJNHLADHEMH (the skin/texture field in LKHPPBEGNOM)
// via il2cpp_field_set_value, resolved dynamically by field name at runtime.
//
// This is the approach confirmed to work in the Unity Explorer inspector:
// changing KJNHLADHEMH changes the displayed skin without touching objectType
// (HFDNHJFNEKA at 0x30 — which the server validates and would cause a DC if
// modified with an invalid class/entity ID).
//
// Writes are triggered only when:
//   • The local player pointer changes (new map / realm entry)
//   • The override skin ID is changed
//   • Apply() is called explicitly
//
// All public functions are safe to call from any tab, hook, or thread.
// ─────────────────────────────────────────────────────────────────────────────

namespace SkinChanger {

    // ── Per-frame — call from dPresent after LocalPlayer::Tick() ─────────────
    // Detects pointer or value changes and calls Apply() automatically.
    void Tick();

    // ── Explicit trigger — writes skin immediately if ptr is available ────────
    // Call from VisualsTAB, WorldTAB, or anywhere after enabling the override.
    void Apply();

    // ── Override state ────────────────────────────────────────────────────────
    void    SetOverride(bool enabled, int32_t skinId = 0);
    bool    IsOverrideEnabled();
    int32_t GetOverrideSkinId();

    // ── Status ────────────────────────────────────────────────────────────────
    // True once Apply() has successfully written the skin to the current ptr.
    bool    IsApplied();

} // namespace SkinChanger
