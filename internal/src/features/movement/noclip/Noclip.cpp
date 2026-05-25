#include "pch-il2cpp.h"
#include "Noclip.h"

#include <atomic>
#include <windows.h>

namespace Noclip {
namespace {

std::atomic<bool>     g_enabled              { false };
std::atomic<int>      g_mode                 { 0 };
std::atomic<uint64_t> g_autoBypassUntilMs    { 0 };

constexpr uint64_t kAutoBypassWindowMs = 500ULL;

} // namespace

void SetEnabled(bool on) { g_enabled.store(on, std::memory_order_relaxed); }
bool IsEnabled()         { return g_enabled.load(std::memory_order_relaxed); }

void SetMode(int mode)
{
    if (mode < 0) mode = 0;
    if (mode > 2) mode = 2;
    g_mode.store(mode, std::memory_order_relaxed);
}
int GetMode() { return g_mode.load(std::memory_order_relaxed); }

bool ShouldBypassWalkable()
{
    if (!g_enabled.load(std::memory_order_relaxed)) return false;
    const int mode = g_mode.load(std::memory_order_relaxed);
    if (mode == 0) return false;
    if (mode == 1) return true;
    // mode == 2 (Auto): only bypass during the post-snap-back window.
    const uint64_t now = GetTickCount64();
    return now < g_autoBypassUntilMs.load(std::memory_order_relaxed);
}

void ReportSnapback()
{
    const int mode = g_mode.load(std::memory_order_relaxed);
    if (!g_enabled.load(std::memory_order_relaxed) || mode != 2) return;
    const uint64_t now = GetTickCount64();
    g_autoBypassUntilMs.store(now + kAutoBypassWindowMs, std::memory_order_relaxed);
}

} // namespace Noclip
