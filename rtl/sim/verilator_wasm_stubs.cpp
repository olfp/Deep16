// Emscripten/musl does not provide the Linux affinity helpers that
// verilated_threads.cpp references. The WebAssembly model is single-threaded,
// so returning "no affinity" is the correct behaviour.
#include <cstddef>

extern "C" int sched_getcpu(void) { return 0; }
extern "C" int pthread_setaffinity_np(unsigned long, std::size_t, const void*) { return 0; }
extern "C" int pthread_getaffinity_np(unsigned long, std::size_t, void*) { return 0; }
