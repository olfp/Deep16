# Plan — PSRAM backing store, full 2^20 words

Target: Tang Nano 9K (Gowin GW1NR-9). Full 1,048,576-word address space in
onboard PSRAM, cache and write buffer in BSRAM.

## 0. Goal and non-goals

**Goal.** Move the Deep16 memory backing store from a Verilog array to the
board's PSRAM, keeping the 2^20-word ISA map and the `step()` contract
(one retired instruction per call) unchanged.

**Non-goals.**
- No ISA change. The map stays 2^20 words.
- No change to `tests/fuzz.test.js`, `tests/rtl.test.js` expectations beyond
  the one cycle-count bound identified in §7.
- MMIO stays on-chip. Only `0x00000–0xEFFFF` moves to PSRAM.

**Capacity check.** 2^20 words × 16 bit = 16 Mbit needed. PSRAM is 64 Mbit
(2^22 words, a 2 MiB byte window). `0x00000–0xEFFFF` is 983,040 words =
1.875 MiB — **26% of the chip.** Capacity is a non-issue; latency and bus
turnaround are the entire problem.

---

## 1. What the current RTL actually requires

This is the part that decides the design. From `rtl/deep16_top.sv:207-222`,
one `always_comb` issues:

| Access | Port | Notes |
|---|---|---|
| `mem[mem_addr]` | read | data |
| `mem[if_addr]` | read | instruction fetch |
| `mem[2]` | read | SWI vector, **unconditional, every cycle** |
| `mem[{fill_base, fw}]`, fw=0..7 | read ×8 | cache line refill, one cycle |
| `mem[mem_waddr]` | write | store, write-through |

**Eleven combinational reads and one write, per cycle.** A Verilog array
provides this for free. No BSRAM (max true dual port = 2) and no PSRAM (1
bidirectional port) can. The array is therefore a simulation-only construct
and *must* be replaced whichever backing store is chosen.

Two concrete consequences:

1. **`vec_rdata = mem[2]` (`deep16_top.sv:217`) is a wasted port.** It returns
   a constant that changes only when something stores to address 2 or the host
   pokes it. It should be a register fed by the write path.
2. **The 8-word refill is the port bottleneck.** It is why banking/interleaving
   exists at all.

## 2. Memory interface contract

The one design decision everything else hangs off. Proposed contract:

```
  // read port (single)
  output logic        mem_req        // one cycle pulse per request
  output logic [19:0] mem_raddr
  input  logic [15:0] mem_rdata
  input  logic        mem_rvalid     // exactly ONE cycle after mem_req

  // write port (independent, semi-dual)
  output logic        mem_wen
  output logic [19:0] mem_waddr
  output logic [15:0] mem_wdata
  input  logic        mem_wready
```

`mem_rvalid` is **exactly one cycle** after `mem_req` — fixed latency, not a
backpressure handshake. Underneath sits the PSRAM controller which may take 8
cycles internally; the *stall* absorbs that.

Rationale for fixed latency over a ready/valid handshake: a fixed latency
turns an unbounded, data-dependent stall into a deterministic bubble. The
pipeline control we verified this session stays frozen; a fixed bubble keeps it
comparable. A handshake also needs a correct "hold everything, including
side-effects" path, which is precisely the bug class that produced the `kbd_pop`
and shadow-bank-bypass defects.

**Invariant to enforce in RTL:** `mem_rvalid` is never suppressed. Once
`mem_req` pulses, data arrives. This is what makes §7's latency-invariance test
possible.

## 3. Pipeline stall path

New signal `mem_stall`, active whenever a memory transaction is outstanding.

**Freeze IF, ID, EX. Let MEM, WB drain.**

Rationale: draining means the instructions *behind* a missing one continue to
issue and may themselves hit in cache. Freezing everything would serialise the
whole miss penalty with no overlap.

Interactions that must be re-checked — each one is a place a bug has already
been found this session:

| Signal | Current gate | Required |
|---|---|---|
| `kbd_pop`, `ser_pop` | `&& !stall` | `&& !mem_stall` |
| `ex_kill` / `kill_id` / `flush_id` | no stall term | must not fire while `mem_stall` |
| `step_done` | — | must not latch while a transaction is in flight |
| `delay_in_ex` | — | held delay slot must not re-fire a side effect across the stall |
| `ctx.fsh` | one-shot in WB | must not fire during `mem_stall` |
| `pipe_busy` / `halt_done` (`:1017`) | — | halt must wait for the outstanding transaction to retire |

