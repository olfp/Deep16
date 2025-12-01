Deep16 Interrupt Context Switching Specification

Core Principle

PSW'.S bit determines active register context:

· PSW'.S = 0: Normal registers (CS, DS, SS, ES, PC, PSW)
· PSW'.S = 1: Shadow registers (CS', DS', SS', ES', PC', PSW')

Reset Initialization

```
PSW'  ← 0x0000    ; S=0, use normal context
PSW   ← 0x0000    ; S=0, interrupts disabled
CS    ← 0xFFFF    ; Boot from top of memory
DS/SS/ES ← 0x0000 ; Other segments zero
PC    ← 0x0000    ; Start execution at CS:0000
```

Interrupt Entry Sequence

```
On any interrupt (NMI, HW, SWI):
  PSW'  ← 0x0020    ; S=1, I=0 - switch to shadow context
  CS'   ← 0         ; Interrupts run in segment 0
  DS'   ← 0
  SS'   ← 0  
  ES'   ← 0
  PC'   ← Mem[interrupt_vector]  ; Jump to handler
  ; Hardware automatically uses shadow registers (PSW'.S=1)
```

Interrupt Handler Execution

· All instructions automatically use shadow registers
· SMV R0, APSW accesses normal PSW (interrupted state)
· SMV R0, APC accesses normal PC (interrupted address)
· Segments fixed at 0 unless modified by handler

Interrupt Exit Sequence

```
On RETI instruction:
  PSW'  ← 0x0000    ; S=0 - switch back to normal context
  ; Hardware automatically uses normal registers (PSW'.S=0)
  ; Execution resumes with original segments and PSW intact
```

Hardware Implementation

```verilog
// Single bit controls all context switching
assign active_cs   = psw_shadow_s ? cs_shadow   : cs_normal;
assign active_ds   = psw_shadow_s ? ds_shadow   : ds_normal;
assign active_ss   = psw_shadow_s ? ss_shadow   : ss_normal;  
assign active_es   = psw_shadow_s ? es_shadow   : es_normal;
assign active_pc   = psw_shadow_s ? pc_shadow   : pc_normal;
assign active_psw  = psw_shadow_s ? psw_shadow  : psw_normal;
```

Key Benefits

1. Automatic Context Switching - hardware handles everything
2. Fast Interrupt Entry - only PSW' update needed
3. Zero Software Overhead - no manual register saving
4. Clean Separation - interrupt/normal contexts fully isolated
5. Simple Implementation - single control bit for all muxing

This design provides zero-overhead interrupt context switching with minimal hardware complexity.
