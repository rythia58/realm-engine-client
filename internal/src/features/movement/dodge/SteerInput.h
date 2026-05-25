#pragma once

// SteerInput — debounced read of the player's WASD intent from the local
// FKALGHJIADI entity fields (Player_Moving / MoveDirX / MoveDirY).
//
// The game writes these every frame from the InputHandler's camera-rotated
// WASD mapping. We layer a small debounce on top so the DangerPlanner
// doesn't mode-flicker if the game clears moveDir for a single frame on key
// release.
namespace SteerInput {

struct SteerState {
    bool  active;  // true when player is actively pressing a movement key
    float dirX;    // normalized world-space direction (invalid if !active)
    float dirY;
};

// Call every frame from the game thread (AppEngineManager::Update hook).
void Tick();

// Snapshot the most recent state. Safe from any thread.
SteerState Get();

// Edge: active → idle. Consumed once by the planner to force an immediate
// replan so the frame the user releases WASD already moves toward safety.
bool ConsumeReleaseEdge();

// Debounce stubs — retained as no-ops for API compatibility. Transitions
// are now instantaneous; the planner handles them on the release edge.
void  SetDebounce(int onFrames, int offFrames);
void  GetDebounce(int& outOnFrames, int& outOffFrames);

} // namespace SteerInput