`stall` today is *only* load-use (`:377`, `rd_en3 && ra3 == ex_mem.load_rd`).
`mem_stall` is a second, independent hazard and they must be OR-able without
either masking the other.

### 3.1 The SWI redirect — the hard case

`deep16_core.sv:926`:

```
if_pc_next = if_redirect ? (mem_late ? mem_rdata : redirect_pc_ex) : if_addr + 1;
```

The SWI target arrives **through the data read port**. Today it resolves in the
same cycle. Under PSRAM it arrives N cycles later, so:

- Latch `pending_swi` (and its segment) in EX when SWI is decoded.
- Freeze IF/ID/EX immediately — the SWI must not re-execute, and the two
  instructions behind it must be killed **when the redirect lands**, not before.
- Drive `redirect_pc` from the returning data; release the freeze on arrival.

This is a redirect that is *in flight* across a stall, in the same machinery as
the shadow-bank bypass. It is the highest-risk item in the plan and gets its
own test (§7.3).

### 3.2 Halt

A halt word fetched while a transaction is outstanding must not retire until the
transaction drains, or the harness will read a memory word that PSRAM has not
returned. `halt_done` (`:1018`) already gates on `pipe_busy`; it must also gate
on "no outstanding transaction".

## 4. Cache changes

**The transparent property cannot survive.** "A miss falls through to memory, so
no stall is needed" (`deep16_top.sv:179-182`, `:205-206`) was only ever legal
because the array read combinationally. With PSRAM a miss *is* a stall.

This is not a loss to apologise for — the transparent design only avoided a
stall because BRAM could. It was never a claim that stalls are undesirable.

Changes required:

1. **Refill becomes a PSRAM burst.** One 8-word burst instead of 8 parallel
   array reads. `fill_base` (17 bits, `deep16_cache.sv:37`) becomes a PSRAM
   burst address.
2. **Line size becomes a real parameter.** An 8-word line = 16 bytes. Against an
   SDRAM row of 1–2 KiB, that is a very short burst — the row activate
   dominates unless the row stays open. Options: keep 8 words and rely on the
   row-open policy (§5), or reduce to 4 to halve the worst-case miss. **To be
   decided by measurement, not opinion** (§11, decision 1).
3. **Re-size and re-shape the cache.** *This is the most important consequence
   of the move.* Today 4 KiB of cache sits in front of a zero-latency array —
   deliberately small, because there was no latency to hide. In front of PSRAM
   the cache is the *only* thing hiding ~8 cycles, and BSRAM is sitting right
   there: 468 Kbit of it, of which the cache currently uses ~32 Kbit.

   **Measured — see §10. Decisions: keep line = 8 words, go 4-way associative,
   4096 words (512 lines, 128 sets × 4 ways, 8 KiB = 64 Kbit data).**

   The headline: the current *direct-mapped* 4 KiB cache costs 0.615 PSRAM
   cycles/instruction on the Forth REPL. The proposed 4-way 8 KiB cache costs
   0.080 — **7.7× better**. Associativity, not capacity, is what was missing;
   4-way at 4096 words reaches exactly the same point as direct-mapped at
   8192 words, at half the capacity. Beyond 4096 words nothing improves at all.

   So the PSRAM transition, done with this shape, does not cost performance —
   it removes a defect the cache already had.


## 5. PSRAM controller

- **Row-open policy.** Keep the active row open per bank; precharge only on a
  bank switch. Without this, a 16-byte line fill pays a full
  ACTIVATE+PRECHARGE per miss.
- **Bank interleaving.** 4 banks typical for a 64 Mbit part. Interleave the
  address space across banks at the row-size stride, so that a code stream and
  its data touch different banks. Stride to be taken from the part's
  organisation, not guessed.
- **Burst refill.** Column-increment burst of 4 or 8 for the line fill.
- **Write buffer.** See §6.

## 6. Write path

Write-through is kept. **This is a deliberate constraint, not a preference:**
`get_memory_slice` in the harness reads the array directly, and the whole test
suite assumes the backing store is authoritative. A write-back cache makes the
array stale and breaks that invariant across every test.

But write-through to PSRAM has a specific problem, and it is the direct
consequence of the port argument: **PSRAM has one bidirectional port, so every
store contends with every fetch.** Stores are frequent enough in straight-line
code that bus turnaround would dominate.

