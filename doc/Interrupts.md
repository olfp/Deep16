# Deep16 Interrupt Context Switching Specification

## Core Principle

**PSW'.S bit** determines active register context:
- **PSW'.S = 0**: Normal registers (CS, DS, SS, ES, PC, PSW, R0-R15)
- **PSW'.S = 1**: Shadow registers (CS', DS', SS', ES', PC', PSW', R0', R1', R2', R13', R14')

## Reset Initialization

```
PSW'  ← 0x0000    ; S=0, use normal context
PSW   ← 0x0000    ; S=0, interrupts disabled
CS    ← 0xFFFF    ; Boot from top of memory
DS/SS/ES ← 0x0000 ; Other segments zero
PC    ← 0x0000    ; Start execution at CS:0000
```

## Extended Shadow Register Set

### Shadow Registers (11 total)
1. **Segment Registers**: CS', DS', SS', ES'
2. **Control Registers**: PC', PSW'
3. **General-Purpose Registers**: R0', R1', R2', R13' (SP'), R14' (LR')

### Rationale for Selective Shadows
- **R0'**: LDI always uses R0, interrupts often need to load values
- **R1'/R2'**: Common argument/return value registers
- **R13' (SP')**: Critical for stack integrity
- **R14' (LR')**: Return address preservation
- **Minimal hardware**: 80 bits vs 256 bits for full set

## Interrupt Entry Sequence

### Hardware-Automated Process
**On any interrupt (NMI, HW, SWI):**
```
PSW'  ← 0x0020    ; S=1, I=0 - switch to shadow context
CS'   ← 0         ; Interrupts run in segment 0
DS'   ← 0
SS'   ← 0  
ES'   ← 0
R0'   ← 0         ; Initialize shadow registers
R1'   ← 0
R2'   ← 0
R13'  ← 0
R14'  ← 0
PC'   ← Mem[interrupt_vector]  ; Jump to handler
; Hardware automatically uses shadow registers (PSW'.S=1)
```

### Key Characteristics
1. **PSW' is NOT copied from PSW** - set to `0x0020` (S=1, I=0)
2. **All shadow segments set to 0** - interrupts run in segment 0
3. **Shadow GP registers initialized to 0** - clean context
4. **PC' gets handler address** from interrupt vector table
5. **Context switch via PSW'.S=1** - hardware handles all muxing

## Interrupt Vector Table

**Located at Segment 0 (Low Memory):**
```
0x0000: NMI_VECTOR      (Non-Maskable Interrupt)
0x0001: HW_INT_VECTOR   (Hardware Interrupts)  
0x0002: SWI_VECTOR      (Software Interrupts)
```

## Interrupt Handler Execution

