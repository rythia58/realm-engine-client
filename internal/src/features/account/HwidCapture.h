#pragma once

// HwidCapture — automatic HWID extraction from inside the game process.
//
// Why this exists: Deca's account/verify endpoint compares the submitted
// `clientToken` literally against a per-account stored value. Unity's
// `SystemInfo.deviceUniqueIdentifier` (Windows: hash of MachineGuid +
// BIOS/board serials, exact algorithm closed-source) is what the official
// launcher submits. Our bot-client previously used a WMI+SHA1 derivation
// that produced a DIFFERENT string, so login from a new machine got the
// "Token for different machine" error even when the official launcher
// worked fine on the same hardware.
//
// Solution: our injected mod is already running inside the same Unity
// process, so it can call Deca's own `DeviceIdHolder::GetDeviceId()`
// (a wrapper around `UnityApiResultsHolder::GetDeviceUniqueIdentifier`,
// which caches `SystemInfo.deviceUniqueIdentifier`). The returned string
// is the EXACT value Deca submits to its own server. We write it to
// `%LocalAppData%\RealmOfTheMadGod\hwid.txt`, where the bot-client's
// `Hwid.ts` already reads it as the priority-1 source.
//
// User flow: launch the game ONCE (via bot-client or official launcher
// — it doesn't matter, we capture either way). Mod writes hwid.txt on
// startup. Every subsequent bot-client login uses the captured value.
// Self-heals against Unity HWID drift (USB plug-in, Windows update) on
// every game launch.
namespace HwidCapture {

// Idempotent per process — first call does the work, subsequent calls
// are no-ops. Safe to invoke from per-frame Tick (won't repeat). Returns
// true once a capture has succeeded this session.
bool Tick();

// True after a successful capture this session.
bool IsCaptured();

// Last captured value (for debug overlay / status surface). Empty string
// if not yet captured.
const char* GetLastCapturedValue();

// Forces a recapture on next Tick — useful if the user manually triggers
// "refresh HWID" from the UI after a hardware change. Normal flow doesn't
// need this; the per-launch capture keeps the file fresh on its own.
void ForceRecaptureNextTick();

} // namespace HwidCapture
