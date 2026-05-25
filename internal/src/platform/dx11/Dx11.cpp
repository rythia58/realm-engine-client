#include "pch-il2cpp.h"

#include "Dx11.h"
#include "DbgFileLog.h"

dx11api::dx11api()
    : presentFunction(nullptr)
{
    DBG_FILE_LOG("[dx11api] ctor entered");
    WNDCLASSEX windowClass = {
        sizeof(WNDCLASSEX),
        CS_HREDRAW | CS_VREDRAW,
        DefWindowProc,
        0,
        0,
        GetModuleHandle(NULL),
        NULL,
        NULL,
        NULL,
        NULL,
        L"DirectX 11",
        NULL,
    };

    RegisterClassEx(&windowClass);
    DBG_FILE_LOG("[dx11api] RegisterClassEx done");
    HWND window = CreateWindow(windowClass.lpszClassName, L"DirectX 11 Window", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL, windowClass.hInstance, NULL);
    DBG_FILE_LOG("[dx11api] CreateWindow returned hwnd=" << (void*)window);

    D3D_FEATURE_LEVEL featureLevel;
    const D3D_FEATURE_LEVEL featureLevels[] = { D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_11_0 };

    DXGI_MODE_DESC bufferDesc = {
        100,
        100,
        {60, 1},
        DXGI_FORMAT_R8G8B8A8_UNORM,
        DXGI_MODE_SCANLINE_ORDER_UNSPECIFIED,
        DXGI_MODE_SCALING_UNSPECIFIED,
    };

    DXGI_SWAP_CHAIN_DESC swapChainDesc = {
        bufferDesc,
        {1, 0},
        DXGI_USAGE_RENDER_TARGET_OUTPUT,
        1,
        window,
        1,
        DXGI_SWAP_EFFECT_DISCARD,
        DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH,
    };

    IDXGISwapChain* pSwapChain = nullptr;
    ID3D11Device* pDevice = nullptr;
    ID3D11DeviceContext* pContext = nullptr;

    DBG_FILE_LOG("[dx11api] Calling D3D11CreateDeviceAndSwapChain...");
    HRESULT result = D3D11CreateDeviceAndSwapChain(NULL, D3D_DRIVER_TYPE_HARDWARE, NULL, 0, featureLevels, 2, D3D11_SDK_VERSION, &swapChainDesc, &pSwapChain, &pDevice, &featureLevel, &pContext);
    DBG_FILE_LOG("[dx11api] D3D11CreateDeviceAndSwapChain returned hr=0x" << std::hex << result << std::dec << " pSwapChain=" << (void*)pSwapChain);

    if (FAILED(result)) {
        DBG_FILE_LOG("[dx11api] FAILED result — cleaning up and returning (presentFunction stays null)");
        DestroyWindow(window);
        UnregisterClass(windowClass.lpszClassName, windowClass.hInstance);
        return;
    }

    DBG_FILE_LOG("[dx11api] Reading swap chain vtable...");
    void** pVMT = *(void***)pSwapChain;
    presentFunction = (D3D_PRESENT_FUNCTION)pVMT[8];
    DBG_FILE_LOG("[dx11api] vtable[8] (Present) = " << (void*)presentFunction);

    if (pSwapChain) {
        pSwapChain->Release();
        pSwapChain = NULL;
    }

    if (pDevice) {
        pDevice->Release();
        pDevice = NULL;
    }

    if (pContext) {
        pContext->Release();
        pContext = NULL;
    }

    DestroyWindow(window);
    UnregisterClass(windowClass.lpszClassName, windowClass.hInstance);
}
