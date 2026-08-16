// Purpose: builds the JSON messages sent from the injected DLL to the client.

// Helpful notes:
// - Most outbound messages are signed by the caller before construction.
// - Player messages read from LocalPlayer at send time so heartbeat/player push
//   cadence stays independent from render-thread feature application.
// - BuildPlayerSigPayload must stay in sync with BuildPlayer fields covered by
//   the session MAC.

#include "pch-il2cpp.h"
#include "IpcMessages.h"

#include "LocalPlayer.h"

#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace IpcMessages {

static int BuildSignedStringJson(char* buf, int bufSize, const char* type, const char* key, const char* value, uint64_t seq, const char* mac)
{
    return snprintf(buf, bufSize, "{\"type\":\"%s\",\"%s\":\"%s\",\"seq\":\"%llu\",\"mac\":\"%s\"}", type, key, value, static_cast<unsigned long long>(seq), mac);
}

int BuildHello(char* buf, int bufSize, const char* challenge)
{
    return snprintf(buf, bufSize, "{\"type\":\"hello\",\"version\":3,\"protocol\":\"bridge-v3\",\"challenge\":\"%s\",\"features\":[\"autoDodge\",\"autoAim\",\"tileMap\"]}", challenge);
}

int BuildAuthResult(char* buf, int bufSize, bool ok, const char* response)
{
    return ok ? snprintf(buf, bufSize, "{\"type\":\"authResult\",\"ok\":true,\"response\":\"%s\"}", response) : snprintf(buf, bufSize, "{\"type\":\"authResult\",\"ok\":false}");
}

int BuildHeartbeat(char* buf, int bufSize, const char* nonce, uint64_t seq, const char* mac)
{
    return BuildSignedStringJson(buf, bufSize, "heartbeat", "nonce", nonce, seq, mac);
}

int BuildHeartbeatResp(char* buf, int bufSize, const char* response, uint64_t seq, const char* mac)
{
    return BuildSignedStringJson(buf, bufSize, "heartbeatResp", "response", response, seq, mac);
}

int BuildUnresolvedClasses(char* buf, int bufSize, const char* classes, uint64_t seq, const char* mac)
{
    return BuildSignedStringJson(buf, bufSize, "unresolvedClasses", "classes", classes, seq, mac);
}

int BuildPlayer(char* buf, int bufSize, uint64_t seq, const char* mac)
{
    float posX = LocalPlayer::GetX(), posY = LocalPlayer::GetY();
    int32_t hp = LocalPlayer::GetHP(), maxHp = LocalPlayer::GetMaxHP(), def = LocalPlayer::GetDefense();
    if (!LocalPlayer::GetPtr())
        return snprintf(buf, bufSize, "{\"type\":\"player\",\"alive\":false,\"seq\":\"%llu\",\"mac\":\"%s\"}", static_cast<unsigned long long>(seq), mac);
    return snprintf(buf, bufSize, "{\"type\":\"player\",\"alive\":true,\"hp\":%d,\"maxHp\":%d,\"def\":%d,\"posX\":%.3f,\"posY\":%.3f,\"seq\":\"%llu\",\"mac\":\"%s\"}", hp, maxHp, def, (double)posX, (double)posY, static_cast<unsigned long long>(seq), mac);
}

// Escapes into a JSON string body. Returns false if it would overflow.
static bool JsonEscapeInto(char* out, int outSize, const char* in)
{
    int w = 0;
    for (const char* p = in; *p; ++p) {
        const unsigned char c = (unsigned char)*p;
        const char* esc = nullptr;
        char ubuf[8];
        switch (c) {
            case '"':  esc = "\\\""; break;
            case '\\': esc = "\\\\"; break;
            case '\n': esc = "\\n";  break;
            case '\r': esc = "\\r";  break;
            case '\t': esc = "\\t";  break;
            default:
                if (c < 0x20) { snprintf(ubuf, sizeof(ubuf), "\\u%04x", c); esc = ubuf; }
                break;
        }
        if (esc) {
            const int len = (int)strlen(esc);
            if (w + len >= outSize) return false;
            memcpy(out + w, esc, len);
            w += len;
        } else {
            if (w + 1 >= outSize) return false;
            out[w++] = (char)c;
        }
    }
    out[w] = 0;
    return true;
}

// Visual-script payloads are the only ones that overflow this.
static constexpr int kEscStackBytes = 512;

int BuildHotkeyEvent(char* buf, int bufSize, const char* pluginId, const char* action, bool value, uint64_t seq, const char* mac)
{
    if (!buf || bufSize <= 0 || !pluginId || !action || !mac) return -1;

    char idStack[256];
    char escStack[kEscStackBytes];
    char* idEsc = idStack;
    char* actEsc = escStack;
    char* idHeap = nullptr;
    char* actHeap = nullptr;

    if (!JsonEscapeInto(idStack, (int)sizeof(idStack), pluginId)) {
        idHeap = (char*)malloc((size_t)bufSize);
        if (!idHeap) return -1;
        if (!JsonEscapeInto(idHeap, bufSize, pluginId)) { free(idHeap); return -1; }
        idEsc = idHeap;
    }
    if (!JsonEscapeInto(escStack, kEscStackBytes, action)) {
        actHeap = (char*)malloc((size_t)bufSize);
        if (!actHeap) { free(idHeap); return -1; }
        if (!JsonEscapeInto(actHeap, bufSize, action)) { free(idHeap); free(actHeap); return -1; }
        actEsc = actHeap;
    }

    const int n = snprintf(buf, bufSize, "{\"type\":\"hotkeyEvent\",\"pluginId\":\"%s\",\"action\":\"%s\",\"value\":%s,\"seq\":\"%llu\",\"mac\":\"%s\"}", idEsc, actEsc, value ? "true" : "false", static_cast<unsigned long long>(seq), mac);
    free(idHeap);
    free(actHeap);
    if (n < 0 || n >= bufSize) return -1;
    return n;
}

int BuildThreats(char* buf, int bufSize, const char* threats, uint64_t seq, const char* mac)
{
    return BuildSignedStringJson(buf, bufSize, "threats", "threats", threats, seq, mac);
}

void BuildPlayerSigPayload(char* outBuf, int outBufSize)
{
    if (!outBuf || outBufSize <= 0) return;
    float posX = LocalPlayer::GetX();
    float posY = LocalPlayer::GetY();
    int32_t hp    = LocalPlayer::GetHP();
    int32_t maxHp = LocalPlayer::GetMaxHP();
    int32_t def   = LocalPlayer::GetDefense();
    if (!LocalPlayer::GetPtr()) {snprintf(outBuf, outBufSize, "alive:false"); return; }
    snprintf(outBuf, outBufSize, "alive:true|hp:%d|maxHp:%d|posX:%.3f|posY:%.3f|def:%d", hp, maxHp, (double)posX, (double)posY, def);
}

} // namespace IpcMessages
