#include "pch-il2cpp.h"

#include "gui/tabs/ScriptsTAB.h"
#include "gui/Theme.h"
#include "VisualScriptStore.h"
#include "IpcBridge.h"

#include <imgui/imgui.h>
#include <imgui/imgui_internal.h>
#include <string>
#include <vector>
#include <cstdio>
#include <cstring>
#include <cmath>

using VisualScriptStore::Graph;
using VisualScriptStore::GraphLink;
using VisualScriptStore::GraphNode;
using VisualScriptStore::NodeDef;

namespace {

bool s_editorOpen = false;
std::string s_selectedId;
std::string s_selectedNode;
int s_selectedLink = -1;
ImVec2 s_pan{ 40.f, 40.f };
float s_zoom = 1.f;
bool s_dirty = false;
int s_uidCounter = 0;

struct PendingLink { bool active = false; std::string from, fromPort, type; };
PendingLink s_linkDrag;

ImU32 CategoryColor(const std::string& cat)
{
	if (cat == "entry")   return IM_COL32(76, 175, 125, 255);
	if (cat == "control") return IM_COL32(201, 162, 39, 255);
	if (cat == "data")    return IM_COL32(74, 144, 217, 255);
	return IM_COL32(176, 106, 212, 255);
}

std::string NewNodeId()
{
	char buf[32];
	snprintf(buf, sizeof(buf), "n%d%d", (int)(ImGui::GetTime() * 1000) % 100000, s_uidCounter++);
	return buf;
}

ImVec2 NodeSize(const NodeDef* def)
{
	const int rows = def ? (int)(def->inputs.size() > def->outputs.size() ? def->inputs.size() : def->outputs.size()) : 1;
	return ImVec2(190.f, 34.f + rows * 20.f + 8.f);
}

ImVec2 PortPos(const GraphNode& n, const NodeDef* def, const std::string& port, bool isOutput, const ImVec2& origin)
{
	const ImVec2 size = NodeSize(def);
	const auto& ports = isOutput ? def->outputs : def->inputs;
	int idx = 0;
	for (size_t i = 0; i < ports.size(); ++i)
		if (ports[i].name == port) { idx = (int)i; break; }
	const float y = origin.y + (n.y * s_zoom) + (34.f + idx * 20.f + 10.f) * s_zoom;
	const float x = origin.x + (n.x * s_zoom) + (isOutput ? size.x * s_zoom : 0.f);
	return ImVec2(x, y);
}

void DrawLinkCurve(ImDrawList* dl, const ImVec2& a, const ImVec2& b, ImU32 col, bool dashed, float thick)
{
	const float dx = (std::max)(40.f * s_zoom, std::fabs(b.x - a.x) * 0.5f);
	if (!dashed) {
		dl->AddBezierCubic(a, ImVec2(a.x + dx, a.y), ImVec2(b.x - dx, b.y), b, col, thick);
		return;
	}
	// Dashed data links — sample the curve and skip alternate segments.
	const int steps = 24;
	ImVec2 prev = a;
	for (int i = 1; i <= steps; ++i) {
		const float t = (float)i / steps;
		const float u = 1.f - t;
		const ImVec2 p(
			u * u * u * a.x + 3 * u * u * t * (a.x + dx) + 3 * u * t * t * (b.x - dx) + t * t * t * b.x,
			u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y);
		if (i % 2 == 0) dl->AddLine(prev, p, col, thick);
		prev = p;
	}
}

// Labels sit above their control — ImGui's inline labels get clipped in a narrow panel.
void FieldLabel(const std::string& text)
{
	ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.62f, 0.65f, 0.72f, 1.f));
	ImGui::PushTextWrapPos(0.f);
	ImGui::TextUnformatted(text.c_str());
	ImGui::PopTextWrapPos();
	ImGui::PopStyleColor();
}

