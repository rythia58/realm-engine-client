#include "pch-il2cpp.h"

#include "gui/tabs/PluginsTAB.h"
#include "gui/Theme.h"
#include "FeatureRuntime.h"
#include "IpcBridge.h"

#include <imgui/imgui.h>
#include <string>
#include <unordered_map>
#include <vector>
#include <cctype>
#include <cstring>

namespace {

struct PendingToggle { bool desired; float ttl; };
std::unordered_map<std::string, PendingToggle> s_pending;

struct CategoryOrder { const char* key; const char* label; };
const CategoryOrder kCategories[] = {
	{ "scripts",    "Scripts" },
	{ "combat",     "Combat" },
	{ "movement",   "Movement" },
	{ "automation", "Automation" },
	{ "visual",     "Visual" },
	{ "network",    "Network" },
	{ "utility",    "Utility" },
	{ "admin",      "Admin" },
	{ "",           "Other" },
};

bool IsKnownCategory(const char* cat)
{
	for (const auto& c : kCategories)
		if (c.key[0] && _stricmp(cat, c.key) == 0) return true;
	return false;
}

void UpperCopy(char* dst, size_t dstSize, const char* src)
{
	size_t i = 0;
	for (; src[i] && i + 1 < dstSize; ++i)
		dst[i] = (char)std::toupper((unsigned char)src[i]);
	dst[i] = 0;
}

void DrawRow(const FeatureRuntime::PluginStateEntry& p, float hotkeyColX)
{
	bool shown = p.enabled;
	const auto it = s_pending.find(p.id);
	if (it != s_pending.end()) {
		if (it->second.desired == p.enabled || it->second.ttl <= 0.f)
			s_pending.erase(it);
		else
			shown = it->second.desired;
	}

	if (p.locked) {
		ImGui::BeginDisabled();
		bool on = true;
		ImGui::Checkbox(p.name, &on);
		ImGui::EndDisabled();
	} else if (ImGui::Checkbox(p.name, &shown)) {
		s_pending[p.id] = { shown, 2.f };
		IpcBridge_EmitPluginSetEnabled(p.id, shown);
	}

	const char* tail = p.locked ? "always on" : (p.hotkey[0] ? p.hotkey : nullptr);
	if (tail) {
		char label[64];
		if (p.locked) strncpy_s(label, sizeof(label), tail, _TRUNCATE);
		else UpperCopy(label, sizeof(label), tail);
		ImGui::SameLine(hotkeyColX);
		ImGui::TextDisabled("%s", label);
	}
}

} // namespace

void PluginsTAB::Render()
{
	std::vector<FeatureRuntime::PluginStateEntry> plugins;
	FeatureRuntime::CopyPluginStates(plugins);

	if (plugins.empty()) {
		ImGui::Dummy(ImVec2(0.f, 8.f));
		ImGui::TextDisabled("No plugin roster yet.");
		ImGui::TextWrapped("Waiting for the client to connect — make sure the dev client"
		                   " (localhost:4440) is running. The list appears automatically.");
		return;
	}

	const float dt = ImGui::GetIO().DeltaTime;
	for (auto& kv : s_pending) kv.second.ttl -= dt;

	static ImGuiTextFilter s_filter;
	ImGui::SetNextItemWidth(-70.f);
	s_filter.Draw("Search");
	ImGui::Spacing();

	const float hotkeyColX = ImGui::GetContentRegionAvail().x - 110.f;

	for (const auto& cat : kCategories) {
		bool headerDrawn = false;
		for (const auto& p : plugins) {
			if (cat.key[0]) {
				if (_stricmp(p.category, cat.key) != 0) continue;
			} else if (IsKnownCategory(p.category)) {
				continue;
			}
			if (!s_filter.PassFilter(p.name) && !s_filter.PassFilter(p.id)) continue;
			if (!headerDrawn) {
				ImGui::SeparatorText(cat.label);
				headerDrawn = true;
			}
			DrawRow(p, hotkeyColX);
		}
	}
}
