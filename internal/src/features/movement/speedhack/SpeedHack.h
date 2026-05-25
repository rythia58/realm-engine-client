#pragma once

// XRebuild-style client time scale:
// - hooks UnityEngine.Time delta/realtime getters
// - scales ACTk SpeedHackProofTime static values after Update
// - skips SpeedHackDetector::Update only while active

namespace SpeedHack {

    void  Tick();                    // lazily resolves and installs hooks
    void  Uninstall();               // removes hooks and resets multiplier
    void  SetMultiplier(float mult); // <= 1.0 = off
    float GetMultiplier();
    bool  IsActive();
    bool  IsHookInstalled();

    // Back-compat helpers for older call sites.
    bool  IsResolved();
    float GetActualTimeScale();
    void  LogTimingProbe(const char* phase);

} // namespace SpeedHack
