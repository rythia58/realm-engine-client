// pch.h: This is a precompiled header file.
      // Files listed below are compiled only once, improving build performance for future builds.
      // This also affects IntelliSense performance, including code completion and many code browsing features.
      // However, files listed here are ALL re-compiled if any one of them is updated between builds.
      // Do not add files here that you will be updating frequently as this negates the performance advantage.

      #ifndef PCH_IL2CPP_H
      #define PCH_IL2CPP_H

      // add headers that you want to pre-compile here

      // IL2CPP generated headers MUST come before <windows.h> — the Windows SDK
      // defines hundreds of macros (TRUE, FALSE, ERROR, DELETE, FILE_READ_DATA,
      // HKEY_*, STATUS_*, etc.) that collide with generated enum class member names
      // and struct field names in il2cpp-types.h.  By parsing the IL2CPP headers
      // first, those identifiers are already in the AST before the macros exist.
      #include "il2cpp-appdata.h"

      #define WIN32_LEAN_AND_MEAN
      #define NOMINMAX
      #include <windows.h>

      #endif //PCH_IL2CPP_H