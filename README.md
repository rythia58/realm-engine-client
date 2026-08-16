# Realm Engine — RotMG Client, DLL & SDK

[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0d9488)](#requirements)
[![License](https://img.shields.io/badge/license-MIT-14b8a6)](LICENSE)

A fork of [Realm Engine](https://github.com/Evergreen-Techworks/realm-engine-client) — the open-source
automation platform for **Realm of the Mad God (Exalt)**. Three parts: an Electron
client that MITM-proxies the game, a C++ IL2CPP DLL injected into the process, and a
TypeScript SDK for writing your own plugins.

> **Credit:** Realm Engine was created by **[Evergreen-Techworks](https://github.com/Evergreen-Techworks)**
> and its contributors, and remains MIT-licensed to them. This fork tracks upstream and adds
> its own fixes on top. Original project: [realmengine.org](https://realmengine.org).

---

## Requirements

- **Windows x64.** The client is Electron; the injector is a native Win32 DLL. No macOS/Linux/Wine.
- **Node.js 20+** and **npm**
- **Visual Studio 2022 Build Tools**, toolset `v145`, for the DLL
- IL2CPP headers for your current Exalt build in `internal/src/game/generated/` — not committed, see [SETUP.md](./SETUP.md)

---

## Repository layout

| Path | What it is |
|---|---|
| [`client/`](./client) | Electron app: MITM proxy, plugin host, dashboard on `localhost:4440` |
| [`client/plugins/`](./client/plugins) | First-party plugins (27), TypeScript, richer internal API |
| [`client/packages/sdk/`](./client/packages/sdk) | `@realmengine/sdk` — stable surface for community plugins |
| [`internal/`](./internal) | C++ IL2CPP injector producing `version.dll` |
| [`internal/tools/re-mcp/`](./internal/tools/re-mcp) | MCP server for runtime-testing the live DLL |
| [`sdk/`](./sdk) | Docs stub — the package itself lives under `client/packages/sdk` |

### Inside `internal/src/`

```
bootstrap/   DllMain, Run(), version.dll proxy exports
core/        config, il2cpp, ipc, logging, runtime, security
features/    account, combat, control, loot, misc, movement,
             projectiles, runtime, visuals
game/        generated headers, math, BeeByte symbol map
gui/         ImGui overlay — Theme.cpp + tabs/
platform/    dx11 + hooks (Detours / MinHook)
```

---

## Building

### Client

```bash
cd client
npm install
npm run dev          # dev server: proxy on 2050, dashboard on 4440
npm run build        # sdk + tsc typecheck
npm run dist         # Windows installer via electron-builder
```

### DLL

```bash
cd internal
msbuild il2cpp-dll-injection.sln -p:Configuration=Debug -p:Platform=x64 -m
```

Two things that trip people up:

- **The DLL does not land in `x64/Debug/`.** The project copies it straight to
  `client/assets/version.dll`, and the client deploys it into the Exalt install on
  startup. The game must be closed or the copy silently no-ops.
- **Release needs `internal/src/core/ipc/BuildSecrets.h`** (gitignored). It defines
  `BUILD_HANDSHAKE_KEY` and `BUILD_PIPE_NAME`; Debug falls back to dev defaults.
  The pipe name needs four backslashes per separator — `"\\\\.\\pipe\\..."` — because
  `\p` and `\l` are invalid C++ escapes that silently collapse, producing a
  plausible-looking but wrong pipe name and a bridge that never connects.

### Dev loop

```powershell
Get-Process node,electron,"RotMG Exalt" | Stop-Process -Force
Remove-Item .\client\assets\internal.bin -Force -ErrorAction SilentlyContinue
# rebuild the DLL, then:
cd client; npm run dev
```

Verify the deployed DLL matches what you built — a Release build left in
`client/assets/` after a Debug build is an easy hour to lose.

---

## How it fits together

The client owns game state and decisions; the DLL owns memory reads, hooks and the
in-game overlay. They talk over a named pipe (`\\.\pipe\lfg-dev-bridge`) with an
HMAC handshake, sequence numbers and heartbeats — the DLL is the client, Node is
the server.

```
RotMG Exalt ──► winhttp.dll ──► 127.0.0.1:2050 (client proxy) ──► server
     │
     └─ version.dll ──named pipe──► client
```

The overlay opens with **Insert** and carries nine tabs: Plugins, Scripts, Combat,
Player, Camera, Visuals, World, Test, UI. The tab array in
`platform/hooks/DirectX.cpp` is the single source of truth for their order.

---

## Features

**Combat** — Autonexus with a predictive HP model, autoaim, auto-ability, auto-drink,
ghost-hit detection, damage sniffer.

**Movement** — seven auto-dodge engines selectable at runtime (XDodge spacetime BFS,
RE-Sim grid/quadtree, zDodge, RE++, PJDodge, RDodge), pathfinding, noclip, speed hack,
push-tile spoofing, collider tuning.

**Automation** — autoloot with tier/category rules, auto-follow, O3 helper, server
switching, packet logging, lag switch.

**Scripting** — two surfaces: TypeScript plugins against `@realmengine/sdk`, and a
42-node visual scripting system with editors in *both* the dashboard and the in-game
Scripts tab, sharing one graph format.

---

## Runtime offsets

`core/runtime/RuntimeOffsets.{h,cpp}` is a table-driven, self-healing field-offset
registry. Every offset ships with a last-known-good fallback; `EnsureAll()` re-resolves
each entry per frame by BeeByte-obfuscated class and field name, and anything that
fails to resolve inside 5 seconds is flagged in **Test → OFFSET HEALTH**
(yellow = stale, red = reading garbage).

**When Exalt patches, this table is the first thing to check.** See
[`internal/docs/UPDATING_AFTER_GAME_PATCH.md`](./internal/docs/UPDATING_AFTER_GAME_PATCH.md).

---

## Known gaps

- **AoE tracking runs at 3/4 coverage.** The three spawn hooks resolve; the ShowEffect
  handler symbol (`CGBILOJJPEI`) no longer exists in the current dump and
  `HJMBOMEHGDJ` is now MapViewService. Telegraph-only AoEs are missed. Surfaced in the
  Combat readout rather than failing silently.
- **Bullet-ID resolution is unconfirmed.** The DLL publishes both `attackerObjId` and
  `ownerObjId`; the client tries each against the ENEMYSHOOT-keyed tracker and logs the
  real match rate once per session.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Upstream issues and discussion live on the
[original project](https://github.com/Evergreen-Techworks/realm-engine-client).

---

## License

MIT — see [LICENSE](LICENSE). Copyright © Evergreen-Techworks and contributors.
