// Purpose: small, allocation-free JSON token helpers for the constrained bridge
// message shapes exchanged with the Electron client.

// Helpful notes:
// - These helpers are intentionally not a general JSON parser.
// - They assume compact bridge messages with known keys and simple scalar values.
// - String values are copied into caller-owned fixed buffers and truncated safely.

#include "pch-il2cpp.h"
#include "IpcJson.h"

#include <cstring>
#include <cstdio>

namespace IpcJson {

static int HexDigit(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Decodes a JSON string value: honours backslash escapes when locating the
// closing quote, and unescapes into valBuf. Truncates rather than overflowing.
char* GetString(char* json, const char* key, char* valBuf, int valBufSize)
{
    if (!json || !key || !valBuf || valBufSize <= 1) return NULL;
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\":\"", key);
    char* start = strstr(json, pattern);
    if (!start) return NULL;
    start += strlen(pattern);

    int w = 0;
    for (const char* p = start; *p; ++p) {
        if (*p == '"') break;
        char out = 0;
        if (*p == '\\') {
            ++p;
            if (!*p) break;
            switch (*p) {
                case 'n': out = '\n'; break;
                case 'r': out = '\r'; break;
                case 't': out = '\t'; break;
                case 'b': out = '\b'; break;
                case 'f': out = '\f'; break;
                case '"': out = '"';  break;
                case '\\': out = '\\'; break;
                case '/': out = '/';  break;
                case 'u': {
                    int cp = 0;
                    bool ok = true;
                    for (int i = 1; i <= 4; ++i) {
                        const int d = HexDigit(p[i]);
                        if (d < 0) { ok = false; break; }
                        cp = cp * 16 + d;
                    }
                    if (!ok) { out = 'u'; break; }
                    p += 4;
                    if (cp < 0x80) {
                        out = (char)cp;
                    } else if (cp < 0x800) {
                        if (w + 2 >= valBufSize) { valBuf[w] = '\0'; return valBuf; }
                        valBuf[w++] = (char)(0xC0 | (cp >> 6));
                        valBuf[w++] = (char)(0x80 | (cp & 0x3F));
                        continue;
                    } else {
                        if (w + 3 >= valBufSize) { valBuf[w] = '\0'; return valBuf; }
                        valBuf[w++] = (char)(0xE0 | (cp >> 12));
                        valBuf[w++] = (char)(0x80 | ((cp >> 6) & 0x3F));
                        valBuf[w++] = (char)(0x80 | (cp & 0x3F));
                        continue;
                    }
                    break;
                }
                default: out = *p; break;
            }
        } else {
            out = *p;
        }
        if (w + 1 >= valBufSize) break;
        valBuf[w++] = out;
    }
    valBuf[w] = '\0';
    return valBuf;
}

bool GetBool(char* json, const char* key)
{
    char valBuf[16] = {};
    if (GetString(json, key, valBuf, sizeof(valBuf))) return strcmp(valBuf, "true") == 0 || strcmp(valBuf, "1") == 0;
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    const char* p = strstr(json, pattern);
    if (!p) return false;
    p += strlen(pattern);
    while (*p == ' ') p++;
    return strncmp(p, "true", 4) == 0;
}

bool GetNumberToken(char* json, const char* key, char* outBuf, int outBufSize)
{
    if (!json || !key || !outBuf || outBufSize <= 1) return false;
    char pattern[128];
    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    const char* p = strstr(json, pattern);
    if (!p) return false;
    p += strlen(pattern);
    while (*p == ' ') p++;
    int i = 0;
    if (*p == '-') { if (i < outBufSize - 1) outBuf[i++] = *p; ++p; }
    bool seenDigit = false;
    while ((*p >= '0' && *p <= '9') || *p == '.') { seenDigit = true; if (i >= outBufSize - 1) return false; outBuf[i++] = *p++; }
    if (!seenDigit) return false;
    outBuf[i] = '\0';
    return true;
}

} // namespace IpcJson
