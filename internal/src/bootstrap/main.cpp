// Generated C++ file by Il2CppInspectorPro - https://github.com/jadis0x

#include "pch-il2cpp.h"
#include "main.h"
#include <Windows.h>
#include <iostream>
#include <TlHelp32.h>
#include <atomic>

#include "il2cpp-appdata.h"
#include "il2cpp-init.h"
#include "helpers.h"
#include "InitHooks.h"
#include "IpcBridge.h"
#include "DbgFileLog.h"
#include "AutoAim.h"

HMODULE hModule;
HANDLE hUnloadEvent;
HMODULE hGameAssembly = nullptr;
static HANDLE hSecurityThread = nullptr;
static std::atomic<bool> s_autoAimThreadStop{false};

static bool IsDebuggerDetected()
{
 BOOL remote = FALSE;
 if (IsDebuggerPresent()) return true;
 if (CheckRemoteDebuggerPresent(GetCurrentProcess(), &remote) && remote) return true;
 return false;
}

static bool HasAnalysisModulesLoaded()
{
 static const wchar_t* kBadMods[] = {
  L"x64dbg.dll", L"x64dbghelp.dll", L"ollydbg.dll", L"scylla_hide.dll"
 };
 HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, GetCurrentProcessId());
 if (snap == INVALID_HANDLE_VALUE) return false;
 MODULEENTRY32W me{};
 me.dwSize = sizeof(me);
 bool hit = false;
 if (Module32FirstW(snap, &me)) {
  do {
   for (const wchar_t* bad : kBadMods) {
    if (_wcsicmp(me.szModule, bad) == 0) {
     hit = true;
     break;
    }
   }
   if (hit) break;
  } while (Module32NextW(snap, &me));
 }
 CloseHandle(snap);
 return hit;
}

DWORD WINAPI SecurityWatcherThread(LPVOID)
{
#if defined(_DEBUG)
 return 0;
#else
 while (hUnloadEvent) {
  if (IsDebuggerDetected() || HasAnalysisModulesLoaded()) {
   SetEvent(hUnloadEvent);
   return 0;
  }
  Sleep(2000);
 }
 return 0;
#endif
}

// Dedicated AutoAim tick thread — runs GameState+LocalPlayer+AutoAim at ~60 Hz.
// Kept off the D3D render thread (dPresent) to avoid crashes during nexus
// transitions when GetWorldMgr() becomes invalid mid-tick.
DWORD WINAPI AutoAimLoopThread(LPVOID)
{
    // Wait until dPresent has installed AutoAim hooks from the render thread.
    // Hook installation uses DetourTransactionBegin which suspends all threads —
    // calling it from here would deadlock on the DirectX semaphore.
    while (!s_autoAimThreadStop.load(std::memory_order_relaxed) && !AutoAim::IsInstalled())
    {
        Sleep(50);
    }

    while (!s_autoAimThreadStop.load(std::memory_order_relaxed))
    {
        // dPresent (render thread) calls GameState::Tick(), LocalPlayer::Tick() etc.
        // Only call AutoAim::Tick() here — hooks are installed, entity walk is safe.
        AutoAim::Tick();
        Sleep(16);
    }

    return 0;
}

