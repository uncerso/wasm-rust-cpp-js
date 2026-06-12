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
#include <cstdlib>

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
