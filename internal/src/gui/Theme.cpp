#include "pch-il2cpp.h"

#include "gui/Theme.h"
#include "settings.h"
#include "keybinds.h"

#include <Windows.h>
#include <cstdio>
#include <cstring>
#include <cmath>

namespace {

Theme::Config s_cfg;
ImFont* s_fontBody = nullptr;
ImFont* s_fontTitle = nullptr;
char s_iniPath[MAX_PATH] = {};
char s_cfgPath[MAX_PATH] = {};

Theme::Config DefaultConfig()
{
	Theme::Config c{};
	c.accent     = ImVec4(0.55f, 0.42f, 0.95f, 1.00f);
	c.background = ImVec4(0.075f, 0.075f, 0.10f, 1.00f);
	c.text       = ImVec4(0.92f, 0.92f, 0.95f, 1.00f);
	c.rounding   = 7.0f;
	c.alpha      = 0.96f;
	c.fontScale  = 1.0f;
	c.compact    = false;
	return c;
}

const char* ConfigDir()
{
	static char dir[MAX_PATH] = {};
	if (!dir[0]) {
		char local[MAX_PATH] = {};
		DWORD n = GetEnvironmentVariableA("LOCALAPPDATA", local, sizeof(local));
		if (n == 0 || n >= sizeof(local)) return nullptr;
		snprintf(dir, sizeof(dir), "%s\\RealmEngine", local);
		CreateDirectoryA(dir, nullptr);
	}
	return dir;
}

const char* CfgPath()
{
	if (!s_cfgPath[0]) {
		const char* dir = ConfigDir();
		if (!dir) return nullptr;
		snprintf(s_cfgPath, sizeof(s_cfgPath), "%s\\theme.cfg", dir);
	}
	return s_cfgPath;
}

ImVec4 Mix(const ImVec4& a, const ImVec4& b, float t)
{
	return ImVec4(a.x + (b.x - a.x) * t,
	              a.y + (b.y - a.y) * t,
	              a.z + (b.z - a.z) * t,
	              a.w + (b.w - a.w) * t);
}

ImVec4 WithA(const ImVec4& c, float a) { return ImVec4(c.x, c.y, c.z, a); }

ImVec4 Lift(const ImVec4& bg, float f)
{
	return ImVec4(bg.x + (1.f - bg.x) * f,
	              bg.y + (1.f - bg.y) * f,
	              bg.z + (1.f - bg.z) * f,
	              bg.w);
}

struct Preset { const char* name; ImVec4 accent; ImVec4 bg; };
const Preset kPresets[] = {
	{ "Obsidian", ImVec4(0.55f, 0.42f, 0.95f, 1.f), ImVec4(0.075f, 0.075f, 0.10f, 1.f) },
	{ "Ocean",    ImVec4(0.20f, 0.60f, 0.95f, 1.f), ImVec4(0.06f,  0.08f,  0.11f, 1.f) },
	{ "Crimson",  ImVec4(0.90f, 0.25f, 0.35f, 1.f), ImVec4(0.09f,  0.06f,  0.07f, 1.f) },
	{ "Emerald",  ImVec4(0.20f, 0.80f, 0.50f, 1.f), ImVec4(0.05f,  0.09f,  0.07f, 1.f) },
	{ "Slate",    ImVec4(0.65f, 0.70f, 0.80f, 1.f), ImVec4(0.10f,  0.10f,  0.11f, 1.f) },
};

} // namespace

