#pragma once

// CharSelect — observability + minimal orchestration for the
// CharacterSelectionPanel screen. Production-feature parent: "change
// character on reconnect."
//
// The actual selection click (CharacterSelectionPanel_NJOBNAEOALD with
// a CurrentCharacterSlot pointer) needs the slot pointer for the
// target character — that's currently not exposed via a stable
// accessor, so the mod side stops at the "panel is visible" detection
// and lets the bot-client orchestrate the rest (e.g. by sending
// a swap-character RPC over the bot-API). When the slot-lookup is
// RE'd, FireSelectSlot() below is the wiring point.
namespace CharSelect {

// Tick is called every frame from dPresent so we can install / refresh
// the hooks lazily once IL2CPP is up.
void Tick();

// True after CharacterSelectionPanel constructor fires this session
// AND no Hide() has been observed since. Bot-client polls this to
// detect when the character-selection screen is being shown
// (typically right after a disconnect / reconnect cycle, or when the
// user clicks "Change Character" from the nexus UI).
bool IsPanelVisible();

// Captured panel pointer for diagnostics — bot-client logs this to
// confirm the hook fired. Null when no panel has been constructed
// this session (or after a Hide).
void* GetPanelPtr();

// Wiring point for the future "click the target character slot"
// path. Currently a no-op stub — fills in once we identify the
// CurrentCharacterSlot accessor on the panel.
void RequestSelectSlot(int slotIndex);

} // namespace CharSelect
