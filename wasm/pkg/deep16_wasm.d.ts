/* tslint:disable */
/* eslint-disable */
export function init(mem_words: number): void;
export function get_shadow_state(): Uint16Array;
export function reset(): void;
export function set_segments(cs: number, ds: number, ss: number, es: number): void;
export function load_program(ptr: number, data: Uint16Array): void;
/**
 * Push one key code into the polled keyboard buffer (parity with the JS
 * core's `simulator.enqueueKeyCode`). Called from the IDE for every
 * keystroke while the WASM core is selected.
 */
export function kbd_push(code: number): void;
export function kbd_clear(): void;
/**
 * Push one character into the serial queue (parity with the JS core's
 * `serialPush`). The host feeds a source in chunks while the machine polls.
 */
export function serial_push(code: number): void;
/**
 * Raise or lower the end-of-transmission flag. Queued characters stay
 * readable: SER_STATUS only reports 2 once the queue has drained.
 */
export function serial_set_eof(on: boolean): void;
export function serial_clear(): void;
/**
 * How many characters are still queued. The host needs this before it pushes:
 * the RTL core has a 128 entry FIFO and silently drops a push that arrives
 * while it is full, so feeding has to be demand-driven.
 */
export function serial_available(): number;
export function run_steps(n: number): boolean;
export function get_recent_access(): Uint32Array;
export function get_last_event(): Uint16Array;
/**
 * Overwrite the register file (R0..R15) from outside, mirroring
 * `get_registers`: while the shadow set is active (PSW.S = 1) element 15 is
 * the active (shadow) PC instead of R15, so the two calls round-trip and the
 * saved user PC stays untouched. Call `set_psw` first - element 15 is placed
 * according to the PSW.S bit that is current at call time.
 */
export function set_registers(regs: Uint16Array): void;
/**
 * Overwrite the PSW. Call before `set_registers`, which interprets its last
 * element through the S bit, exactly as `get_registers` reports it.
 */
export function set_psw(psw: number): void;
export function get_registers(): Uint16Array;
export function get_psw(): number;
export function get_segments(): Uint16Array;
export function get_memory_slice(start: number, count: number): Uint16Array;
export function get_memory_word(addr: number): number;
export function step(): boolean;

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
  readonly kbd_clear: () => void;
  readonly kbd_push: (a: number) => void;
  readonly load_program: (a: number, b: number, c: number) => void;
  readonly reset: () => void;
  readonly run_steps: (a: number) => number;
  readonly serial_available: () => number;
  readonly serial_clear: () => void;
  readonly serial_push: (a: number) => void;
  readonly serial_set_eof: (a: number) => void;
  readonly set_psw: (a: number) => void;
  readonly set_registers: (a: number, b: number) => void;
  readonly set_segments: (a: number, b: number, c: number, d: number) => void;
  readonly step: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
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