Fix: a **write-combining buffer in BSRAM** — stores merge into a line buffer
and drain to PSRAM as a burst in the background, so the pipeline never stalls on
a store (unless the buffer is full).

This is exactly where BSRAM's semi-dual-port capability earns its keep: the
buffer is written by the CPU port and drained by the controller port
simultaneously. On PSRAM this buffer could not be built.

Write-back remains a legitimate later optimisation — worth measuring once the
transition is done — but it is explicitly out of scope here.

## 7. Verification

The central property, and the one that makes this whole plan verifiable
**without an FPGA**:

> **Behaviour must be latency-invariant.** The same program must produce
> identical observable state at `mem` latency 1, 2, 4, 8 and 16 cycles.

A behavioural PSRAM model with a `LATENCY` parameter, used in Verilator. Any
stall-logic bug — a side-effect re-firing, a lost kill, a mis-ordered
redirect — shows up as a *latency-dependent* divergence. This converts the
hardest class of bug in this design into a trivially detectable one.

### 7.1 Test plan

| # | Test | Gate |
|---|---|---|
| 1 | Latency invariance: sweep, fuzz, examples at LAT ∈ {1,2,4,8,16} | identical state at every latency |
| 2 | Existing decode sweep re-run against the PSRAM model | stays **0 / 524,288** |
| 3 | `tests/fuzz.test.js` against the PSRAM model, all 60 seeds | stays green, coverage assertion still 49/60 |
| 4 | SWI-in-flight: SWI decoded, pipeline stalled, redirect lands | target correct, two following instructions killed exactly once |
| 5 | Halt with transaction outstanding | no partial commit |
| 6 | Store burst behaviour | buffer full → correct back-pressure |
| 7 | Debug read (`get_memory_slice`) while a line is cached | stale line invalidated first |

Test 7 uses machinery that already exists: `cache_flush` / `inv_we` are driven
from the debugger path today, so a debug read must flush before reading.

### 7.2 Assertions that must change

`tests/rtl.test.js:466`:

```js
assert.ok(cycles < 4 * rtl.steps, 'the pipeline lost its advantage')
```

This is an *efficiency* bound about the current zero-wait-state design. Under
PSRAM it is false by construction and must be restated as a measured CPI
expectation. It is the only cycle assertion in the suite — every correctness
assertion is behavioural and survives untouched.

### 7.3 Coverage

The fuzz test already asserts its own coverage (49/60 seeds must enter the
shadow bank). Add: **at least one seed must exercise SWI across a stall**, i.e.
a non-trivial `mem_stall` during an in-flight redirect. That is the specific
interaction §3.1 exists to handle, and it must not be left to chance.

---

## 8. Phasing

Each phase ends green and committable. Phases A and B are the hard ones and
need no hardware.

| Phase | Work | Hardware? |
|---|---|---|
| **A** | Memory interface honesty: fixed latency, `vec` as register, behavioural model with `LATENCY` param. Benefits the BRAM target too. | no |
| **B** | Stall path: `mem_stall`, all interactions in §3, SWI-in-flight (§3.1), halt. | no |
| **C** | Cache: 4 KiB → 16 KiB, PSRAM burst refill, line-size measurement. | no |
| **D** | PSRAM controller: row-open, bank interleave, write buffer. | no |
| **E** | Gowin synthesis, timing closure at 27 MHz, board bring-up. | **yes** |

A and B are deliberately separate. A changes the interface without changing
behaviour; B changes behaviour-adjacent control while behaviour must stay
identical. Mixing them makes a regression unlocatable.

## 9. Risks

| Risk | Mitigation |
|---|---|
| SWI-in-flight redirect bug (§3.1) | Test 4; latency-invariance catches the general class |
| Side-effect re-fire across stall (`kbd_pop`/`ser_pop`) | Already gated on `!stall`; add `!mem_stall`; test 1 |
| Regression in the verified pipeline control | Latency-invariance + full sweep + fuzz at every phase boundary |
| Line size wrong for PSRAM | Measured in C, not assumed |
| 16 KiB cache insufficient | BSRAM has room; 4-way associativity is the next lever |
| Debug reads return stale data | Test 7; `inv_we` machinery exists |

## 10. Cache geometry — measured, decided

