/* tslint:disable */
/* eslint-disable */
export function init(mem_words: number): void;
export function reset(): void;
export function set_segments(cs: number, ds: number, ss: number, es: number): void;
export function load_program(ptr: number, data: Uint16Array): void;
export function get_last_event(): Uint16Array;
export function get_shadow_state(): Uint16Array;
export function get_registers(): Uint16Array;
export function get_psw(): number;
export function get_segments(): Uint16Array;
export function get_memory_slice(start: number, count: number): Uint16Array;
export function get_memory_word(addr: number): number;
export function step(): boolean;
export function run_steps(n: number): boolean;
export function get_recent_access(): Uint32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly get_last_event: () => [number, number];
  readonly get_memory_slice: (a: number, b: number) => [number, number];
  readonly get_memory_word: (a: number) => number;
  readonly get_psw: () => number;
  readonly get_recent_access: () => [number, number];
  readonly get_registers: () => [number, number];
  readonly get_segments: () => [number, number];
  readonly get_shadow_state: () => [number, number];
  readonly init: (a: number) => void;
  readonly load_program: (a: number, b: number, c: number) => void;
  readonly reset: () => void;
  readonly run_steps: (a: number) => number;
  readonly set_segments: (a: number, b: number, c: number, d: number) => void;
  readonly step: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
