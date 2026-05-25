#include "pch-il2cpp.h"
#include "SkinDatabase.h"

#include <Windows.h>
#include <ShlObj.h>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <cctype>

// Parses objects.xml for <Object type="0x..." id="..."> blocks that contain
// <Class>Skin</Class>. No XML library — the format is consistent enough for
// simple string scanning.

namespace SkinDatabase {

static std::vector<SkinEntry> s_skins;
static bool                   s_loaded = false;

static std::wstring GetXmlPath()
{
    wchar_t docs[MAX_PATH]{};
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_PERSONAL, nullptr, SHGFP_TYPE_CURRENT, docs)))
        return {};
    std::wstring path = docs;
    path += L"\\Realmengine\\data\\objects.xml";
    return path;
}

static std::string ExtractAttr(const std::string& tag, const char* attr)
{
    // attr="value" — returns value or empty
    std::string key = std::string(attr) + "=\"";
    size_t pos = tag.find(key);
    if (pos == std::string::npos) return {};
    pos += key.size();
    size_t end = tag.find('"', pos);
    if (end == std::string::npos) return {};
    return tag.substr(pos, end - pos);
}

bool Load()
{
    if (s_loaded) return true;

    std::wstring path = GetXmlPath();
    std::ifstream f(path);
    if (!f.is_open()) return false;

    std::string content((std::istreambuf_iterator<char>(f)),
                         std::istreambuf_iterator<char>());

    const std::string OBJECT_OPEN  = "<Object ";
    const std::string OBJECT_CLOSE = "</Object>";
    const std::string CLASS_SKIN   = "<Class>Skin</Class>";

    size_t pos = 0;
    while ((pos = content.find(OBJECT_OPEN, pos)) != std::string::npos) {
        size_t tagEnd   = content.find('>', pos);
        size_t blockEnd = content.find(OBJECT_CLOSE, pos);

        if (tagEnd == std::string::npos || blockEnd == std::string::npos) break;

        bool isSkin = content.find(CLASS_SKIN, tagEnd) < blockEnd;
        if (isSkin) {
            std::string tag = content.substr(pos, tagEnd - pos + 1);

            std::string hexType = ExtractAttr(tag, "type");
            std::string name    = ExtractAttr(tag, "id");

            if (!hexType.empty() && !name.empty()) {
                int32_t id = static_cast<int32_t>(std::stoul(hexType, nullptr, 16));
                s_skins.push_back({ id, std::move(name) });
            }
        }

        pos = blockEnd + OBJECT_CLOSE.size();
    }

    std::sort(s_skins.begin(), s_skins.end(),
        [](const SkinEntry& a, const SkinEntry& b) { return a.name < b.name; });

    s_loaded = true;
    return !s_skins.empty();
}

bool                          IsLoaded() { return s_loaded; }
const std::vector<SkinEntry>& GetAll()   { return s_skins;  }

} // namespace SkinDatabase