**Method.** Every memory access was traced out of the JS core by wrapping
`sim.memory` in a `Proxy` (installed *after* `loadProgram`, so the bulk copy is
not traced). No source file was modified. The traces were then replayed through
a cache simulator (LRU, write-through, no write-allocate, MMIO ≥ `0xF0000`
excluded) over a PSRAM cost model at 27 MHz / tCK = 37 ns:

```
T_CTRL 1   T_ACT 3   T_CL 2   T_CCD 2   T_PRE 3     (tCK)
read  miss, row open : T_CTRL + T_CL   + L·T_CCD
read  miss, row cold: T_CTRL + T_ACT + T_CL + L·T_CCD + T_PRE
write       , row open: T_CTRL + T_CL + T_CCD
```

**Workload.** All seven `asm/` programs. The Forth REPL is driven through the
keyboard exactly as `repl()` in `tests/forth.test.js` does, 80,000 steps.

### Forth REPL — the discriminating workload (80,000 steps, 64,316 cacheable accesses)

| words | line | assoc | miss % | cyc/instr (opt) | cyc/instr (pess) |
|------:|-----:|------:|-------:|----------------:|-----------------:|
| 2048 | 8 | 1 | 3.80 | 0.615 | 0.840 | ← **current design** |
| 4096 | 8 | 1 | 3.40 | 0.554 | 0.760 | doubling capacity, still direct-mapped: barely helps |
| 4096 | 4 | 1 | 3.84 | 0.374 | 0.601 | |
| 4096 | 8 | 2 | 0.72 | 0.145 | 0.221 | associativity is the lever |
| **4096** | **8** | **4** | **0.30** | **0.080** | **0.135** | ← **chosen** |
| 8192 | 8 | 1 | 0.31 | 0.082 | 0.138 | same point, twice the capacity |
| 8192 | 8 | 4 | 0.30 | 0.080 | 0.135 | no gain over 4096 |
| 16384 | 8 | 4 | 0.30 | 0.080 | 0.135 | no gain at all |

### Other six programs (20,758 steps)

Every geometry gives 0.09% miss and 0.025 cyc/instr. These programs are too
small to discriminate — the working set fits in almost anything.

### Decisions

1. **Line size: 8 words — unchanged.** At 4-way it is tied with line 4 on
   cycles (0.065 vs 0.064) while having 40% fewer misses, and it needs **no
   change to the existing 128-bit `fill_data` / `fill_base` path**. Zero risk
   retained where there is no measured benefit in changing it.
2. **Associativity: 4-way.** The dominant term. 7.7× cycle reduction over
   direct-mapped at the same capacity. Replacement: 4-way LRU via 2-bit
   counters, or PLRU — both cheap.
3. **Capacity: 4096 words** (512 lines × 8 words = 8 KiB = 64 Kbit data).
   Measured knee. **Leave the sizing a parameter** — 8192 is a one-line change
   if a larger workload later demands it.

### Consequences for the RTL

- Data array: 4 BSRAM (one per way) at 1024 × 16. Read path gains a 4:1 way
  mux — roughly 200 LUTs of the 8,640 available.
- Tags: 128 sets × 4 ways × 11 bits (10 tag + 1 valid) = 5,632 bits. Gowin's
  17,280 bits of **SSRAM** fit this natively, leaving a BSRAM free.
- Total ≈ 70 Kbit of 468 Kbit. The remainder is available for the write buffer
  and a framebuffer.
- `deep16_cache.sv` needs a way index on fill and on read, plus the replacement
  state. This is the one genuinely structural change in the cache.

### Caveat on the evidence

Forth is 79% of all traced accesses, and the other six programs cannot
discriminate between geometries. So the knee at 4096 words rests on **one
workload**, and it is a REPL whose hot set is small even though the program is
large. A workload with a larger hot set would move the knee right. The
parameterisation is what makes this safe — the conclusion "4-way beats
direct-mapped" is far more robust than the specific number 4096.

### Bonus finding: the write buffer matters as much as the cache

In every competitive configuration, **43–45% of PSRAM cycles are stores**, not
fills. Write-through sends every store individually, and PSRAM's single
bidirectional port makes that expensive. The write-combining buffer in §6 is
therefore not a refinement — it is roughly half the PSRAM traffic budget, and
should be treated as required rather than optional.

## 11. Open decisions — status

1. ~~**Line size**~~ — **decided**: 8 words (§10). No measured benefit in
   changing it, and it keeps the existing fill path untouched.
