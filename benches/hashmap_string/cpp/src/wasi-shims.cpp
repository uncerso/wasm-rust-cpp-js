// Trap-based shims: keep the wasi-sdk hashmap module free of WASI imports.
//
// wasi-libc's abort()/_Exit() call __wasi_proc_exit (a WASI import). The
// raw-wasm loader instantiates with an empty import object {}, so ANY import
// fails instantiation. Defining these here makes the linker resolve them from
// this object file and never pull wasi-libc's versions → zero non-memory imports.
//
// No explicit [[noreturn]] here: <cstdlib> already declares abort/_Exit as
// non-returning, and __builtin_trap() is itself noreturn — adding the C++
// attribute on this (non-first) declaration trips -Werror.
#include <cstdio>
#include <cstdlib>
#include <cwchar>

extern "C" void abort() {
    __builtin_trap();
}

extern "C" void _Exit(int /*status*/) {
    __builtin_trap();
}

// libc++abi's default terminate / __cxa_pure_virtual handler routes through
// abort_message(), which fprintf(stderr, ...)s before aborting — that drags in
// stdio (fd_write/fd_seek/fd_close WASI imports). A strong override here keeps
// the linker from pulling the fprintf-based archive version; trap directly.
extern "C" void abort_message(const char* /*fmt*/, ...) {
    __builtin_trap();
}

// libc++'s __throw_* helpers (vector/string/unordered_map growth) route to
// std::__libcpp_verbose_abort under -fno-exceptions; its default (weak) impl
// vfprintf(stderr, ...)s, which is the real stdio puller here. A strong
// override (matching the std::__2 mangled symbol) traps directly so the
// archive version — and its stderr reference — is never linked.
namespace std {
inline namespace __2 {
[[noreturn]] void __libcpp_verbose_abort(const char* /*fmt*/, ...) {
    __builtin_trap();
}
} // namespace __2
} // namespace std

// --- string-only shims (NOT needed by hashmap_int) ----------------------------
//
// std::string keys exceed libc++'s 32-bit SSO capacity (~10 bytes; ours are 16),
// so the long-string copy ctor used by our snapshots/map inserts is out-of-line:
// it pulls libc++'s MONOLITHIC string.cpp.o translation unit. That TU also holds
// std::to_string / std::stoX (number<->string conversions), which reference
// snprintf/swprintf/strtoX/wcstoX. Those drag in the buffered-FILE machinery
// (vfprintf → __towrite → __stdio_exit → writev/lseek/close), i.e. the
// fd_write/fd_seek/fd_close WASI imports — even though our workload never calls
// to_string/stoX. The member is one section, so -Wl,--gc-sections cannot drop the
// dead conversions. Strong trap-overrides for every symbol string.cpp.o pulls
// keep the linker from extracting libc's snprintf/strtod/strtol/wcstod/wcstol
// members at all → zero imports. (hashmap_int uses uint64 keys, never touches
// std::string, so it needs none of this.)
extern "C" int snprintf(char*, size_t, const char*, ...) { __builtin_trap(); }
extern "C" int swprintf(wchar_t*, size_t, const wchar_t*, ...) { __builtin_trap(); }
extern "C" double strtod(const char*, char**) { __builtin_trap(); }
extern "C" float strtof(const char*, char**) { __builtin_trap(); }
extern "C" long double strtold(const char*, char**) { __builtin_trap(); }
extern "C" long strtol(const char*, char**, int) { __builtin_trap(); }
extern "C" long long strtoll(const char*, char**, int) { __builtin_trap(); }
extern "C" unsigned long strtoul(const char*, char**, int) { __builtin_trap(); }
extern "C" unsigned long long strtoull(const char*, char**, int) { __builtin_trap(); }
extern "C" double wcstod(const wchar_t*, wchar_t**) { __builtin_trap(); }
extern "C" float wcstof(const wchar_t*, wchar_t**) { __builtin_trap(); }
extern "C" long double wcstold(const wchar_t*, wchar_t**) { __builtin_trap(); }
extern "C" long wcstol(const wchar_t*, wchar_t**, int) { __builtin_trap(); }
extern "C" long long wcstoll(const wchar_t*, wchar_t**, int) { __builtin_trap(); }
extern "C" unsigned long wcstoul(const wchar_t*, wchar_t**, int) { __builtin_trap(); }
extern "C" unsigned long long wcstoull(const wchar_t*, wchar_t**, int) { __builtin_trap(); }
