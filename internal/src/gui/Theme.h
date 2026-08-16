#pragma once

#include <imgui/imgui.h>

// Full ImGuiStyle is derived from these few tunables; persisted to %LOCALAPPDATA%\RealmEngine\theme.cfg.
namespace Theme {

	struct Config {
		ImVec4 accent;
		ImVec4 background;
		ImVec4 text;
		float  rounding;
		float  alpha;
		float  fontScale;
		bool   compact;
	};

	Config& Get();
	void Apply();
	void Load();
	void Save();
	void ResetToDefault();
	const char* IniPath();
	void LoadFonts();
	ImFont* TitleFont();
	bool TabButton(const char* label, bool active);
	void DrawEditor();
}