void Run(LPVOID lpParam)
{
 hModule = static_cast<HMODULE>(lpParam);

#ifdef _DEBUG
 il2cppi_new_console();
 SetConsoleTitleA("Debug Console");
#endif
 DBG_FILE_LOG("[Run] Entered. Log path: " << DbgFileLogPath());

#if !defined(_DEBUG)
 if (IsDebuggerDetected() || HasAnalysisModulesLoaded()) return;
#endif

 DBG_FILE_LOG("[Run] About to call init_il2cpp(hGameAssembly=" << (void*)hGameAssembly << ")...");
 init_il2cpp(hGameAssembly);
 DBG_FILE_LOG("[Run] init_il2cpp() returned.");

 DBG_FILE_LOG("[Run] About to call AttachIl2Cpp()...");
 if (!AttachIl2Cpp()) {
  DBG_FILE_LOG("[Run] AttachIl2Cpp() FAILED — returning.");
  return;
 }
 DBG_FILE_LOG("[Run] AttachIl2Cpp() succeeded.");

 DBG_FILE_LOG("[Run] About to call DetourInitilization()...");
 DetourInitilization();
 DBG_FILE_LOG("[Run] DetourInitilization() returned.");

 hUnloadEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
 if (!hUnloadEvent) {
  LogError("Unload Event could not be created!");
  return;
 }
 DBG_FILE_LOG("[Run] hUnloadEvent created.");

 HANDLE hThread = CreateThread(nullptr, 0, UnloadWatcherThread, hUnloadEvent, 0, nullptr);
 if (hThread) {
  CloseHandle(hThread);
 }
 else {
  LogError("Unload Watcher Thread could not be started!");
 }
 DBG_FILE_LOG("[Run] UnloadWatcherThread spawned. Run() complete.");

#if !defined(_DEBUG)
 hSecurityThread = CreateThread(nullptr, 0, SecurityWatcherThread, nullptr, 0, nullptr);
 if (hSecurityThread) CloseHandle(hSecurityThread);
#endif

 // Start the IPC bridge thread so the bot-client can connect via named pipe.
 HANDLE hBridgeThread = CreateThread(nullptr, 0, IpcBridgeThread, nullptr, 0, nullptr);
 if (hBridgeThread) {
  CloseHandle(hBridgeThread);
  DBG_FILE_LOG("[Run] IpcBridgeThread spawned.");
 }
 else {
  LogError("IpcBridge Thread could not be started!");
  DBG_FILE_LOG("[Run] IpcBridgeThread spawn FAILED.");
 }

 // AutoAim loop thread — off the render thread to avoid nexus-transition crashes.
 s_autoAimThreadStop.store(false, std::memory_order_relaxed);
 HANDLE hAutoAimThread = CreateThread(nullptr, 0, AutoAimLoopThread, nullptr, 0, nullptr);
 if (hAutoAimThread) {
  CloseHandle(hAutoAimThread);
  DBG_FILE_LOG("[Run] AutoAimLoopThread spawned.");
 }
 else {
  DBG_FILE_LOG("[Run] AutoAimLoopThread spawn FAILED.");
 }
}

bool AttachIl2Cpp()
{
 // il2cpp_domain_get / il2cpp_thread_attach are function pointers resolved by
 // init_il2cpp() via GetProcAddress. If init_il2cpp aborted early (GameAssembly.dll
 // not loaded), those pointers are NULL and calling them crashes the process.
 if (!il2cpp_domain_get || !il2cpp_thread_attach) {
  DBG_FILE_LOG("[AttachIl2Cpp] IL2CPP function pointers are NULL — init_il2cpp failed. Aborting.");
  return false;
 }

 Il2CppDomain* domain = il2cpp_domain_get();
 if (!domain) {
  LogError("IL2CPP Domain not found!", true);
  return false;
 }

 Il2CppThread* thread = il2cpp_thread_attach(domain);
 if (!thread) {
  LogError("IL2CPP Thread attach edilemedi!", true);
  return false;
 }
 return true;
}

DWORD WINAPI UnloadWatcherThread(LPVOID lpParam)
{
 HANDLE eventHandle = static_cast<HANDLE>(lpParam);
 if (!eventHandle) return 0;

 if (WaitForSingleObject(eventHandle, INFINITE) == WAIT_OBJECT_0) {
#ifdef _DEBUG
  std::cout << "\n[INFO]  Unload signal received, exiting..." << std::endl;
#endif

  s_autoAimThreadStop.store(true, std::memory_order_relaxed);
  Sleep(50); // let AutoAimLoopThread exit its current tick before teardown
  DetourUninitialization();

#ifdef _DEBUG
  fclose(stdout);
  FreeConsole();
#endif

  if (hUnloadEvent) {
   CloseHandle(hUnloadEvent);
   hUnloadEvent = nullptr;
  }

  Sleep(200);
  FreeLibraryAndExitThread(hModule, 0);
 }
 return 0;
}
