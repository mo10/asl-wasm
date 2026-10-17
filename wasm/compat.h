/*
 * Platform definitions for building AS with Emscripten (wasm32).
 *
 * AS detects the host platform via compiler-predefined macros in
 * sysdefs.h.  Emscripten/wasm32 matches none of the existing branches,
 * which would end in "#error your platform so far is not included".
 * Instead of patching sysdefs.h, this header is injected into every
 * compilation unit via "emcc -include" and pre-defines DEFSMADE plus
 * everything sysdefs.h would otherwise define for a 32-bit Unix-like
 * host (mirrors the i386/Linux branch), with locale-based NLS disabled
 * (browsers have no meaningful locale environment).
 */

#ifndef ASL_WASM_COMPAT_H
#define ASL_WASM_COMPAT_H

#define ARCHPRNAME "wasm32"
#define ARCHSYSNAME "unknown-wasm"

#define DEFSMADE
#define OPENRDMODE "r"
#define OPENWRMODE "w"
#define OPENUPMODE "r+"
#define IEEEFLOAT_8_DOUBLE
typedef signed char as_int8_t;
typedef unsigned char as_uint8_t;
typedef signed short as_int16_t;
typedef unsigned short as_uint16_t;
#define HAS16
typedef signed int as_int32_t;
#define PRIas_int32_t "d"
typedef unsigned int as_uint32_t;
#define AS_64_IS_LONGLONG
#define NO_NLS

#endif /* ASL_WASM_COMPAT_H */
