// main.h
#pragma once
#include <Windows.h>

extern HMODULE hModule;
extern HANDLE hUnloadEvent;
extern HMODULE hGameAssembly;  // Pre-resolved by Load(), used by init_il2cpp()

struct ScopedHandle {
    HANDLE handle;
    ScopedHandle(HANDLE h) : handle(h) {}
    ~ScopedHandle() { if (handle && handle != INVALID_HANDLE_VALUE) CloseHandle(handle); }
    bool Valid() const { return handle && handle != INVALID_HANDLE_VALUE; }
    HANDLE Get() const { return handle; }
};

void Run(LPVOID lpParam);

bool AttachIl2Cpp();
DWORD WINAPI UnloadWatcherThread(LPVOID lpParam);
