#pragma once

// CredentialCapture — IL2CPP hook on AppEngineManager.Connect that records
// every Deca login as it happens, so bot-client can batch-import accounts
// (multi-account multibox workflow).
//
// Captured fields per login:
//   - timestamp (ms since epoch)
//   - guid (email or Steam GUID)
//   - secret (password or Deca-issued Steam secret)
//   - clientToken (HWID-style token; same value HwidCapture writes)
//   - steamId (last value seen via AppEngineManager.SetSteamId, "" if not Steam)
//
// Persisted as line-delimited JSON to
//   %LocalAppData%\RealmOfTheMadGod\re-captured-creds.jsonl
// bot-client reads + dedupes this file.

namespace CredentialCapture {

// Tick-driven install. Safe to call repeatedly; only installs once IL2CPP
// resolves AppEngineManager.Connect (lazy, same pattern as HwidCapture).
void Tick();

// Tear down MinHook hooks. Called from DetourUninitialization.
void Uninstall();

} // namespace CredentialCapture