### Execution Environment
- All instructions automatically use **shadow registers** (PSW'.S=1)
- Segments fixed at 0 unless modified by handler
- Interrupts disabled (PSW'.I=0) during handler execution
- Clean register context: all shadow registers initialized to 0

### Accessing Interrupted State
- `SMV R0, APSW` accesses **normal PSW** (interrupted state)
- `SMV R0, APC` accesses **normal PC** (interrupted address)
- `SMV R0, AR0` accesses **normal R0** (from interrupted context)
- Similar for other registers via SMV instruction

### SMV Instruction (Updated Encoding)
**Format:** `11111110 Rx4 alt_sel4`
**Operation:** `Rx ← alt_reg` (read shadow register to Rx)

**alt_sel Encodings:**
```
0000: ACS  (Alternate CS)       1000: AR0  (Alternate R0)
0001: ADS  (Alternate DS)       1001: AR1  (Alternate R1)
0010: ASS  (Alternate SS)       1010: AR2  (Alternate R2)
0011: AES  (Alternate ES)       1101: AR13 (Alternate R13/SP)
0100: APSW (Alternate PSW)      1110: AR14 (Alternate R14/LR)
                               1111: APC  (Alternate PC)
```

### Example Interrupt Handler
```assembly
interrupt_handler:
    ; Running in shadow context (PSW'.S=1)
    ; All shadow registers initialized to 0
    
    ; Use shadow registers directly
    LDI  0x1234      ; Uses R0' (shadow R0)
    MOV  R1, R0      ; R1' = R0' (using shadow registers)
    
    ; Access interrupted context if needed
    SMV  R2, APC     ; R2' = PC (normal interrupted PC)
    SMV  R3, APSW    ; R3' = PSW (normal interrupted PSW)
    
    ; ... handler code ...
    
    RETI             ; Return to normal context
```

## Interrupt Exit Sequence

### Hardware-Automated Process
**On RETI instruction:**
```
PSW'  ← 0x0000    ; S=0 - switch back to normal context
; Hardware automatically uses normal registers (PSW'.S=0)
; Execution resumes with original segments and PSW intact
```

### Important Notes
1. **No register restoration occurs** - normal registers were never modified
2. **Shadow registers retain their values** for next interrupt/debugging
3. **Only PSW' is modified** - set to 0x0000 to trigger context switch
4. **Pipeline flush** - clean transition between contexts

## SMV Symmetric Access Behavior

### Normal Mode (PSW.S=0, PSW'.S=0)
```assembly
SMV Rx, ACS      ; Rx = CS' (reads shadow CS, typically 0)
SMV Rx, AR0      ; Rx = R0' (reads shadow R0, typically 0)
SMV Rx, APSW     ; Rx = PSW' (reads 0x0020 if in interrupt, else 0x0000)
SMV Rx, APC      ; Rx = PC' (reads shadow PC)
```

### Interrupt Mode (PSW.S=0, PSW'.S=1)
```assembly
SMV Rx, ACS      ; Rx = CS (reads normal CS)
SMV Rx, AR0      ; Rx = R0 (reads normal R0)
SMV Rx, APSW     ; Rx = PSW (reads normal, interrupted PSW)
SMV Rx, APC      ; Rx = PC (reads normal, interrupted PC)
```

## Hardware Implementation

### Context Switching Muxing
```verilog
// Single bit (PSW'.S) controls all context switching
assign active_cs   = psw_shadow_s ? cs_shadow   : cs_normal;
assign active_ds   = psw_shadow_s ? ds_shadow   : ds_normal;
assign active_ss   = psw_shadow_s ? ss_shadow   : ss_normal;  
assign active_es   = psw_shadow_s ? es_shadow   : es_normal;
assign active_pc   = psw_shadow_s ? pc_shadow   : pc_normal;
assign active_psw  = psw_shadow_s ? psw_shadow  : psw_normal;

// General-purpose register muxing
assign active_reg0  = psw_shadow_s ? reg0_shadow  : reg0_normal;
assign active_reg1  = psw_shadow_s ? reg1_shadow  : reg1_normal;
assign active_reg2  = psw_shadow_s ? reg2_shadow  : reg2_normal;
assign active_reg13 = psw_shadow_s ? reg13_shadow : reg13_normal;
assign active_reg14 = psw_shadow_s ? reg14_shadow : reg14_normal;

// Other registers (R3-R12, R15) always use normal context
assign active_reg3  = reg3_normal;
// ... etc for R4-R12 ...
assign active_reg15 = reg15_normal;  // PC special case handled above
```

### Interrupt Entry Logic
```verilog
always @(posedge interrupt_trigger) begin
    // Set shadow context
    psw_shadow <= 16'h0020;    // S=1, I=0
    
    // Initialize all shadows to 0
    cs_shadow  <= 16'h0000;
    ds_shadow  <= 16'h0000;
    ss_shadow  <= 16'h0000;
    es_shadow  <= 16'h0000;
    reg0_shadow <= 16'h0000;
    reg1_shadow <= 16'h0000;
    reg2_shadow <= 16'h0000;
    reg13_shadow <= 16'h0000;
    reg14_shadow <= 16'h0000;
    
    // Set handler address
    pc_shadow <= interrupt_vector;  // From vector table
    
    // Note: Normal registers remain unchanged
end
```

## NMI (Non-Maskable Interrupt) Behavior

### Special Characteristics
- **Ignores PSW.I flag** - cannot be disabled by software
- **Vector at 0x0000** - separate from maskable interrupts
- **Cannot be nested** - discarded if already in interrupt
- **Same context switching** - uses same shadow register mechanism

### NMI vs Regular Interrupts
| Aspect | NMI | Regular Interrupt |
|--------|-----|-------------------|
| Maskable | No | Yes (PSW.I controls) |
| Priority | Highest | Normal |
| Nesting | Not allowed | Possible with re-enable |
| Vector | 0x0000 | 0x0001 (HW), 0x0002 (SWI) |

## Key Benefits

### 1. Zero Software Overhead
- **No manual register saving** required in interrupt handlers
- **Hardware-managed context** switching via PSW'.S
- **Fast interrupt entry/exit** - minimal cycles

### 2. Clean Context Separation
- **Interrupt handlers** run in clean, initialized context
- **Normal execution** completely isolated from interrupts
- **Predictable state** - all shadows initialized to 0

### 3. Debugging Support
- **SMV provides symmetric access** to both contexts
- **Inspect interrupted state** from normal mode
- **Examine normal registers** from interrupt mode

### 4. Hardware Simplicity
- **Single control bit** (PSW'.S) for all muxing
- **Minimal shadow registers** - only commonly-used ones
- **Efficient implementation** - ~2,650 LUTs estimated

### 5. Performance Characteristics
- **Interrupt latency**: 2 cycles (entry + jump)
- **Context switch**: 0 cycles (hardware concurrent)
- **Register access**: Immediate (no save/restore penalty)
- **Memory usage**: No stack usage for context saving

## Example Use Cases

### Fast Interrupt Handler
```assembly
timer_isr:
    ; R0', R1', R2', SP', LR' already available as 0
    LDI  TIMER_REG    ; R0' = timer address
    MVS  ES, R0       ; ES' = timer segment
    LDS  R1, ES, [R0] ; R1' = timer value
    ; ... process ...
    RETI
```

### Debugging Interrupted State
```assembly
; After interrupt occurred, inspect context
check_interrupt:
    SMV  R1, APC      ; R1 = PC' (where interrupt occurred)
    SMV  R2, APSW     ; R2 = PSW' (check if still in interrupt)
    SMV  R3, AR0      ; R3 = R0' (shadow R0 value)
    ; ... debug display ...
```

### Nested Interrupt Support
```assembly
; To allow nested interrupts, handler must:
nested_isr:
    ; Save shadow registers if they'll be modified
    ; Enable interrupts
    SETI              ; SET2 0 - enable interrupts
    ; ... handler code ...
    ; Disable interrupts before return
    CLRI              ; CLR2 0 - disable interrupts
    RETI
```

## Best Practices

### 1. Keep Interrupt Handlers Simple
- Use only shadow registers when possible
- Avoid complex calculations
- Return quickly to minimize latency

### 2. Use SMV for Context Inspection
- Debug from normal mode using SMV
- Check interrupted PC and PSW
- Validate interrupt behavior

### 3. Segment 0 Organization
- Place interrupt vectors at 0x0000-0x0002
- Keep interrupt handlers in low memory
- Reserve space for future expansion

### 4. Stack Usage
- Shadow SP (R13') initialized to 0
- Set up stack in interrupt handler if needed
- Use negative offsets for clean access: `LD R1, [SP-4]`

## Limitations and Considerations

### 1. Limited Shadow Registers
- Only R0, R1, R2, SP, LR have shadows
- Complex handlers may need to save other registers manually
- Use stack for additional register preservation

### 2. Segment 0 Requirement
- All interrupts run in segment 0
- Handler code and data must be in segment 0 or use segment override
- Consider memory organization accordingly

### 3. Non-Nestable by Default
- Interrupts disabled during handler execution (PSW'.I=0)
- Manual re-enable required for nesting
- Consider re-entrancy requirements

### 4. PSW' Management
- PSW' controlled entirely by hardware
- Software cannot directly modify PSW'
- SMV provides read-only access

---

**This design provides zero-overhead interrupt context switching with minimal hardware complexity, clean context separation, and practical debugging support - ideal for embedded systems and educational use.**

*Deep16 Interrupt Context Switching Specification v2.0 - Updated with extended shadow registers*
