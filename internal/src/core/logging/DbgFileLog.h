#pragma once
// DbgFileLog — write trace messages to a file that persists after crashes.
// Every write is immediately flushed so nothing is lost when the game dies.
//
// Log path: %LOCALAPPDATA%\RealmOfTheMadGod\Production\dll-trace.log
// (next to the game exe, easy to find)
//
// Usage:  DBG_FILE_LOG("about to call X, value=" << someVar);

#include <cstdio>
#include <cstdarg>
#include <ctime>
#include <Windows.h>
#include <sstream>

inline const char* DbgFileLogPath()
{
    static char s_path[MAX_PATH] = {};
    if (s_path[0]) return s_path;
    char local[MAX_PATH] = {};
    DWORD n = GetEnvironmentVariableA("LOCALAPPDATA", local, sizeof(local));
    if (n > 0 && n < sizeof(local)) {
        snprintf(s_path, sizeof(s_path), "%s\\RotMG Exalt DLL Trace.log", local);
    } else {
        snprintf(s_path, sizeof(s_path), "C:\\dll-trace.log");
    }
    return s_path;
}

inline void DbgFileLogWrite(const char* line)
{
    FILE* f = nullptr;
    if (fopen_s(&f, DbgFileLogPath(), "ab") != 0 || !f) return;

    SYSTEMTIME st;
    GetLocalTime(&st);
    fprintf(f, "[%02d:%02d:%02d.%03d] [tid=%lu] %s\n",
            st.wHour, st.wMinute, st.wSecond, st.wMilliseconds,
            GetCurrentThreadId(), line ? line : "");
    fflush(f);
    fclose(f);
}

#define DBG_FILE_LOG(expr) do { \
    std::ostringstream _dbg_oss; _dbg_oss << expr; \
    DbgFileLogWrite(_dbg_oss.str().c_str()); \
} while(0)