void ParamEditor(GraphNode& node, const NodeDef* def)
{
	if (!def) return;
	for (const auto& p : def->params) {
		const char* cur = node.Param(p.key.c_str());
		std::string value = cur ? cur : p.value;
		ImGui::PushID(p.key.c_str());

		if (p.type == "boolean") {
			bool on = value == "true" || value == "1";
			if (ImGui::Checkbox(p.label.c_str(), &on)) {
				node.SetParam(p.key.c_str(), on ? "true" : "false");
				s_dirty = true;
			}
		} else {
			FieldLabel(p.label);
			ImGui::SetNextItemWidth(-1.f);
			if (p.type == "select" && !p.options.empty()) {
				if (ImGui::BeginCombo("##v", value.c_str())) {
					for (const auto& opt : p.options) {
						if (ImGui::Selectable(opt.c_str(), opt == value)) {
							node.SetParam(p.key.c_str(), opt.c_str());
							s_dirty = true;
						}
					}
					ImGui::EndCombo();
				}
			} else if (p.type == "number") {
				float f = (float)atof(value.c_str());
				if (ImGui::InputFloat("##v", &f, 0.f, 0.f, "%.2f")) {
					char buf[32];
					snprintf(buf, sizeof(buf), "%g", f);
					node.SetParam(p.key.c_str(), buf);
					s_dirty = true;
				}
			} else {
				char buf[512];
				snprintf(buf, sizeof(buf), "%s", value.c_str());
				if (ImGui::InputText("##v", buf, sizeof(buf))) {
					node.SetParam(p.key.c_str(), buf);
					s_dirty = true;
				}
			}
		}
		ImGui::PopID();
	}
}

void DrawPalette(Graph& g)
{
	ImGui::BeginChild("##palette", ImVec2(150.f, 0.f), true);
	const char* cats[] = { "entry", "control", "data", "action" };
	const char* catLabels[] = { "ENTRY", "CONTROL", "DATA", "ACTION" };
	for (int c = 0; c < 4; ++c) {
		ImGui::TextColored(ImGui::ColorConvertU32ToFloat4(CategoryColor(cats[c])), "%s", catLabels[c]);
		for (const auto& def : VisualScriptStore::Defs()) {
			if (def.category != cats[c]) continue;
			if (ImGui::Selectable(def.label.c_str())) {
				GraphNode n;
				n.id = NewNodeId();
				n.type = def.type;
				n.x = (200.f - s_pan.x) / s_zoom;
				n.y = (150.f - s_pan.y) / s_zoom;
				for (const auto& p : def.params) n.params.emplace_back(p.key, p.value);
				g.nodes.push_back(n);
				s_selectedNode = n.id;
				s_dirty = true;
			}
			if (ImGui::IsItemHovered() && !def.description.empty())
				ImGui::SetTooltip("%s", def.description.c_str());
		}
		ImGui::Spacing();
	}
	ImGui::EndChild();
}

