# Contributing

Realm Engine is a three-part project:

- **`client/`** — Electron MITM proxy + automation dashboard (TypeScript, npm)
- **`internal/`** — C++ IL2CPP DLL injector producing `version.dll` (Visual Studio 2022)
- **`client/packages/sdk/`** — `@realmengine/sdk`, the stable surface for user-authored plugins (docs: [`sdk/README.md`](sdk/README.md))

This is a fork of [Realm Engine by Evergreen-Techworks](https://github.com/Evergreen-Techworks/realm-engine-client).
Contributions that belong upstream are better sent upstream — this repo carries
fork-specific fixes on top.

Deeper notes live next to the code they describe:

- Top-level: [`README.md`](README.md), [`SETUP.md`](SETUP.md)
- Post-patch runbook: [`internal/docs/UPDATING_AFTER_GAME_PATCH.md`](internal/docs/UPDATING_AFTER_GAME_PATCH.md)
- MCP diagnostics bridge: [`internal/tools/re-mcp/README.md`](internal/tools/re-mcp/README.md)

---

## Development environment

You need:

- **Windows 10/11 x64.** No macOS/Linux/Wine — the client is Electron, the injector is a native Win32 DLL.
- **RotMG Exalt** installed and playable. Its game files are the source of truth for the IL2CPP headers and XML assets.
- **Node.js 20+** and npm (a `pnpm-lock.yaml` exists under `client/` if you prefer pnpm).
- **Visual Studio 2022 Build Tools**, toolset `v145`, Windows SDK 10.x — only if you're touching `internal/`.

First-time setup:

1. Clone the repo.
2. Follow [`SETUP.md`](SETUP.md) to generate the IL2CPP headers and download the game XML. These are per-Exalt-build and deliberately not committed.
3. `cd client && npm install` — this also links `@realmengine/sdk` from `client/packages/sdk` via the `file:` dependency.
4. For native work, open `internal/il2cpp-dll-injection.sln`.

---

## Building

```bash
# Client — dev (proxy on 2050, dashboard on 4440)
cd client && npm run dev

# Client — typecheck
cd client && npx tsc --noEmit

# Client — installer / portable
cd client && npm run dist
cd client && npm run dist:portable

# Native DLL
cd internal && msbuild il2cpp-dll-injection.sln -p:Configuration=Debug -p:Platform=x64 -m
```

Three things that reliably cost people an hour:

- **The DLL is not written to `internal/x64/`.** The project copies it to
  `client/assets/version.dll`, and the client deploys it into the Exalt install on
  startup. **Close the game first** or the copy silently does nothing.
- **Release builds need `internal/src/core/ipc/BuildSecrets.h`** (gitignored),
  defining `BUILD_HANDSHAKE_KEY` and `BUILD_PIPE_NAME`. Debug falls back to dev
  defaults. The pipe name needs four backslashes per separator —
  `"\\\\.\\pipe\\..."` — because `\p` and `\l` are invalid C++ escapes that collapse
  silently into a wrong-but-plausible pipe name, and the bridge then never connects.
- **Check what you actually deployed.** MSBuild will skip the link if it thinks a
  target is up to date, so a Debug build after a Release build can leave the Release
  DLL in place while reporting success. Compare file size or hash, or use `-t:Rebuild`.

Dev loop:

```powershell
Get-Process node,electron,"RotMG Exalt" | Stop-Process -Force
Remove-Item .\client\assets\internal.bin -Force -ErrorAction SilentlyContinue
# rebuild the DLL, then:
cd client; npm run dev
```

---

## Packet definitions and offsets

Both change every RotMG patch, and they move in lockstep:

- **Packet map** — `client/packages/protocol/src/generated/packet-map.ts`, regenerated
  from an upstream `realmlib` fork:
  `node client/scripts/sync-packet-map.mjs <path-to-realmlib/src>`
- **IL2CPP offsets** — `internal/src/core/runtime/RuntimeOffsets.{h,cpp}`. This is a
  table-driven, **self-healing** registry: every offset ships with a last-known-good
  fallback, and `EnsureAll()` re-resolves each entry per frame by BeeByte-obfuscated
  class and field name. Entries that fail to resolve within 5 seconds keep the
  fallback and are flagged in **Test → OFFSET HEALTH** (yellow = stale name,
  red = reading garbage).

After a patch, work the runbook in
[`internal/docs/UPDATING_AFTER_GAME_PATCH.md`](internal/docs/UPDATING_AFTER_GAME_PATCH.md)
and start with whatever OFFSET HEALTH is complaining about.

---

## Coding style

- **TypeScript** — TS 5.4, ESNext modules, `strict: true`. Explicit types on exported
  symbols. `.js` extensions in import paths.
- **C++** — C++20, MS ABI. Reach for the existing helpers (`Resolver::safe_call`,
  `RuntimeOffsets`, `DBG_FILE_LOG`) rather than new SEH or logging wrappers. Note that
  `DBG_FILE_LOG` builds a stream object, so it can't be used inside a function that
  already uses `__try` — put it in a helper.
- **Comments** — sparse, and for the *why*. `RuntimeOffsets.h` is the pattern: record
  why an offset is what it is, because the value itself will be wrong next patch.

---

## Scope

This is a RotMG automation platform. Please don't open PRs that:

- compromise external accounts, server infrastructure, or other players' data;
- add functionality outside the game — system-wide keyloggers, remote access,
  credential exfiltration to third parties;
- change the license without discussion first.

Anything touching offsets, packets, or in-game behaviour is fair game.

---

## Reporting bugs

- **Bug or crash** — open an issue with log output. Debug builds spawn a console; the
  file log is at `%LOCALAPPDATA%\RotMG Exalt DLL Trace.log`.
- **Feature request** — open an issue.
- **Security issue in the client itself** (e.g. the MITM proxy exposing something it
  shouldn't) — report privately to the maintainers before disclosing publicly.

---

## Pull requests

- One feature or one fix per PR.
- Say what you tested: game context, plugin configuration, which dodge mode.
- If you touched `RuntimeOffsets` or the packet map, note the Exalt build you tested against.
- Don't claim authorship of work that isn't yours — this project is MIT and builds on
  Evergreen-Techworks' original.

---

## License

MIT — see [LICENSE](LICENSE). Copyright © Evergreen-Techworks and contributors.
