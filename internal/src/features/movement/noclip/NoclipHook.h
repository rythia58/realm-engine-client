#pragma once

namespace NoclipHook {

    // Lazy-installs the player noclip hooks once IL2CPP metadata is available.
    void Tick();
    void Uninstall();

    bool IsInstalled();
    bool IsResolved();

} // namespace NoclipHook