void DrawCanvas(Graph& g)
{
	ImGui::BeginChild("##canvas", ImVec2(-310.f, 0.f), true,
		ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoMove);

	const ImVec2 canvasPos = ImGui::GetCursorScreenPos();
	const ImVec2 canvasSize = ImGui::GetContentRegionAvail();
	ImDrawList* dl = ImGui::GetWindowDrawList();
	dl->AddRectFilled(canvasPos, ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y), IM_COL32(18, 18, 23, 255));

	const float grid = 24.f * s_zoom;
	for (float x = fmodf(s_pan.x, grid); x < canvasSize.x; x += grid)
		dl->AddLine(ImVec2(canvasPos.x + x, canvasPos.y), ImVec2(canvasPos.x + x, canvasPos.y + canvasSize.y), IM_COL32(40, 40, 48, 120));
	for (float y = fmodf(s_pan.y, grid); y < canvasSize.y; y += grid)
		dl->AddLine(ImVec2(canvasPos.x, canvasPos.y + y), ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + y), IM_COL32(40, 40, 48, 120));

	const ImVec2 origin(canvasPos.x + s_pan.x, canvasPos.y + s_pan.y);

	// Without this the full-canvas button swallows every click before the nodes
	// drawn on top of it get a chance to claim one.
	ImGui::SetNextItemAllowOverlap();
	ImGui::InvisibleButton("##canvasSurface", canvasSize, ImGuiButtonFlags_MouseButtonLeft | ImGuiButtonFlags_MouseButtonRight);
	const bool canvasHovered = ImGui::IsItemHovered();
	const bool canvasClaimedClick = ImGui::IsItemActive();
	if (canvasHovered && ImGui::IsMouseDragging(ImGuiMouseButton_Right)) {
		const ImVec2 d = ImGui::GetIO().MouseDelta;
		s_pan.x += d.x;
		s_pan.y += d.y;
	}
	if (canvasHovered && ImGui::GetIO().MouseWheel != 0.f) {
		const float prev = s_zoom;
		s_zoom = ImClamp(s_zoom * (ImGui::GetIO().MouseWheel > 0 ? 1.1f : 0.9f), 0.4f, 2.f);
		const ImVec2 m = ImGui::GetIO().MousePos;
		s_pan.x = m.x - canvasPos.x - ((m.x - canvasPos.x - s_pan.x) / prev) * s_zoom;
		s_pan.y = m.y - canvasPos.y - ((m.y - canvasPos.y - s_pan.y) / prev) * s_zoom;
	}
	// Deselect only when the click landed on bare canvas, not on a node above it.
	if (canvasClaimedClick && ImGui::IsMouseClicked(ImGuiMouseButton_Left) && !s_linkDrag.active) {
		s_selectedNode.clear();
		s_selectedLink = -1;
	}

	// Links under nodes.
	for (size_t li = 0; li < g.links.size(); ++li) {
		const auto& l = g.links[li];
		const GraphNode* fromNode = nullptr;
		const GraphNode* toNode = nullptr;
		for (const auto& n : g.nodes) {
			if (n.id == l.from) fromNode = &n;
			if (n.id == l.to) toNode = &n;
		}
		if (!fromNode || !toNode) continue;
		const NodeDef* fd = VisualScriptStore::FindDef(fromNode->type.c_str());
		const NodeDef* td = VisualScriptStore::FindDef(toNode->type.c_str());
		if (!fd || !td) continue;
		const ImVec2 a = PortPos(*fromNode, fd, l.fromPort, true, origin);
		const ImVec2 b = PortPos(*toNode, td, l.toPort, false, origin);
		const ImU32 col = (int)li == s_selectedLink ? IM_COL32(255, 255, 255, 255)
			: (l.isData ? IM_COL32(74, 144, 217, 220) : IM_COL32(201, 162, 39, 230));
		DrawLinkCurve(dl, a, b, col, l.isData, 2.f * s_zoom);

		// Clickable midpoint handle — a filled dot the user can actually aim at.
		const ImVec2 mid((a.x + b.x) * 0.5f, (a.y + b.y) * 0.5f);
		dl->AddCircleFilled(mid, 4.f * s_zoom, col);
		if (canvasHovered && ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
			const ImVec2 m = ImGui::GetIO().MousePos;
			if (std::fabs(m.x - mid.x) < 9.f && std::fabs(m.y - mid.y) < 9.f) {
				s_selectedLink = (int)li;
				s_selectedNode.clear();
			}
		}
	}

	// Nodes.
	for (auto& n : g.nodes) {
		const NodeDef* def = VisualScriptStore::FindDef(n.type.c_str());
		if (!def) continue;
		const ImVec2 size = NodeSize(def);
		const ImVec2 tl(origin.x + n.x * s_zoom, origin.y + n.y * s_zoom);
		const ImVec2 br(tl.x + size.x * s_zoom, tl.y + size.y * s_zoom);
		if (br.x < canvasPos.x || tl.x > canvasPos.x + canvasSize.x ||
			br.y < canvasPos.y || tl.y > canvasPos.y + canvasSize.y) continue;

		const bool selected = n.id == s_selectedNode;
		dl->AddRectFilled(tl, br, IM_COL32(30, 30, 38, 245), 5.f * s_zoom);
		dl->AddRectFilled(tl, ImVec2(br.x, tl.y + 24.f * s_zoom), CategoryColor(def->category), 5.f * s_zoom, ImDrawFlags_RoundCornersTop);
		dl->AddRect(tl, br, selected ? IM_COL32(143, 123, 255, 255) : IM_COL32(60, 60, 75, 255), 5.f * s_zoom, 0, selected ? 2.f : 1.f);
		dl->AddText(ImVec2(tl.x + 8.f * s_zoom, tl.y + 4.f * s_zoom), IM_COL32(15, 15, 20, 255), def->label.c_str());

		ImGui::PushID(n.id.c_str());

		// Whole node selects; header (submitted after) drags; ports (after that) link.
		ImGui::SetCursorScreenPos(tl);
		ImGui::SetNextItemAllowOverlap();
		ImGui::InvisibleButton("##body", ImVec2(size.x * s_zoom, size.y * s_zoom));
		if (ImGui::IsItemClicked()) { s_selectedNode = n.id; s_selectedLink = -1; }

		ImGui::SetCursorScreenPos(tl);
		ImGui::SetNextItemAllowOverlap();
		ImGui::InvisibleButton("##head", ImVec2(size.x * s_zoom, 24.f * s_zoom));
		if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)) {
			const ImVec2 d = ImGui::GetIO().MouseDelta;
			n.x += d.x / s_zoom;
			n.y += d.y / s_zoom;
			s_dirty = true;
		}
		if (ImGui::IsItemClicked()) { s_selectedNode = n.id; s_selectedLink = -1; }

		// Ports.
		const float dotR = 5.f * s_zoom;
		for (size_t i = 0; i < def->inputs.size(); ++i) {
			const ImVec2 p = PortPos(n, def, def->inputs[i].name, false, origin);
			const bool isFlow = def->inputs[i].type == "flow";
			if (isFlow) dl->AddRectFilled(ImVec2(p.x - dotR, p.y - dotR), ImVec2(p.x + dotR, p.y + dotR), IM_COL32(201, 162, 39, 255), 2.f);
			else dl->AddCircleFilled(p, dotR, IM_COL32(74, 144, 217, 255));
			dl->AddText(ImVec2(p.x + 9.f * s_zoom, p.y - 7.f * s_zoom), IM_COL32(190, 195, 210, 255), def->inputs[i].name.c_str());

			ImGui::SetCursorScreenPos(ImVec2(p.x - dotR - 3.f, p.y - dotR - 3.f));
			ImGui::PushID((int)i + 1000);
			ImGui::InvisibleButton("##in", ImVec2(dotR * 2.f + 6.f, dotR * 2.f + 6.f));
			if (s_linkDrag.active && ImGui::IsItemHovered() && ImGui::IsMouseReleased(ImGuiMouseButton_Left)) {
				const bool bothFlow = (s_linkDrag.type == "flow") == isFlow;
				if (bothFlow && s_linkDrag.from != n.id) {
					for (size_t k = 0; k < g.links.size(); ) {
						const bool sameIn = g.links[k].to == n.id && g.links[k].toPort == def->inputs[i].name && g.links[k].isData == !isFlow;
						const bool sameOut = isFlow && g.links[k].from == s_linkDrag.from && g.links[k].fromPort == s_linkDrag.fromPort;
						if (sameIn || sameOut) g.links.erase(g.links.begin() + k);
						else ++k;
					}
					GraphLink l;
					l.from = s_linkDrag.from; l.fromPort = s_linkDrag.fromPort;
					l.to = n.id; l.toPort = def->inputs[i].name;
					l.isData = !isFlow;
					g.links.push_back(l);
					s_dirty = true;
				}
				s_linkDrag = PendingLink{};
			}
			ImGui::PopID();
		}
		for (size_t i = 0; i < def->outputs.size(); ++i) {
			const ImVec2 p = PortPos(n, def, def->outputs[i].name, true, origin);
			const bool isFlow = def->outputs[i].type == "flow";
			if (isFlow) dl->AddRectFilled(ImVec2(p.x - dotR, p.y - dotR), ImVec2(p.x + dotR, p.y + dotR), IM_COL32(201, 162, 39, 255), 2.f);
			else dl->AddCircleFilled(p, dotR, IM_COL32(74, 144, 217, 255));
			const ImVec2 ts = ImGui::CalcTextSize(def->outputs[i].name.c_str());
			dl->AddText(ImVec2(p.x - 9.f * s_zoom - ts.x, p.y - 7.f * s_zoom), IM_COL32(190, 195, 210, 255), def->outputs[i].name.c_str());

			ImGui::SetCursorScreenPos(ImVec2(p.x - dotR - 3.f, p.y - dotR - 3.f));
			ImGui::PushID((int)i + 2000);
			ImGui::InvisibleButton("##out", ImVec2(dotR * 2.f + 6.f, dotR * 2.f + 6.f));
			if (ImGui::IsItemClicked()) {
				s_linkDrag.active = true;
				s_linkDrag.from = n.id;
				s_linkDrag.fromPort = def->outputs[i].name;
				s_linkDrag.type = def->outputs[i].type;
			}
			ImGui::PopID();
		}
		ImGui::PopID();
	}

	if (s_linkDrag.active) {
		for (const auto& n : g.nodes) {
			if (n.id != s_linkDrag.from) continue;
			const NodeDef* def = VisualScriptStore::FindDef(n.type.c_str());
			if (!def) break;
			const ImVec2 a = PortPos(n, def, s_linkDrag.fromPort, true, origin);
			DrawLinkCurve(dl, a, ImGui::GetIO().MousePos, IM_COL32(160, 160, 160, 200), true, 2.f);
			break;
		}
		if (ImGui::IsMouseReleased(ImGuiMouseButton_Left)) s_linkDrag = PendingLink{};
	}

	ImGui::EndChild();
}

