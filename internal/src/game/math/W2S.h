#pragma once
#include <cmath>

// ─────────────────────────────────────────────────────────────────────────────
// RotMG World ↔ Screen projection (top-down 2D, camera-angle-aware)
//
// Parameters shared by both functions:
//   camX/camY  – world position of the camera (= local player world X/Y)
//   angle      – camera rotation in RADIANS  (default 45° = PI/4)
//   zoom       – pixels per world tile = screenH / (2 * orthographicSize)
//   cx/cy      – screen-space centre in pixels
//
// W2S formula derivation:
//   Translate world tile to camera-relative offset (dx, dz),
//   apply 2-D rotation by camera angle,
//   scale by pixels-per-tile and add screen centre.
//
// S2W is the exact algebraic inverse (transpose rotation, divide by zoom).
// ─────────────────────────────────────────────────────────────────────────────

inline bool W2S(float tileX,   float tileY,
                float& outSX,  float& outSY,
                float camX,    float camY,
                float angle,   float zoom,
                float cx,      float cy)
{
    const float dx   = tileX - camX;
    const float dz   = tileY - camY;
    const float cosA = cosf(angle);
    const float sinA = sinf(angle);
    outSX = cx + (dx * cosA - dz * sinA) * zoom;
    outSY = cy + (dx * sinA + dz * cosA) * zoom;
    return true;
}

// Returns false if zoom == 0 (degenerate).
inline bool S2W(float screenX,    float screenY,
                float& outWorldX, float& outWorldY,
                float camX,       float camY,
                float angle,      float zoom,
                float cx,         float cy)
{
    if (zoom == 0.f) return false;
    const float cosA = cosf(angle);
    const float sinA = sinf(angle);
    const float lx = (screenX - cx) / zoom;
    const float lz = (screenY - cy) / zoom;
    // Inverse rotation (transpose):  [cosA  sinA] T = [cosA -sinA]
    //                                [-sinA cosA]     [sinA  cosA]
    outWorldX = camX + lx * cosA + lz * sinA;
    outWorldY = camY - lx * sinA + lz * cosA;
    return true;
}
