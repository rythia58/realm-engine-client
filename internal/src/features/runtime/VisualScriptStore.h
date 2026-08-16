#pragma once

#include <string>
#include <vector>

namespace VisualScriptStore {

struct ScriptEntry {
	std::string id;
	std::string name;
	bool enabled = false;
	int nodeCount = 0;
	std::string status;
};

struct PortDef {
	std::string name;
	std::string type;
};

struct ParamDef {
	std::string key;
	std::string label;
	std::string type;
	std::string value;
	std::vector<std::string> options;
};

struct NodeDef {
	std::string type;
	std::string label;
	std::string category;
	std::vector<PortDef> inputs;
	std::vector<PortDef> outputs;
	std::vector<ParamDef> params;
	std::string description;
};

struct GraphNode {
	std::string id;
	std::string type;
	float x = 0.f;
	float y = 0.f;
	std::vector<std::pair<std::string, std::string>> params;

	const char* Param(const char* key) const;
	void SetParam(const char* key, const char* value);
};

struct GraphLink {
	std::string from, fromPort, to, toPort;
	bool isData = false;
};

struct Graph {
	std::string id;
	std::string name;
	bool enabled = false;
	int idleFailSafeSec = 0;
	std::vector<GraphNode> nodes;
	std::vector<GraphLink> links;
	bool loaded = false;
};

void ApplyList(const char* spec);
void ApplyDefs(const char* spec);
void ApplyGraph(const char* spec);

// Reassembles "target|index|total|data" pieces, then dispatches to the Apply* above.
void ApplyChunk(const char* spec);

void CopyList(std::vector<ScriptEntry>& out);
const std::vector<NodeDef>& Defs();
const NodeDef* FindDef(const char* type);

Graph& Editing();
void RequestGraph(const char* id);
void SaveEditing();

std::string Serialize(const Graph& g);

} // namespace VisualScriptStore
