# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a C++ DLL injection framework targeting Unity IL2CPP games (specifically Realm of the Mad God Exalt). It is built as a Visual Studio solution (`il2cpp-dll-injection.sln`) and produces `version.dll` — a proxy DLL that hijacks Windows' `version.dll` for auto-loading, or can be injected directly.

The reference files in `C:\Users\trump\Desktop\Current\` (DIA4A cheat source, Flash client, bot client, dumped assembly listing, research docs) are read-only context for understanding game internals. All active development is in this `C++Scaffolding` directory.

## Building

Open `il2cpp-dll-injection.sln` in Visual Studio 2022 (toolset v145). Build targets:

- **x64 | Debug** — enables `_DEBUG` (spawns a console) and `_VERSION` (proxy DLL mode). Output: `x64/Debug/version.dll`
- **x64 | Release** — same flags minus `_DEBUG`, with LTCG. Output: `x64/Release/version.dll`
- **Win32 configs** — injector mode only (no `_VERSION`, no proxy), 32-bit builds for legacy use

The x64 configs are the ones in active use. MSBuild CLI equivalent:
```
msbuild il2cpp-dll-injection.sln /p:Configuration=Release /p:Platform=x64
```

## Key Preprocessor Defines

| Define | Effect |
|--------|--------|
| `_VERSION` | Enables proxy DLL mode: `DllMain` calls `Load()` which forwards all `version.dll` exports to the real system DLL, waits 6 seconds, then calls `Run()` |
| `_DEBUG` | Opens a Win32 console for `std::cout` log output |

Without `_VERSION`, `DllMain` calls `Run()` directly (manual injector mode).

## Architecture

### Startup Flow

```
DllMain (DLL_PROCESS_ATTACH)
  └─ [_VERSION] Load()          ← version.cpp: loads real version.dll, waits 6s
       └─ Run()                 ← user/main.cpp: init + hook entry point
            ├─ init_il2cpp()    ← resolves IL2CPP API from GameAssembly.dll via GetProcAddress
            ├─ AttachIl2Cpp()   ← attaches to IL2CPP domain/thread
            ├─ DetourInitilization() ← hooks IDXGISwapChain::Present
            └─ UnloadWatcherThread ← waits for hUnloadEvent, then tears down cleanly
```

### Hook Architecture

All hooks are installed/uninstalled through `handlers/hooks/InitHooks.cpp`:

- **Detours** (MS Detours library, `libraries/detours/`) — used for `IDXGISwapChain::Present` (DXGI hook). This is the render-thread entry point.
- **MinHook** (`libraries/minhook/`) — used for IL2CPP method hooks (`ProjectileTracking`, `AutoAim`, `AoeTracking`). These install lazily from within `dPresent`/`AutoAim::Tick()` once the game has initialized.

Teardown order in `DetourUninitialization()` is critical:
1. `DirectX::Shutdown()` — stops ImGui, waits for render semaphore
2. IL2CPP MinHook uninstalls (AoeTracking → AutoAim → ProjectileTracking)
3. `MH_DisableHook` / `MH_Uninitialize()`
4. Detach DXGI Present last

### Render Loop (`handlers/hooks/DirectX.cpp`)

`dPresent` (the hooked `IDXGISwapChain::Present`) drives everything per frame:
- First call: initializes ImGui (DX11 + Win32 backends), stores device/context/window, applies theme
- Every call: runs `AutoAim::Tick()`, then tab `::Tick()` methods, then `Menu::Render()` if open
- A `HANDLE` semaphore (`hRenderSemaphore`) serializes render calls against shutdown

### IL2CPP Interop

- `framework/il2cpp-init.cpp` — resolves all IL2CPP API functions from `GameAssembly.dll` at startup using `DO_API` macros expanding over `appdata/il2cpp-api-functions.h`
- `appdata/` — generated headers (il2cpp types, function pointer tables, app-specific function stubs). These come from IL2CppInspectorPro and are specific to the current game version.
- `handlers/Il2CppResolver.h/.cpp` — runtime helpers: `Resolver::FindClass`, `Resolver::GetProperty<T>`, `Resolver::SetProperty<T>`, `Resolver::Protection::safe_call` (SEH wrapper), `Resolver::FindObjectsByType`, field value formatting for the inspector UI

### GUI (`handlers/gui/`)

Two-window ImGui layout:
- `##MenuBar` — thin horizontal tab strip (1000×36, top-left)
- `##MenuContent` — floating content panel (420×560, below bar)
- Plus a persistent bottom-right "Unload DLL" overlay

Tab index: 0=UnityExplorer, 1=Scanner, 2=World, 3=Camera, 4=Player, 5=Combat, 6=Movement, 7=Test, 8=Debug, 9=Visuals, 10=Settings

Tabs with per-frame work implement a `::Tick(bool menuOpen)` called from `dPresent` regardless of whether the menu is visible.

### Settings (`user/settings.h`, `user/settings.cpp`)

Global `settings` instance (extern). Add new feature toggles here. The `KeyBinds::Config` struct (in `handlers/keybinds.h`) holds all keybind VK codes. Menu toggle is `VK_TAB` by default.

### Projectile System (`handlers/hooks/ProjectileTracking.cpp`)

Implements Flash `Projectile.positionAt` parity for enemy shot prediction. See `docs/AUTODODGE_FLASH_PARITY.md` for the full behavior table. Key points:
- Wavy, parametric, boomerang, amplitude, turning, and laser shot types are all implemented
- `ComputePosAt(proj, tMs, x, y)` is the canonical position-at-time API
- Speed multiplier comes from `GetFlashSpeedMultiplier()` (IL2CPP field `KDAJOMOFMJB` on `HBEAKBIHANL` instances)
- `BeebyteName.h` maps obfuscated Beebyte class/field names to readable aliases

### Proxy DLL (`framework/version.cpp`)

When `_VERSION` is defined, all 17 `version.dll` exports are forwarded to the real system DLL loaded from `System32`. The `WRAPPER_GENFUNC` / `WRAPPER_FUNC` macros generate the stubs. `definitions/version.def` exports the symbols.

## Include Paths (x64 configs)

`appdata`, `framework`, `user`, `handlers`, `libraries` — all relative to project root. The PCH is `framework/pch-il2cpp.h` (created by `framework/pch-il2cpp.cpp`).

## Deployment

Copy `x64/Release/version.dll` to the game's root directory (alongside `GameAssembly.dll`). The proxy intercepts the game's load of `version.dll` and runs `Load()` automatically.
