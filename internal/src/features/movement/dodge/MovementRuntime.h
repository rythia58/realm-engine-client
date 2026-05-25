#pragma once

namespace DodgeRuntime {

bool  EnsureResolved();
float GetDeltaTime();
float GetMoveSpeedMul(void* player);
bool  CallMoveTo(void* player, float x, float y);
void  Reset();

} // namespace DodgeRuntime