namespace Theme {

Config& Get() { return s_cfg; }

const char* IniPath()
{
	if (!s_iniPath[0]) {
		const char* dir = ConfigDir();
		if (!dir) return nullptr;
		snprintf(s_iniPath, sizeof(s_iniPath), "%s\\menu-layout.ini", dir);
	}
	return s_iniPath;
}

void LoadFonts()
{
	ImGuiIO& io = ImGui::GetIO();
	char win[MAX_PATH] = {};
	char path[MAX_PATH] = {};
	if (GetWindowsDirectoryA(win, sizeof(win))) {
		snprintf(path, sizeof(path), "%s\\Fonts\\segoeui.ttf", win);
		s_fontBody = io.Fonts->AddFontFromFileTTF(path, 18.f);
		snprintf(path, sizeof(path), "%s\\Fonts\\seguisb.ttf", win);
		s_fontTitle = io.Fonts->AddFontFromFileTTF(path, 22.f);
	}
	if (!s_fontBody)
		s_fontBody = io.Fonts->AddFontDefault();
	if (!s_fontTitle)
		s_fontTitle = s_fontBody;
	io.FontDefault = s_fontBody;
}

ImFont* TitleFont() { return s_fontTitle; }

void Apply()
{
	ImGuiStyle& st = ImGui::GetStyle();
	st = ImGuiStyle();

	const Config& c = s_cfg;
	const float pad = c.compact ? 6.f : 10.f;

	st.WindowPadding     = ImVec2(pad + 2.f, pad);
	st.FramePadding      = ImVec2(pad, c.compact ? 3.f : 5.f);
	st.ItemSpacing       = ImVec2(8.f, c.compact ? 4.f : 7.f);
	st.ItemInnerSpacing  = ImVec2(6.f, 4.f);
	st.CellPadding       = ImVec2(6.f, c.compact ? 2.f : 4.f);
	st.ScrollbarSize     = 11.f;
	st.GrabMinSize       = 10.f;

	st.WindowRounding    = c.rounding;
	st.ChildRounding     = c.rounding * 0.6f;
	st.FrameRounding     = c.rounding * 0.6f;
	st.PopupRounding     = c.rounding * 0.6f;
	st.ScrollbarRounding = 9.f;
	st.GrabRounding      = c.rounding * 0.6f;
	st.TabRounding       = c.rounding * 0.6f;

	st.WindowBorderSize  = 1.f;
	st.ChildBorderSize   = 1.f;
	st.FrameBorderSize   = 0.f;
	st.PopupBorderSize   = 1.f;

	st.FontScaleMain     = c.fontScale;

	const ImVec4 bg      = c.background;
	const ImVec4 accent  = c.accent;
	const ImVec4 frame   = Lift(bg, 0.055f);
	const ImVec4 frameHi = Mix(frame, accent, 0.35f);
	const ImVec4 dim     = Mix(c.text, bg, 0.45f);

	ImVec4* col = st.Colors;
	col[ImGuiCol_Text]                 = c.text;
	col[ImGuiCol_TextDisabled]         = dim;
	col[ImGuiCol_WindowBg]             = WithA(bg, c.alpha);
	col[ImGuiCol_ChildBg]              = WithA(Lift(bg, 0.02f), 0.55f);
	col[ImGuiCol_PopupBg]              = WithA(Lift(bg, 0.03f), 0.98f);
	col[ImGuiCol_Border]               = WithA(Mix(Lift(bg, 0.25f), accent, 0.25f), 0.55f);
	col[ImGuiCol_BorderShadow]         = ImVec4(0, 0, 0, 0);
	col[ImGuiCol_FrameBg]              = frame;
	col[ImGuiCol_FrameBgHovered]       = WithA(frameHi, 0.7f);
	col[ImGuiCol_FrameBgActive]        = WithA(frameHi, 0.95f);
	col[ImGuiCol_TitleBg]              = bg;
	col[ImGuiCol_TitleBgActive]        = bg;
	col[ImGuiCol_TitleBgCollapsed]     = bg;
	col[ImGuiCol_MenuBarBg]            = Lift(bg, 0.02f);
	col[ImGuiCol_ScrollbarBg]          = WithA(bg, 0.4f);
	col[ImGuiCol_ScrollbarGrab]        = Lift(bg, 0.16f);
	col[ImGuiCol_ScrollbarGrabHovered] = Mix(Lift(bg, 0.22f), accent, 0.4f);
	col[ImGuiCol_ScrollbarGrabActive]  = accent;
	col[ImGuiCol_CheckMark]            = accent;
	col[ImGuiCol_SliderGrab]           = Mix(accent, c.text, 0.15f);
	col[ImGuiCol_SliderGrabActive]     = accent;
	col[ImGuiCol_Button]               = WithA(Mix(frame, accent, 0.22f), 0.85f);
	col[ImGuiCol_ButtonHovered]        = WithA(Mix(frame, accent, 0.50f), 0.95f);
	col[ImGuiCol_ButtonActive]         = accent;
	col[ImGuiCol_Header]               = WithA(Mix(frame, accent, 0.35f), 0.65f);
	col[ImGuiCol_HeaderHovered]        = WithA(Mix(frame, accent, 0.55f), 0.85f);
	col[ImGuiCol_HeaderActive]         = WithA(accent, 0.9f);
	col[ImGuiCol_Separator]            = WithA(Lift(bg, 0.18f), 0.6f);
	col[ImGuiCol_SeparatorHovered]     = WithA(accent, 0.7f);
	col[ImGuiCol_SeparatorActive]      = accent;
	col[ImGuiCol_ResizeGrip]           = WithA(accent, 0.25f);
	col[ImGuiCol_ResizeGripHovered]    = WithA(accent, 0.6f);
	col[ImGuiCol_ResizeGripActive]     = accent;
	col[ImGuiCol_Tab]                  = frame;
	col[ImGuiCol_TabHovered]           = WithA(Mix(frame, accent, 0.5f), 0.9f);
	col[ImGuiCol_TabSelected]          = Mix(frame, accent, 0.7f);
	col[ImGuiCol_TabDimmed]            = frame;
	col[ImGuiCol_TabDimmedSelected]    = Mix(frame, accent, 0.4f);
	col[ImGuiCol_PlotLines]            = accent;
	col[ImGuiCol_PlotLinesHovered]     = Mix(accent, c.text, 0.4f);
	col[ImGuiCol_PlotHistogram]        = accent;
	col[ImGuiCol_PlotHistogramHovered] = Mix(accent, c.text, 0.4f);
	col[ImGuiCol_TableHeaderBg]        = Lift(bg, 0.05f);
	col[ImGuiCol_TableBorderStrong]    = WithA(Lift(bg, 0.22f), 0.8f);
	col[ImGuiCol_TableBorderLight]     = WithA(Lift(bg, 0.12f), 0.6f);
	col[ImGuiCol_TableRowBg]           = ImVec4(0, 0, 0, 0);
	col[ImGuiCol_TableRowBgAlt]        = WithA(Lift(bg, 0.04f), 0.5f);
	col[ImGuiCol_TextSelectedBg]       = WithA(accent, 0.35f);
	col[ImGuiCol_DragDropTarget]       = accent;
	col[ImGuiCol_NavCursor]            = accent;
	col[ImGuiCol_ModalWindowDimBg]     = ImVec4(0, 0, 0, 0.5f);
}

void ResetToDefault()
{
	s_cfg = DefaultConfig();
	Apply();
	Save();
}

void Save()
{
	const char* path = CfgPath();
	if (!path) return;
	FILE* f = nullptr;
	if (fopen_s(&f, path, "wb") != 0 || !f) return;
	const Config& c = s_cfg;
	fprintf(f, "accent=%f,%f,%f,%f\n", c.accent.x, c.accent.y, c.accent.z, c.accent.w);
	fprintf(f, "background=%f,%f,%f,%f\n", c.background.x, c.background.y, c.background.z, c.background.w);
	fprintf(f, "text=%f,%f,%f,%f\n", c.text.x, c.text.y, c.text.z, c.text.w);
	fprintf(f, "rounding=%f\n", c.rounding);
	fprintf(f, "alpha=%f\n", c.alpha);
	fprintf(f, "fontScale=%f\n", c.fontScale);
	fprintf(f, "compact=%d\n", c.compact ? 1 : 0);
	fprintf(f, "menuKey=%d\n", (int)settings.KeyBinds.Toggle_Menu);
	fclose(f);
}

void Load()
{
	s_cfg = DefaultConfig();
	const char* path = CfgPath();
	if (!path) return;
	FILE* f = nullptr;
	if (fopen_s(&f, path, "rb") != 0 || !f) return;
	char line[256];
	while (fgets(line, sizeof(line), f)) {
		char* eq = strchr(line, '=');
		if (!eq) continue;
		*eq = 0;
		const char* key = line;
		const char* val = eq + 1;
		ImVec4 v4;
		float v1;
		int vi;
		if (sscanf_s(val, "%f,%f,%f,%f", &v4.x, &v4.y, &v4.z, &v4.w) == 4) {
			if (!strcmp(key, "accent")) s_cfg.accent = v4;
			else if (!strcmp(key, "background")) s_cfg.background = v4;
			else if (!strcmp(key, "text")) s_cfg.text = v4;
		}
		if (sscanf_s(val, "%f", &v1) == 1) {
			if (!strcmp(key, "rounding")) s_cfg.rounding = v1;
			else if (!strcmp(key, "alpha")) s_cfg.alpha = v1;
			else if (!strcmp(key, "fontScale")) s_cfg.fontScale = v1;
		}
		if (sscanf_s(val, "%d", &vi) == 1) {
			if (!strcmp(key, "compact")) s_cfg.compact = vi != 0;
			else if (!strcmp(key, "menuKey") && vi > 0 && vi < 256)
				settings.KeyBinds.Toggle_Menu = (uint8_t)vi;
		}
	}
	fclose(f);
	auto clampf = [](float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); };
	s_cfg.rounding  = clampf(s_cfg.rounding, 0.f, 14.f);
	s_cfg.alpha     = clampf(s_cfg.alpha, 0.3f, 1.f);
	s_cfg.fontScale = clampf(s_cfg.fontScale, 0.7f, 1.6f);