void DrawInspector(Graph& g)
{
	ImGui::SameLine();
	ImGui::BeginChild("##inspector", ImVec2(0.f, 0.f), true);

	ImGui::SeparatorText("Script");
	{
		char buf[128];
		snprintf(buf, sizeof(buf), "%s", g.name.c_str());
		FieldLabel("Name");
		ImGui::SetNextItemWidth(-1.f);
		if (ImGui::InputText("##scriptName", buf, sizeof(buf))) { g.name = buf; s_dirty = true; }
		if (ImGui::Checkbox("Enabled", &g.enabled)) s_dirty = true;
		FieldLabel("Idle fail-safe (sec, 0 = off)");
		ImGui::SetNextItemWidth(-1.f);
		if (ImGui::InputInt("##idleFailSafe", &g.idleFailSafeSec)) s_dirty = true;
	}

	if (s_selectedLink >= 0 && s_selectedLink < (int)g.links.size()) {
		const auto& l = g.links[s_selectedLink];
		ImGui::SeparatorText("Link");
		ImGui::TextWrapped("%s.%s -> %s.%s", l.from.c_str(), l.fromPort.c_str(), l.to.c_str(), l.toPort.c_str());
		if (ImGui::Button("Delete link")) {
			g.links.erase(g.links.begin() + s_selectedLink);
			s_selectedLink = -1;
			s_dirty = true;
		}
	}

	GraphNode* node = nullptr;
	for (auto& n : g.nodes)
		if (n.id == s_selectedNode) { node = &n; break; }

	if (node) {
		const NodeDef* def = VisualScriptStore::FindDef(node->type.c_str());
		ImGui::SeparatorText(def ? def->label.c_str() : node->type.c_str());
		ImGui::TextDisabled("id: %s", node->id.c_str());
		if (def && !def->description.empty()) ImGui::TextWrapped("%s", def->description.c_str());
		ParamEditor(*node, def);
		ImGui::Spacing();
		if (ImGui::Button("Delete node")) {
			const std::string id = node->id;
			for (size_t k = 0; k < g.links.size(); ) {
				if (g.links[k].from == id || g.links[k].to == id) g.links.erase(g.links.begin() + k);
				else ++k;
			}
			for (size_t k = 0; k < g.nodes.size(); ++k)
				if (g.nodes[k].id == id) { g.nodes.erase(g.nodes.begin() + k); break; }
			s_selectedNode.clear();
			s_dirty = true;
		}
	} else if (s_selectedLink < 0) {
		ImGui::Spacing();
		ImGui::TextDisabled("Click a node to edit it.\nDrag an output dot to an input\ndot to connect.\nRight-drag to pan, wheel to zoom.");
	}

	ImGui::EndChild();
}

} // namespace

