
      // IL2CPP application initializer — update-proof via GetProcAddress

      #include "pch-il2cpp.h"

      #include "il2cpp-appdata.h"
      #include "il2cpp-init.h"
      #include "helpers.h"
      #include "xorstr.h"
      #include "DbgFileLog.h"

      // IL2CPP API function pointer definitions (storage)
      #define DO_API(r, n, p) r (*n) p
      #include "il2cpp-api-functions.h"
      #undef DO_API

      // Application-specific function pointer storage (kept for link compatibility)
      #define DO_APP_FUNC(a, r, n, p) r (*n) p
      #define DO_APP_FUNC_METHODINFO(a, n) struct MethodInfo ** n
      namespace app {
      #include "il2cpp-functions.h"
      }
      #undef DO_APP_FUNC
      #undef DO_APP_FUNC_METHODINFO

      // TypeInfo pointer storage (kept for link compatibility)
      #define DO_TYPEDEF(a, n) n ## __Class** n ## __TypeInfo
      namespace app {
      #include "il2cpp-types-ptr.h"
      }
      #undef DO_TYPEDEF

      void init_il2cpp(HMODULE hGameAssembly)
      {
      DBG_FILE_LOG("[init_il2cpp] entered (pre-resolved handle=" << (void*)hGameAssembly << ")");
      HMODULE hMod = hGameAssembly;
      if (!hMod) {
      hMod = GetModuleHandleW(L"GameAssembly.dll");
      DBG_FILE_LOG("[init_il2cpp] Fallback GetModuleHandleW -> " << (void*)hMod);
      }
      if (!hMod) {
      DBG_FILE_LOG("[init_il2cpp] GameAssembly.dll NOT LOADED — aborting.");
      return;
      }

      DBG_FILE_LOG("[init_il2cpp] Resolving IL2CPP API via GetProcAddress...");
      #define DO_API(r, n, p) n = reinterpret_cast<r(*) p>(GetProcAddress(hMod, #n))
      #include "il2cpp-api-functions.h"
      #undef DO_API
      DBG_FILE_LOG("[init_il2cpp] All API pointers resolved, returning.");
      }
