/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const get_last_event: () => [number, number];
export const get_memory_slice: (a: number, b: number) => [number, number];
export const get_memory_word: (a: number) => number;
export const get_psw: () => number;
export const get_recent_access: () => [number, number];
export const get_registers: () => [number, number];
export const get_segments: () => [number, number];
export const get_shadow_state: () => [number, number];
export const init: (a: number) => void;
export const load_program: (a: number, b: number, c: number) => void;
export const reset: () => void;
export const run_steps: (a: number) => number;
export const set_psw: (a: number) => void;
export const set_registers: (a: number, b: number) => void;
export const set_segments: (a: number, b: number, c: number, d: number) => void;
export const step: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
