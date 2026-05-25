#include "pch-il2cpp.h"
#include "MovementRuntime.h"

#include "Il2CppResolver.h"

#include <cmath>
#include <windows.h>

namespace {

using MoveToFn = bool(__fastcall*)(void* __this, float x, float y, void* methodInfo);
using CalcMoveSpeedFn = float(__fastcall*)(void* __this, void* methodInfo);
using GetDeltaTimeFn = float(__cdecl*)(void* method);

MoveToFn s_fnMoveTo = nullptr;
CalcMoveSpeedFn s_fnCalcMoveSpeed = nullptr;
GetDeltaTimeFn s_fnGetDeltaTime = nullptr;
bool s_moveResolved = false;
bool s_cmsResolved = false;
bool s_dtResolved = false;
float s_lastDeltaTime = 0.016f;

void ResolveMoveTo()
{
    if (s_moveResolved) return;
    Resolver::Protection::safe_call([&]() {
        Il2CppClass* klass = Resolver::FindClassLoose("FKALGHJIADI");
        if (!klass) return;
        const MethodInfo* mi = il2cpp_class_get_method_from_name(klass, "DGLCONCOIBO", 2);
        if (!mi || !mi->methodPointer) return;
        s_fnMoveTo = reinterpret_cast<MoveToFn>(mi->methodPointer);
        s_moveResolved = true;
    });
}

void ResolveCalcMoveSpeed()
{
    if (s_cmsResolved) return;
    Resolver::Protection::safe_call([&]() {
        Il2CppClass* klass = Resolver::FindClassLoose("FKALGHJIADI");
        if (!klass) return;
        const MethodInfo* mi = il2cpp_class_get_method_from_name(klass, "GCFKGLKAPND", 0);
        if (!mi || !mi->methodPointer) return;
        s_fnCalcMoveSpeed = reinterpret_cast<CalcMoveSpeedFn>(mi->methodPointer);
        s_cmsResolved = true;
    });
}

void ResolveDeltaTime()
{
    if (s_dtResolved) return;
    Resolver::Protection::safe_call([&]() {
        Il2CppClass* klass = Resolver::FindClass("UnityEngine", "Time");
        if (!klass) return;
        const MethodInfo* mi = il2cpp_class_get_method_from_name(klass, "get_deltaTime", 0);
        if (!mi || !mi->methodPointer) return;
        s_fnGetDeltaTime = reinterpret_cast<GetDeltaTimeFn>(mi->methodPointer);
        s_dtResolved = true;
    });
}

} // namespace

namespace DodgeRuntime {

bool EnsureResolved()
{
    ResolveMoveTo();
    ResolveCalcMoveSpeed();
    ResolveDeltaTime();
    return s_fnMoveTo != nullptr;
}

float GetDeltaTime()
{
    if (!s_fnGetDeltaTime) return s_lastDeltaTime;
    float dt = s_lastDeltaTime;
    __try {
        dt = s_fnGetDeltaTime(nullptr);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        dt = s_lastDeltaTime;
    }
    if (dt <= 0.f || dt > 0.5f) dt = s_lastDeltaTime;
    s_lastDeltaTime = dt;
    return dt;
}

float GetMoveSpeedMul(void* player)
{
    if (!s_fnCalcMoveSpeed || !player) return 1.f;
    float result = 1.f;
    __try {
        result = s_fnCalcMoveSpeed(player, nullptr);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        result = 1.f;
    }
    if (!std::isfinite(result) || result <= 0.f) result = 1.f;
    return result;
}

bool CallMoveTo(void* player, float x, float y)
{
    if (!s_fnMoveTo || !player) return false;
    bool ok = false;
    __try {
        ok = s_fnMoveTo(player, x, y, nullptr);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        ok = false;
    }
    return ok;
}

void Reset()
{
    s_moveResolved = false;
    s_cmsResolved = false;
    s_dtResolved = false;
    s_fnMoveTo = nullptr;
    s_fnCalcMoveSpeed = nullptr;
    s_fnGetDeltaTime = nullptr;
    s_lastDeltaTime = 0.016f;
}

} // namespace DodgeRuntime
