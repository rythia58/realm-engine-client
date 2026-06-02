#include "pch-il2cpp.h"
#include "GameState.h"
#include "RuntimeOffsets.h"
#include "Il2CppResolver.h"
#include "DbgFileLog.h"

#include <Windows.h>
#include <cstdio>

// ─────────────────────────────────────────────────────────────────────────────
// GameState — see GameState.h for design notes.
// ─────────────────────────────────────────────────────────────────────────────

namespace GameState {

static Il2CppClass* s_appMgrClass      = nullptr;
static void*        s_appMgr           = nullptr;  // cached after first successful find
static void*        s_worldMgr         = nullptr;  // re-read every Tick
static void*        s_localPtr         = nullptr;  // re-read every Tick
static ULONGLONG    s_lastAppMgrTry    = 0;        // rate-limits the expensive FindObjectsByType
static bool         s_wmOffsetResolved = false;    // true once AppMgr_WorldMgr is dynamically set

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

static inline bool AddrOk(const void* p)
{
    uintptr_t a = reinterpret_cast<uintptr_t>(p);
    return a >= 0x10000u && a <= 0x7FFFFFFFFFFFull;
}

// SEH must live in a function without C++ unwinding (C2712).
static void* ReadPtr(const void* base, size_t offset) noexcept
{
    __try {
        return *reinterpret_cast<void* const*>(
            reinterpret_cast<const uint8_t*>(base) + offset);
    }
    __except (EXCEPTION_EXECUTE_HANDLER) { return nullptr; }
}

// Cheap vtable sanity: first qword of the object should be a valid code address.
static bool PtrOk(const void* p)
{
    if (!AddrOk(p)) return false;
    __try {
        void* klass = *reinterpret_cast<void* const*>(p);
        return AddrOk(klass);
    }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-shot BeeByte rename diagnostic
// Writes C:\Users\Public\re_classmap.txt on the first frame ApplicationManager
// is found. Lists parent chain of known-alive classes and all non-Unity fields
// on ApplicationManager, then dumps every loaded class name + parent name.
// Safe to remove once the new names are confirmed.
// ─────────────────────────────────────────────────────────────────────────────
static void RunClassDiag(Il2CppClass* appMgrClass)
{
    FILE* f = nullptr;
    fopen_s(&f, "C:\\Users\\Public\\re_classmap.txt", "w");
    if (!f) return;

    // ── 1. FKALGHJIADI (LocalPlayer, alive) parent chain ────────────────────
    // Walks up: LocalPlayer → Character(dead) → MapObject(dead) → Player(alive)
    fprintf(f, "=== FKALGHJIADI parent chain ===\n");
    Il2CppClass* lp = Resolver::FindClassLoose("FKALGHJIADI");
    if (lp) {
        Il2CppClass* cur = il2cpp_class_get_parent(lp);
        int depth = 0;
        while (cur && depth < 6) {
            const char* n = il2cpp_class_get_name(cur);
            fprintf(f, "  depth %d: %s\n", depth + 1, n ? n : "?");
            cur = il2cpp_class_get_parent(cur);
            ++depth;
        }
    } else {
        fprintf(f, "  FKALGHJIADI not found\n");
    }

    // ── 2. BGAIOPJMHLO (GroundTile, alive) parent chain ─────────────────────
    fprintf(f, "=== BGAIOPJMHLO parent chain ===\n");
    Il2CppClass* gt = Resolver::FindClassLoose("BGAIOPJMHLO");
    if (gt) {
        Il2CppClass* cur = il2cpp_class_get_parent(gt);
        int depth = 0;
        while (cur && depth < 4) {
            const char* n = il2cpp_class_get_name(cur);
            fprintf(f, "  depth %d: %s\n", depth + 1, n ? n : "?");
            cur = il2cpp_class_get_parent(cur);
            ++depth;
        }
    }

    // ── 3. ApplicationManager non-Unity fields → new WorldManager name ───────
    fprintf(f, "=== ApplicationManager fields ===\n");
    if (appMgrClass) {
        void* iter = nullptr;
        FieldInfo* fi;
        while ((fi = il2cpp_class_get_fields(appMgrClass, &iter)) != nullptr) {
            const Il2CppType* ft = il2cpp_field_get_type(fi);
            if (!ft) continue;
            Il2CppClass* fklass = il2cpp_class_from_type(ft);
            const char* fname   = il2cpp_field_get_name(fi);
            const char* ftname  = fklass ? il2cpp_class_get_name(fklass) : "?";
            const char* ftns    = fklass ? il2cpp_class_get_namespace(fklass) : "";
            // Skip Unity/System types; ROTMG manager classes have empty namespace
            bool isSystem = ftns && (strncmp(ftns, "UnityEngine", 11) == 0 ||
                                     strncmp(ftns, "System", 6) == 0 ||
                                     strncmp(ftns, "TMPro", 5) == 0);
            fprintf(f, "  [%s] %s : %s\n", isSystem ? "skip" : "KEEP",
                    fname ? fname : "?", ftname ? ftname : "?");
        }
    }

    // ── 4. Full class dump: every class name + parent name ───────────────────
    fprintf(f, "=== ALL CLASSES ===\n");
    struct DumpCtx { FILE* f; };
    DumpCtx ctx{ f };
    il2cpp_class_for_each([](Il2CppClass* klass, void* ud) {
        auto* c = static_cast<DumpCtx*>(ud);
        const char* name = il2cpp_class_get_name(klass);
        Il2CppClass* parent = il2cpp_class_get_parent(klass);
        const char* pname   = parent ? il2cpp_class_get_name(parent) : "-";
        fprintf(c->f, "%s\t%s\n", name ? name : "?", pname ? pname : "-");
    }, &ctx);

    // ── 5. Field enumeration for key classes ─────────────────────────────────
    // Plugin reads these to verify RuntimeOffsets field names are still present.
    static const char* kFieldClasses[] = {
        "KJMONHENJEN", "LKHPPBEGNOM", "FKALGHJIADI",
        "HJMBOMEHGDJ", "HBEAKBIHANL", "CMFPKCJHKKB"
    };
    for (const char* cn : kFieldClasses) {
        Il2CppClass* klass = Resolver::FindClassLoose(cn);
        if (!klass) continue;
        fprintf(f, "=== FIELDS:%s ===\n", cn);
        void* fi_iter = nullptr;
        FieldInfo* fi;
        while ((fi = il2cpp_class_get_fields(klass, &fi_iter)) != nullptr) {
            const char* fname = il2cpp_field_get_name(fi);
            const Il2CppType* ft = il2cpp_field_get_type(fi);
            char* tname = ft ? il2cpp_type_get_name(ft) : nullptr;
            fprintf(f, "%s\t%s\n", fname ? fname : "?", tname ? tname : "?");
            if (tname) il2cpp_free(tname);
        }
    }

    // ── 6. Method enumeration for hook classes (obfuscated names only) ────────
    // Plugin uses these to verify hook method names are still present.
    // Filter: exactly 11 uppercase letters — skips Unity/system method names.
    static const char* kMethodClasses[] = {
        "FKALGHJIADI", "HJMBOMEHGDJ", "LKHPPBEGNOM", "GJJCEFJMNMK"
    };
    for (const char* cn : kMethodClasses) {
        Il2CppClass* klass = Resolver::FindClassLoose(cn);
        if (!klass) continue;
        fprintf(f, "=== METHODS:%s ===\n", cn);
        void* mi_iter = nullptr;
        const MethodInfo* mi;
        while ((mi = il2cpp_class_get_methods(klass, &mi_iter)) != nullptr) {
            const char* mname = il2cpp_method_get_name(mi);
            if (!mname) continue;
            // Only emit names that look obfuscated: exactly 11 A-Z chars
            int len = 0; bool obf = true;
            for (; mname[len]; ++len) { if (mname[len] < 'A' || mname[len] > 'Z') { obf = false; break; } }
            if (!obf || len != 11) continue;
            int nparams = (int)il2cpp_method_get_param_count(mi);
            // Append first param type name so we can match by signature, not just count
            char ptypes[256] = {};
            for (int p = 0; p < nparams && p < 4; ++p) {
                const Il2CppType* pt = il2cpp_method_get_param(mi, (uint32_t)p);
                char* ptn = pt ? il2cpp_type_get_name(pt) : nullptr;
                if (p) strncat_s(ptypes, sizeof(ptypes), ",", _TRUNCATE);
                strncat_s(ptypes, sizeof(ptypes), ptn ? ptn : "?", _TRUNCATE);
                if (ptn) il2cpp_free(ptn);
            }
            // Subtract GameAssembly base so address is a stable RVA across ASLR runs
            const void* fnPtr = reinterpret_cast<const void*>(mi->methodPointer);
            HMODULE hGA = GetModuleHandleW(L"GameAssembly.dll");
            uintptr_t rva = hGA && fnPtr
                ? (uintptr_t)fnPtr - (uintptr_t)hGA
                : 0;
            fprintf(f, "%s\t%d\t%s\t0x%llX\n", mname, nparams, ptypes, (unsigned long long)rva);
        }
    }

    fclose(f);
    DBG_FILE_LOG("[GameState] re_classmap.txt written to C:\\Users\\Public\\");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

void Tick()
{
    // ── Step 1: resolve ApplicationManager once ──────────────────────────────
    // FindObjectsByType is expensive (full IL2CPP object walk).
    // Rate-limited to one attempt every 5 s until it succeeds.
    if (!AddrOk(s_appMgr))
    {
        const ULONGLONG now = GetTickCount64();
        if (now - s_lastAppMgrTry < 5000ULL) return;
        s_lastAppMgrTry = now;

        if (!s_appMgrClass)
        {
            s_appMgrClass = Resolver::FindClass("", "ApplicationManager");
            if (!s_appMgrClass)
                s_appMgrClass = Resolver::FindClassLoose("ApplicationManager");
        }
        if (!s_appMgrClass) return;

        auto objs = Resolver::FindObjectsByType(s_appMgrClass);
        if (objs.empty()) return;

        void* candidate = objs[0];
        if (!PtrOk(candidate)) return;
        s_appMgr = candidate;

        // One-shot diagnostic — runs once, writes re_classmap.txt, then never again.
        static bool s_diagDone = false;
        if (!s_diagDone) { s_diagDone = true; RunClassDiag(s_appMgrClass); }
    }

    // ── Step 1b: resolve AppMgr→WorldMgr offset via type-scan (once) ────────
    // il2cpp_field_get_offset on a C# property backing field returns the dump
    // offset; no ACTK shift for ApplicationManager fields.
    // We find the field by its declared type (HJMBOMEHGDJ) rather than its name
    // because the backing-field name (<CHDFAEBMILI>k__BackingField) changes with
    // every BeeByte obfuscation pass.
    if (!s_wmOffsetResolved && s_appMgrClass)
    {
        Il2CppClass* wmClass = Resolver::FindClassLoose("HJMBOMEHGDJ");
        if (wmClass)
        {
            void* iter = nullptr;
            FieldInfo* fi;
            while ((fi = il2cpp_class_get_fields(s_appMgrClass, &iter)) != nullptr)
            {
                const Il2CppType* ft = il2cpp_field_get_type(fi);
                if (!ft) continue;
                Il2CppClass* fklass = il2cpp_class_from_type(ft);
                if (fklass == wmClass)
                {
                    RuntimeOffsets::AppMgr_WorldMgr =
                        static_cast<uint32_t>(il2cpp_field_get_offset(fi));
                    break;
                }
            }
            s_wmOffsetResolved = true; // mark done whether or not found; fallback stays if not
        }
    }

    // ── Step 2: WorldMgr — 1 deref per frame ─────────────────────────────────
    void* wm = ReadPtr(s_appMgr, RuntimeOffsets::AppMgr_WorldMgr);
    if (!AddrOk(wm)) { s_worldMgr = nullptr; s_localPtr = nullptr; return; }
    s_worldMgr = wm;

    // ── Step 3: LocalPtr — 1 deref per frame ─────────────────────────────────
    void* lp = ReadPtr(wm, RuntimeOffsets::WM_Local);
    s_localPtr = PtrOk(lp) ? lp : nullptr;
}

void NotifyLocalPtr(void* ptr)
{
    if (PtrOk(ptr)) s_localPtr = ptr;
}

void* GetAppMgr()   { return s_appMgr;   }
void* GetWorldMgr() { return s_worldMgr; }
void* GetLocalPtr() { return s_localPtr; }

} // namespace GameState