bool ScriptsTAB::IsEditorOpen() { return s_editorOpen; }

void ScriptsTAB::Render()
{
	std::vector<VisualScriptStore::ScriptEntry> list;
	VisualScriptStore::CopyList(list);

	if (list.empty()) {
		ImGui::Dummy(ImVec2(0.f, 6.f));
		ImGui::TextDisabled("No scripts yet.");
		ImGui::TextWrapped("Visual scripts live in the client. Make one here or in the dashboard "
		                   "(localhost:4440 -> Scripts -> Visual Editor).");
	}

	if (ImGui::Button("New script")) {
		Graph& g = VisualScriptStore::Editing();
		g = Graph{};
		char buf[32];
		snprintf(buf, sizeof(buf), "ingame-%d", (int)ImGui::GetTime());
		g.id = buf;
		g.name = "New Script";
		g.loaded = true;
		GraphNode start;
		start.id = NewNodeId();
		start.type = "Start";
		start.x = 60.f; start.y = 80.f;
		g.nodes.push_back(start);
		s_selectedId = g.id;
		s_editorOpen = true;
		s_dirty = true;
	}
	ImGui::SameLine();
	if (ImGui::Button(s_editorOpen ? "Close editor" : "Open editor")) s_editorOpen = !s_editorOpen;

	ImGui::Separator();

	const float col2 = ImGui::GetContentRegionAvail().x - 150.f;
	for (const auto& s : list) {
		ImGui::PushID(s.id.c_str());
		bool on = s.enabled;
		if (ImGui::Checkbox(s.name.c_str(), &on))
			IpcBridge_EmitVisualScriptSetEnabled(s.id.c_str(), on);

		ImGui::SameLine(col2);
		ImGui::TextDisabled("%d nodes", s.nodeCount);
		ImGui::SameLine();
		if (ImGui::SmallButton("Edit")) {
			s_selectedId = s.id;
			VisualScriptStore::RequestGraph(s.id.c_str());
			s_editorOpen = true;
			s_selectedNode.clear();
			s_selectedLink = -1;
			s_dirty = false;
		}
		ImGui::PopID();
	}
}