	// Colours were unclamped: text alpha 0 renders an invisible, unrecoverable menu.
	auto clampCol = [&](ImVec4& c, float minAlpha) {
		c.x = clampf(c.x, 0.f, 1.f);
		c.y = clampf(c.y, 0.f, 1.f);
		c.z = clampf(c.z, 0.f, 1.f);
		c.w = clampf(c.w, minAlpha, 1.f);
	};
	clampCol(s_cfg.accent, 0.25f);
	clampCol(s_cfg.background, 0.25f);
	clampCol(s_cfg.text, 0.5f);
}

bool TabButton(const char* label, bool active)
{
	const Config& c = s_cfg;
	ImGui::PushStyleColor(ImGuiCol_Button, active
		? ImVec4(c.accent.x, c.accent.y, c.accent.z, 0.28f)
		: ImVec4(0, 0, 0, 0));
	ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(c.accent.x, c.accent.y, c.accent.z, 0.18f));
	ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(c.accent.x, c.accent.y, c.accent.z, 0.38f));
	ImGui::PushStyleColor(ImGuiCol_Text, active ? c.text : Mix(c.text, c.background, 0.35f));
	ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(11.f, 5.f));

	const bool clicked = ImGui::Button(label);

	if (active) {
		const ImVec2 mn = ImGui::GetItemRectMin();
		const ImVec2 mx = ImGui::GetItemRectMax();
		ImGui::GetWindowDrawList()->AddRectFilled(
			ImVec2(mn.x + 3.f, mx.y - 2.f), ImVec2(mx.x - 3.f, mx.y),
			ImGui::GetColorU32(c.accent), 1.f);
	}

	ImGui::PopStyleVar();
	ImGui::PopStyleColor(4);
	return clicked;
}

