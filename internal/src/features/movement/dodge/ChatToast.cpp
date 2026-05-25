#include "pch-il2cpp.h"
#include "ChatToast.h"

#include <imgui/imgui.h>

#include <cstring>
#include <mutex>
#include <windows.h>

namespace {

constexpr int   kMaxToasts  = 6;
constexpr float kLifeMs     = 3500.f;
constexpr float kFadeMs     = 500.f;

struct Toast {
    char            text[128];
    ChatToast::Kind kind;
    uint64_t        spawnMs;
};

std::mutex s_mtx;
Toast      s_ring[kMaxToasts]{};
int        s_head = 0; // next write slot
int        s_count = 0;

ImU32 ColorForKind(ChatToast::Kind k, float alpha)
{
    const uint8_t a = static_cast<uint8_t>(std::max(0.f, std::min(1.f, alpha)) * 255.f);
    switch (k) {
    case ChatToast::Kind::Success: return IM_COL32(80, 230, 120, a);
    case ChatToast::Kind::Warn:    return IM_COL32(240, 200, 60, a);
    case ChatToast::Kind::Error:   return IM_COL32(240, 90, 80, a);
    case ChatToast::Kind::Info:
    default:                       return IM_COL32(120, 200, 255, a);
    }
}

} // namespace

namespace ChatToast {

void Push(Kind kind, const char* msg)
{
    if (!msg) return;
    std::lock_guard<std::mutex> lock(s_mtx);
    Toast& t = s_ring[s_head];
    strncpy_s(t.text, sizeof(t.text), msg, _TRUNCATE);
    t.kind    = kind;
    t.spawnMs = GetTickCount64();
    s_head = (s_head + 1) % kMaxToasts;
    if (s_count < kMaxToasts) ++s_count;
}

void Clear()
{
    std::lock_guard<std::mutex> lock(s_mtx);
    s_head  = 0;
    s_count = 0;
}

void Render()
{
    // Snapshot under lock so we don't race with Push while drawing.
    Toast snap[kMaxToasts];
    int   snapCount = 0;
    {
        std::lock_guard<std::mutex> lock(s_mtx);
        const uint64_t nowMs = GetTickCount64();
        for (int i = 0; i < s_count; ++i) {
            // Iterate from oldest to newest.
            const int idx = (s_head - s_count + i + kMaxToasts) % kMaxToasts;
            const uint64_t age = nowMs - s_ring[idx].spawnMs;
            if (age > static_cast<uint64_t>(kLifeMs)) continue;
            snap[snapCount++] = s_ring[idx];
        }
    }
    if (snapCount == 0) return;

    ImDrawList* fg = ImGui::GetForegroundDrawList();
    if (!fg) return;

    const ImGuiIO& io = ImGui::GetIO();
    const float screenW = io.DisplaySize.x;
    const float pad     = 10.f;
    const float lineH   = ImGui::GetFontSize() + 6.f;
    const float boxW    = 360.f;

    const uint64_t nowMs = GetTickCount64();
    float y = 80.f;

    for (int i = 0; i < snapCount; ++i) {
        const Toast& t = snap[i];
        const float age = static_cast<float>(nowMs - t.spawnMs);
        float alpha = 1.f;
        if (age > kLifeMs - kFadeMs)
            alpha = (kLifeMs - age) / kFadeMs;
        if (alpha <= 0.f) continue;

        const ImVec2 tlPos(screenW - boxW - pad, y);
        const ImVec2 brPos(screenW - pad, y + lineH);
        fg->AddRectFilled(tlPos, brPos, IM_COL32(15, 18, 24, static_cast<int>(200 * alpha)), 4.f);
        fg->AddRect     (tlPos, brPos, ColorForKind(t.kind, alpha), 4.f, 0, 1.2f);

        fg->AddText(ImVec2(tlPos.x + 8.f, tlPos.y + 3.f),
                    ColorForKind(t.kind, alpha), t.text);
        y += lineH + 4.f;
    }
}

} // namespace ChatToast
