// Purpose: declares the runtime feature-application surface used by the IPC
// bridge and hook loop.

// Helpful notes:
// - ApplyOverrides pushes current FeatureState values into gameplay systems.
// - PollSocketHotkeyEvent reports edge-triggered socket hotkey presses so IPC can
//   emit a signed hotkey event back to the client.
// - ApplyPluginToggleHotkeys parses the "id=combo;..." spec from the client and
//   CollectPluginToggleHotkeyEvents reports edge-triggered presses per plugin id.

#pragma once

#include <string>
#include <vector>

namespace FeatureRuntime {

void ApplyOverrides();
bool PollSocketHotkeyEvent();

// Plugin toggle hotkeys (owner feature): bind arbitrary key combos to plugin ids.
void ApplyPluginToggleHotkeys(const char* spec);
void CollectPluginToggleHotkeyEvents(std::vector<std::string>& outPluginIds);

// Plugin roster from the client ("id|name|category|enabled|locked|hotkey;..."), IPC thread writes, render thread reads.
struct PluginStateEntry {
	char id[96];
	char name[96];
	char category[24];
	char hotkey[48];
	bool enabled;
	bool locked;
};
void ApplyPluginStates(const char* spec);
void CopyPluginStates(std::vector<PluginStateEntry>& out);

} // namespace FeatureRuntime
