#pragma once
#include <cstdint>
#include <string>
#include <vector>

struct SkinEntry {
    int32_t     id;
    std::string name;
};

namespace SkinDatabase {
    // Parses data/objects.xml next to the DLL. Safe to call multiple times; only loads once.
    bool Load();

    bool                          IsLoaded();
    const std::vector<SkinEntry>& GetAll();
}
