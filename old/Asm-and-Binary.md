# Deep16 Assembler Manual
## Version: Milestone 3pre1 (Based on Architecture 1r7)

---

## 📋 Table of Contents

1. [Overview](#1-overview)
2. [Assembler Pseudo-Ops](#2-assembler-pseudo-ops)
3. [Instruction Syntax](#3-instruction-syntax)
4. [Binary Format Specification](#4-binary-format-specification)
5. [Usage Examples](#5-usage-examples)
6. [Register Reference](#6-register-reference)

---

## 1. Overview

The Deep16 assembler is a Lua-based tool that converts Deep16 assembly code into executable binaries compatible with the Deep16 architecture. It supports the complete Deep16 instruction set with segmented memory addressing and advanced features like shadow registers.

### Features
- Complete Deep16 instruction set support
- Symbol definition (.equ directives)
- Segment management (CODE, DATA, STACK)
- Label support for jumps and branches
- Binary output with proper headers
- Error checking and reporting

---

## 2. Assembler Pseudo-Ops

### 2.1 Segment Directives

#### `.code [address]`
- **Purpose**: Switch to CODE segment and optionally set load address
- **Arguments**: Optional starting address (default: 0x0000)
- **Example**:
  ```assembly
  .code 0x0000    ; Code segment starting at 0x0000
  .code           ; Code segment at default address
  ```

#### `.data [address]`
- **Purpose**: Switch to DATA segment and optionally set load address
- **Arguments**: Optional starting address (default: 0x0100)
- **Example**:
  ```assembly
  .data 0x0200    ; Data segment starting at 0x0200
  .data           ; Data segment at default address (0x0100)
  ```

#### `.stack [address]`
- **Purpose**: Switch to STACK segment and optionally set load address
- **Arguments**: Optional starting address (default: 0x0400)
- **Example**:
  ```assembly
  .stack 0x1000   ; Stack segment starting at 0x1000
  .stack          ; Stack segment at default address (0x0400)
  ```

### 2.2 Symbol Definition

#### `.equ symbol, value`
- **Purpose**: Define a constant symbol
- **Arguments**: Symbol name, numeric value or expression
- **Example**:
  ```assembly
  .equ ARRAY_SIZE, 42
  .equ STACK_START, 0x0400
  .equ MASK, 0xFF00
  ```

#### Alternative: `symbol = value`
- **Purpose**: Alternative syntax for symbol definition
- **Example**:
  ```assembly
  ARRAY_SIZE = 42
  STACK_START = 0x0400
  ```

### 2.3 Memory Allocation

#### `.dw value1, value2, ...`
- **Purpose**: Define word values in current segment
- **Arguments**: Comma-separated list of 16-bit values
- **Example**:
  ```assembly
  .data
  table: 
      .dw 1, 2, 3, 4, 5       ; 5 words initialized with values
      .dw 0x1234, 0x5678      ; Hexadecimal values
      .dw label1, label2      ; Label addresses
  ```

### 2.4 Program Control

#### `.org address`
- **Purpose**: Set current assembly address within segment
- **Arguments**: 16-bit address
- **Example**:
  ```assembly
  .org 0x0100      ; Continue assembly at address 0x0100
  ```

#### `.start address`
- **Purpose**: Set program entry point (initial PC value)
- **Arguments**: 16-bit address
- **Example**:
  ```assembly
  .start 0x0000    ; Program starts execution at 0x0000
  ```

---

## 3. Instruction Syntax

### 3.1 Basic Syntax Rules

- **Instructions**: Uppercase or lowercase (case-insensitive)
- **Registers**: R0-R15 or aliases (FP, SP, LR, PC)
- **Immediates**: Decimal, hexadecimal (0x), or binary (0b)
- **Labels**: End with colon, referenced without colon
- **Comments**: Start with semicolon (;)

### 3.2 Instruction Categories

#### Immediate Operations
```assembly
LDI 42000          ; R0 = 42000 (0xA410)
LSI R1, -5         ; R1 = -5 (sign-extended 5-bit)
```

#### Memory Operations
```assembly
LD R2, R3, 5       ; R2 = MEM[DS:R3 + 5]
ST R4, SP, 2       ; MEM[SS:SP + 2] = R4
LDS R5, DS, R6     ; R5 = MEM[DS:R6] (explicit segment)
STS R7, ES, R8     ; MEM[ES:R8] = R7 (explicit segment)
```

#### Arithmetic/Logic Operations
```assembly
ADD R1, R2         ; R1 = R1 + R2
SUB R3, R4, w=0    ; Compare R3 - R4 (flags only)
AND R5, 0xF        ; R5 = R5 & 0xF (immediate)
OR R6, R7          ; R6 = R6 | R7
XOR R8, R9         ; R8 = R8 ^ R9
```

#### Control Flow
```assembly
JMP label          ; Unconditional jump
JZ  target         ; Jump if zero
JNZ loop           ; Jump if not zero
JC  error          ; Jump if carry
JNC continue       ; Jump if no carry
JN  negative       ; Jump if negative
JNN positive       ; Jump if not negative
```

#### Data Movement
```assembly
MOV R1, R2, 0      ; R1 = R2 (offset 0)
MOV R3, R4, 2      ; R3 = R4 + 2
MVS R5, DS         ; R5 = DS (move from segment)
MVS ES, R6         ; ES = R6 (move to segment)
```

#### System Operations
```assembly
NOP                ; No operation
HLT                ; Halt processor
SWI                ; Software interrupt
RETI               ; Return from interrupt
```

#### Special Operations
```assembly
SMV R1, APC        ; R1 = alternate PC
SMV R2, APSW       ; R2 = alternate PSW
SMV R3, PSW        ; R3 = current PSW
LJMP R4            ; Long jump to CS=R4, PC=R5 (R4 must be even)
SWB R6             ; Swap bytes in R6
INV R7             ; Invert bits in R7 (ones complement)
NEG R8             ; Two's complement of R8
```

---

## 4. Binary Format Specification

### 4.1 File Structure

The Deep16 binary format uses a segmented structure with a header:

```
+--------------------------------+
|          Header (16B)          |
+--------------------------------+
|        Segment 1 Entry         |
+--------------------------------+
|        Segment 1 Data          |
+--------------------------------+
|        Segment 2 Entry         |
+--------------------------------+
|        Segment 2 Data          |
+--------------------------------+
|              ...               |
+--------------------------------+
```

### 4.2 Header Format (16 bytes)

| Offset | Size | Field        | Description                     |
|--------|------|--------------|---------------------------------|
| 0x00   | 10   | Magic        | "DeepSeek16" (ASCII)           |
| 0x0A   | 1    | Version Maj  | Major version (0x00)           |
| 0x0B   | 1    | Version Min  | Minor version (0x01)           |
| 0x0C   | 2    | Start Addr   | Program entry point (PC)       |
| 0x0E   | 1    | Seg Count    | Number of segments             |
| 0x0F   | 1    | Reserved     | Padding (0x00)                 |

### 4.3 Segment Entry Format (5 bytes + data)

| Offset | Size | Field        | Description                     |
|--------|------|--------------|---------------------------------|
| 0x00   | 1    | Type         | Segment type (0x01-0x03)       |
| 0x01   | 2    | Load Addr    | Segment load address           |
| 0x03   | 2    | Data Words   | Number of 16-bit words         |

**Segment Types:**
- `0x01` = CODE segment
- `0x02` = DATA segment  
- `0x03` = STACK segment

### 4.4 Segment Data

Following each segment entry is the actual data:

- **Size**: `Data Words × 2` bytes
- **Format**: Big-endian 16-bit words
- **Alignment**: No padding between segments

---

## 5. Usage Examples

### 5.1 Basic Assembly File

```assembly
; Simple Deep16 program
.equ DATA_START, 0x0100
.equ STACK_INIT, 0x0400

.start 0x0000
.code 0x0000

main:
    ; Initialize stack pointer
    LDI STACK_INIT
    MOV SP, R0, 0
    
    ; Load and process data
    LDI DATA_START
    MOV R1, R0, 0
    LD R2, R1, 0
    ADD R2, R2, 1
    ST R2, R1, 0
    
    HLT

.data 0x0100
value: .dw 42
```

### 5.2 Complete Program with Subroutines

```assembly
; Bubble sort implementation
.equ ARRAY_SIZE, 42
.equ ARRAY_ADDR, 0x0100

.start 0x0000
.code 0x0000

main:
    LDI 0x0400
    MOV SP, R0, 0          ; Init stack
    
    MOV LR, PC, 2          ; Save return address
    JMP init_array         ; Call init
    
    MOV LR, PC, 2
    JMP bubble_sort        ; Call sort
    
    HLT

init_array:
    ; Array initialization code
    ; ...
    MOV PC, LR, 0          ; Return

bubble_sort:
    ; Sorting algorithm
    ; ...
    MOV PC, LR, 0          ; Return

.data 0x0100
array: .dw 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
       .dw 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
       .dw 0,0
```

### 5.3 Assembler Command Line

```bash
# Basic assembly
lua as-deep16.lua program.asm

# Specify output file
lua as-deep16.lua program.asm output.bin

# The assembler creates:
# - program.bin (if no output specified)
# - Removes .asm extension by default
```

---

## 6. Register Reference

### 6.1 General Purpose Registers

| Register | Alias | Purpose                      |
|----------|-------|------------------------------|
| R0       |       | LDI destination, temporary   |
| R1-R11   |       | General purpose              |
| R12      | FP    | Frame Pointer               |
| R13      | SP    | Stack Pointer               |
| R14      | LR    | Link Register               |
| R15      | PC    | Program Counter             |

### 6.2 Segment Registers

| Register | Code | Purpose         |
|----------|------|-----------------|
| CS       | 00   | Code Segment    |
| DS       | 01   | Data Segment    |
| SS       | 10   | Stack Segment   |
| ES       | 11   | Extra Segment   |

### 6.3 Special Registers (via SMV)

| Mnemonic | Purpose                    |
|----------|----------------------------|
| APC      | Alternate PC (shadow)      |
| APSW     | Alternate PSW (shadow)     |
| PSW      | Current Processor Status   |
| ACS      | Alternate CS (shadow)      |

---

## 7. Error Messages

Common assembler errors and their meanings:

- **"Ungültiges Register"**: Invalid register specification
- **"Immediate zu groß"**: Immediate value out of range
- **"Label nicht gefunden"**: Undefined label reference
- **"Segment nicht gefunden"**: Invalid segment specification
- **"Assemblierungsfehler"**: General assembly error

---

## Appendix: Instruction Encoding Quick Reference

### Opcode Prefixes
- `0xxx`: LDI
- `10xx`: LD/ST
- `110x`: ALU operations
- `1110`: JMP/LSI
- `11110`: LDS/STS
- `111110`: MOV
- `1111110`: SET/CLR
- `111111110`: MVS
- `1111111110`: SMV/LJMP
- `11111111110`: SWB/INV
- `111111111110`: NEG
- `1111111111110`: SYS

*This manual covers Deep16 Assembler for Milestone 3pre1 based on Architecture Specification 1r7.*