void ScriptsTAB::RenderEditorWindow()
{
	if (!s_editorOpen) return;

	ImGui::SetNextWindowSize(ImVec2(1000.f, 620.f), ImGuiCond_FirstUseEver);
	ImGui::SetNextWindowPos(ImVec2(120.f, 120.f), ImGuiCond_FirstUseEver);
	if (!ImGui::Begin("Script Editor##VisualScripts", &s_editorOpen)) {
		ImGui::End();
		return;
	}

	Graph& g = VisualScriptStore::Editing();

	if (ImGui::Button("Save")) {
		VisualScriptStore::SaveEditing();
		s_dirty = false;
	}
	ImGui::SameLine();
	if (ImGui::Button("Reload")) {
		if (!g.id.empty()) VisualScriptStore::RequestGraph(g.id.c_str());
		s_dirty = false;
	}
	ImGui::SameLine();
	ImGui::TextDisabled("%s%s", g.id.empty() ? "(no script)" : g.id.c_str(), s_dirty ? " *" : "");

	if (VisualScriptStore::Defs().empty()) {
		ImGui::Separator();
		ImGui::TextWrapped("Waiting for the node catalog from the client...");
		ImGui::End();
		return;
	}

	if (!g.loaded && !g.id.empty()) {
		ImGui::Separator();
		ImGui::TextDisabled("Loading %s...", g.id.c_str());
		ImGui::End();
		return;
	}

	ImGui::Separator();
	DrawPalette(g);
	ImGui::SameLine();
	DrawCanvas(g);
	DrawInspector(g);

	ImGui::End();
}