void DrawEditor()
{
	Config& c = s_cfg;
	bool changed = false;

	ImGui::SeparatorText("Presets");
	for (int i = 0; i < IM_ARRAYSIZE(kPresets); i++) {
		if (i > 0) ImGui::SameLine();
		if (ImGui::Button(kPresets[i].name)) {
			c.accent = kPresets[i].accent;
			c.background = kPresets[i].bg;
			changed = true;
		}
	}

	ImGui::SeparatorText("Colors");
	const ImGuiColorEditFlags cf = ImGuiColorEditFlags_NoInputs;
	changed |= ImGui::ColorEdit4("Accent", &c.accent.x, cf);
	changed |= ImGui::ColorEdit4("Background", &c.background.x, cf);
	changed |= ImGui::ColorEdit4("Text", &c.text.x, cf);

	ImGui::SeparatorText("Shape");
	changed |= ImGui::SliderFloat("Rounding", &c.rounding, 0.f, 14.f, "%.0f px");
	changed |= ImGui::SliderFloat("Opacity", &c.alpha, 0.3f, 1.f, "%.2f");
	changed |= ImGui::SliderFloat("UI scale", &c.fontScale, 0.7f, 1.6f, "%.2fx");
	changed |= ImGui::Checkbox("Compact mode", &c.compact);

	ImGui::SeparatorText("Keybind");
	static bool s_waitingKey = false;
	if (s_waitingKey) {
		ImGui::Button("press any key...", ImVec2(160.f, 0.f));
		for (uint8_t k : KeyBinds::GetValidKeys()) {
			if (KeyBinds::IsKeyPressed(k)) {
				if (k != VK_ESCAPE) {
					settings.KeyBinds.Toggle_Menu = k;
					changed = true;
				}
				s_waitingKey = false;
				break;
			}
		}
	} else {
		char buf[64];
		snprintf(buf, sizeof(buf), "Menu key: %s", KeyBinds::ToString(settings.KeyBinds.Toggle_Menu));
		if (ImGui::Button(buf, ImVec2(160.f, 0.f)))
			s_waitingKey = true;
	}
	ImGui::SameLine();
	ImGui::TextDisabled("(Esc cancels)");

	ImGui::Dummy(ImVec2(0.f, 6.f));
	if (ImGui::Button("Reset to default"))
		ResetToDefault();

	if (changed) {
		Apply();
		Save();
	}
}

} // namespace Theme
