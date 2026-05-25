#pragma once

namespace FpsSetter {

    void Tick();              // lazily resolves Application class; applies pending fps change
    void SetTargetFps(int fps); // -1 = uncapped, >0 = cap
    int  GetTargetFps();

} // namespace FpsSetter