2. ~~**Cache geometry**~~ — **decided**: 4-way, 4096 words (§10).
3. ~~**Bank interleave stride**~~ — **decided**, §12.
4. **Write-back later?** — *still open*, but §10 now argues the write buffer is
   required rather than optional. Write-back remains out of scope for the
   reason in §6: the harness reads the array directly and the whole suite
   assumes the backing store is authoritative. Revisit once the transition is
   measured.

## 12. PSRAM organisation and interleave stride — measured from the datasheet

**Part.** The Tang Nano 9K carries `GW1NR-LV9QN88PC6/I5` — the **QN88P** package,
i.e. the PSRAM variant (DS117 Table 2-2: *QN88P / GW1NR-9 / PSRAM / 64M / 16
bits*). Organisation, quoted from DS117 §3.2:

> *"SDRAM consists of four banks, each BANK with size of 1M x16 bits, and each
> BANK consists of 4096 rows x 256 columns x 16 bits of memory arrays."*
> *"Four internal Banks (1024K x 16 bits x 4BANK)"*

| | |
|---|---|
| Word address bits | 22 = 2 bank + 12 row + 8 column |
| Bank select | `BA[1:0]`, 4 banks |
| Row | `RA[11:0]`, 4096 rows/bank |
| Column | `CA[7:0]`, 256 columns/bank |
| Data width | 16 bit — matches the Deep16 word exactly, no sub-word splitting |
| CAS latency | 2 or 3 |
| Burst | 1 / 2 / 4 / 8 or full page, sequential or interval |
| Rating | 166 MHz, CL3 — we run 27 MHz, so every timing constraint is trivial |

### The failure mode this avoids

**A linear mapping (SDRAM address = our address) puts the entire program in
bank 0.** Our space is 2²⁰ words; the SDRAM's bank select is bits [21:20]. Any
address below 2²⁰ has `BA = 00`. Three of the four banks would sit permanently
idle, and every sequential run would walk rows inside one bank — which is
exactly the case bank interleaving exists to prevent.

Nothing would break. It would simply be about 4× slower than it should be, and
the cause would not be visible from the RTL.

### Chosen mapping

```
  Deep16 address  a[19:0]
  bank  BA  = a[19:18]      // 4-way interleave, stride 2^18 words
  row   RA  = a[17: 6]      // 4096 rows
  col   CA  = {2'b00, a[5:0]}   // 64 columns used of 256
```

- **Bank interleave stride: 2¹⁸ words.** Bank index comes from the *top* two
  bits of our address.
- **One open row covers 64 of our words = 8 cache lines.**
- **A cache-line fill never crosses a row or bank boundary.** A line is 8
  consecutive words, so `a[5:3]` selects the line and `a[2:0]` the word; the
  worst case is line 7 of a row, spanning columns 28–56, well inside the 64 in
  use. A fill is therefore always a single-bank, single-row burst.
- Columns 64–255 of every row are unused. That is deliberate: we need 26% of
  the chip, and bank parallelism is worth more than column density. The
  alternative (bank = 1 bit, 256 columns per row) halves the bank count to buy
  rows we do not need.

### Consequences

- **Row size is small — 512 bytes.** An 8-word fill is 128 bits. Long bursts are
  not available; whether BL=8 means 8 words or 8 *bytes* (4 words) is worth
  confirming against the controller IP. Either way the mapping above keeps
  fills row-local, so the cost is one extra column command at worst.
- **Refresh is unavoidable.** 4 banks × 4096 rows = 16,384 rows to refresh
  within 64 ms. At 27 MHz that is one row every ~105 cycles, blocking that bank
  for `tRP + tRFC` ≈ 11 cycles. Against four banks the loss should land in the
  low single-digit percent, but it is real and should be measured, not assumed.
- **Gowin ships a controller.** DS117 references *IPUG279, Gowin SDRAM
  Controller User Guide*, covering power-up init, activation and auto-refresh.
  Using that IP would remove most of §5's hand-written work — worth checking
  early, because a hand-written controller is the single largest piece of
  Phase D.

## 13. Explicitly out of scope

- Associativity beyond direct-mapped (deferred to a later measurement).
- Write-back cache.
- BRAM-backed fast region (ruled out earlier: boot ROM at `0xFFFF0` and MMIO at
  `0xF0000` sit at the *top* of the map, so a low fast region would put the
  boot ROM in slow memory).
- Any ISA change.
