#pragma once

#include <cstdint>

// ChatToast — lightweight ephemeral message stream rendered as an ImGui
// overlay. Used by the planner (lock/unlock) and will be reused by any
// feature that wants a chat-style "did a thing" notification.
//
// Native ChatManager injection is deliberately out of scope here — it'd
// require resolving ChatManager::MakeChatError + AddSlot and crafting
// IL2CPP String* objects, which is brittle across game updates. The toast
// system is layout-agnostic (appears over the game) and doesn't touch the
// game's packet flow.
namespace ChatToast {

enum class Kind : uint8_t {
    Info    = 0,   // cyan
    Success = 1,   // green
    Warn    = 2,   // yellow
    Error   = 3,   // red
};

// Push a message. Safe from any thread; the line is queued and rendered on
// the next dPresent frame.
void Push(Kind kind, const char* msg);

// Draw any pending toasts. Called from dPresent after the main menu so
// toasts appear above everything, even when the in-game menu is closed.
void Render();

// Wipe all queued messages (DLL unload).
void Clear();

} // namespace ChatToast
