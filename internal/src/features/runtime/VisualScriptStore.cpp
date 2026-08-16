#include "pch-il2cpp.h"

#include "VisualScriptStore.h"
#include "IpcBridge.h"

#include <mutex>
#include <cstdio>
#include <cstring>

namespace {

std::mutex s_mutex;
std::vector<VisualScriptStore::ScriptEntry> s_list;
std::vector<VisualScriptStore::NodeDef> s_defs;
VisualScriptStore::Graph s_editing;

std::vector<std::string> Split(const std::string& s, char sep)
{
	std::vector<std::string> out;
	size_t start = 0;
	while (true) {
		const size_t end = s.find(sep, start);
		out.push_back(s.substr(start, end == std::string::npos ? std::string::npos : end - start));
		if (end == std::string::npos) break;
		start = end + 1;
	}
	return out;
}

int HexVal(char c)
{
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

std::string UrlDecode(const std::string& s)
{
	std::string out;
	out.reserve(s.size());
	for (size_t i = 0; i < s.size(); ++i) {
		if (s[i] == '%' && i + 2 < s.size()) {
			const int hi = HexVal(s[i + 1]), lo = HexVal(s[i + 2]);
			if (hi >= 0 && lo >= 0) { out.push_back((char)(hi * 16 + lo)); i += 2; continue; }
		}
		out.push_back(s[i]);
	}
	return out;
}

std::string UrlEncode(const std::string& s)
{
	static const char* hex = "0123456789ABCDEF";
	std::string out;
	out.reserve(s.size());
	for (unsigned char c : s) {
		const bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '!' || c == '*' || c == '(' || c == ')';
		if (safe) out.push_back((char)c);
		else { out.push_back('%'); out.push_back(hex[c >> 4]); out.push_back(hex[c & 15]); }
	}
	return out;
}

} // namespace

namespace VisualScriptStore {

const char* GraphNode::Param(const char* key) const
{
	for (const auto& kv : params)
		if (kv.first == key) return kv.second.c_str();
	return nullptr;
}

void GraphNode::SetParam(const char* key, const char* value)
{
	for (auto& kv : params)
		if (kv.first == key) { kv.second = value; return; }
	params.emplace_back(key, value);
}

void ApplyList(const char* spec)
{
	std::vector<ScriptEntry> parsed;
	if (spec && *spec) {
		for (const auto& row : Split(spec, ';')) {
			if (row.empty()) continue;
			const auto f = Split(row, '|');
			if (f.size() < 5) continue;
			ScriptEntry e;
			e.id = f[0];
			e.name = UrlDecode(f[1]);
			e.enabled = f[2] == "1";
			e.nodeCount = atoi(f[3].c_str());
			e.status = f[4];
			parsed.push_back(std::move(e));
		}
	}
	std::lock_guard<std::mutex> lk(s_mutex);
	s_list.swap(parsed);
}

void ApplyDefs(const char* spec)
{
	std::vector<NodeDef> parsed;
	if (spec && *spec) {
		for (const auto& line : Split(spec, '\n')) {
			if (line.empty()) continue;
			const auto f = Split(line, '|');
			if (f.size() < 8 || f[0] != "D") continue;
			NodeDef d;
			d.type = f[1];
			d.label = UrlDecode(f[2]);
			d.category = f[3];
			for (const auto& p : Split(f[4], ',')) {
				if (p.empty()) continue;
				const auto kv = Split(p, ':');
				if (kv.size() == 2) d.inputs.push_back({ kv[0], kv[1] });
			}
			for (const auto& p : Split(f[5], ',')) {
				if (p.empty()) continue;
				const auto kv = Split(p, ':');
				if (kv.size() == 2) d.outputs.push_back({ kv[0], kv[1] });
			}
			for (const auto& p : Split(f[6], ';')) {
				if (p.empty()) continue;
				const auto pf = Split(p, '~');
				if (pf.size() < 4) continue;
				ParamDef pd;
				pd.key = pf[0];
				pd.label = UrlDecode(pf[1]);
				pd.type = pf[2];
				pd.value = UrlDecode(pf[3]);
				if (pf.size() >= 5 && !pf[4].empty()) pd.options = Split(pf[4], ',');
				d.params.push_back(std::move(pd));
			}
			d.description = UrlDecode(f[7]);
			parsed.push_back(std::move(d));
		}
	}
	std::lock_guard<std::mutex> lk(s_mutex);
	s_defs.swap(parsed);
}

void ApplyGraph(const char* spec)
{
	if (!spec || !*spec) return;
	std::string text(spec);
	const size_t nl = text.find('\n');
	if (nl == std::string::npos) return;

	Graph g;
	g.id = text.substr(0, nl);
	for (const auto& line : Split(text.substr(nl + 1), '\n')) {
		if (line.empty()) continue;
		const auto f = Split(line, '|');
		if (f[0] == "M" && f.size() >= 4) {
			g.name = UrlDecode(f[1]);
			g.enabled = f[2] == "1";
			g.idleFailSafeSec = atoi(f[3].c_str());
		} else if (f[0] == "N" && f.size() >= 6) {
			GraphNode n;
			n.id = f[1];
			n.type = f[2];
			n.x = (float)atof(f[3].c_str());
			n.y = (float)atof(f[4].c_str());
			for (const auto& kv : Split(f[5], '&')) {
				if (kv.empty()) continue;
				const size_t eq = kv.find('=');
				if (eq != std::string::npos)
					n.params.emplace_back(UrlDecode(kv.substr(0, eq)), UrlDecode(kv.substr(eq + 1)));
			}
			g.nodes.push_back(std::move(n));
		} else if (f[0] == "L" && f.size() >= 6) {
			GraphLink l;
			l.from = f[1]; l.fromPort = f[2]; l.to = f[3]; l.toPort = f[4];
			l.isData = f[5] == "data";
			g.links.push_back(std::move(l));
		}
	}
	g.loaded = true;
	std::lock_guard<std::mutex> lk(s_mutex);
	s_editing = std::move(g);
}

void ApplyChunk(const char* spec)
{
	if (!spec || !*spec) return;

	// target|index|total|data — data may itself contain '|', so split only the first three.
	const char* p = spec;
	const char* b1 = strchr(p, '|');
	if (!b1) return;
	const char* b2 = strchr(b1 + 1, '|');
	if (!b2) return;
	const char* b3 = strchr(b2 + 1, '|');
	if (!b3) return;

	const std::string target(p, b1 - p);
	const int index = atoi(std::string(b1 + 1, b2 - b1 - 1).c_str());
	const int total = atoi(std::string(b2 + 1, b3 - b2 - 1).c_str());
	const char* data = b3 + 1;
	if (total <= 0 || index < 0 || index >= total) return;

	static std::string s_buf;
	static std::string s_target;
	static int s_next = 0;

	if (index == 0) { s_buf.clear(); s_target = target; s_next = 0; }
	if (target != s_target || index != s_next) return;   // out of order — wait for a fresh index 0

	s_buf += data;
	s_next++;
	if (s_next < total) return;

	if (s_target == "defs") ApplyDefs(s_buf.c_str());
	else if (s_target == "list") ApplyList(s_buf.c_str());
	else if (s_target == "graph") ApplyGraph(s_buf.c_str());
	s_buf.clear();
	s_target.clear();
	s_next = 0;
}

void CopyList(std::vector<ScriptEntry>& out)
{
	std::lock_guard<std::mutex> lk(s_mutex);
	out = s_list;
}

const std::vector<NodeDef>& Defs()
{
	return s_defs;
}

const NodeDef* FindDef(const char* type)
{
	if (!type) return nullptr;
	for (const auto& d : s_defs)
		if (d.type == type) return &d;
	return nullptr;
}

Graph& Editing()
{
	return s_editing;
}

void RequestGraph(const char* id)
{
	if (!id || !*id) return;
	{
		std::lock_guard<std::mutex> lk(s_mutex);
		s_editing = Graph{};
		s_editing.id = id;
	}
	IpcBridge_EmitVisualScriptEvent("vsGet", id);
}

std::string Serialize(const Graph& g)
{
	std::string out = "M|" + UrlEncode(g.name) + "|" + (g.enabled ? "1" : "0") + "|" + std::to_string(g.idleFailSafeSec);
	char buf[64];
	for (const auto& n : g.nodes) {
		std::string params;
		for (const auto& kv : n.params) {
			if (!params.empty()) params += "&";
			params += UrlEncode(kv.first) + "=" + UrlEncode(kv.second);
		}
		snprintf(buf, sizeof(buf), "%d|%d", (int)n.x, (int)n.y);
		out += "\nN|" + n.id + "|" + n.type + "|" + buf + "|" + params;
	}
	for (const auto& l : g.links)
		out += "\nL|" + l.from + "|" + l.fromPort + "|" + l.to + "|" + l.toPort + "|" + (l.isData ? "data" : "flow");
	return out;
}

void SaveEditing()
{
	std::string payload;
	{
		std::lock_guard<std::mutex> lk(s_mutex);
		if (s_editing.id.empty()) return;
		payload = s_editing.id + "\n" + Serialize(s_editing);
	}
	IpcBridge_EmitVisualScriptEvent("vsSave", payload.c_str());
}

} // namespace VisualScriptStore
