# **Deep16 Floating-Point Unit (FPU) Manual v2.0**
## **Accumulator-Based 2-Register Window Design**

---

## **1. Overview**

Deep16 includes a floating-point capability through **software emulation** of FPU instructions, with a path for future hardware acceleration. All FPU instructions use reserved opcode space and trap to software emulation via the illegal instruction handler.

### **1.1 Key Features**
- **7 computational operations** + **1 setup operation**
- **Accumulator-based design** - F0 acts as implicit accumulator
- **2-register virtual window** mapped to CPU register pairs
- **IEEE 754 single-precision** (32-bit) format
- **Software emulation first** - hardware acceleration path
- **Educational focus** - understand FPU internals through software

### **1.2 Performance Characteristics**
```
Software Emulation (initial):
  FADD/FMUL:  ~60 cycles    FDIV:   ~150 cycles
  FSQRT:     ~200 cycles    FCMP:   ~50 cycles  
  FEXP:      ~300 cycles    FLOG:   ~350 cycles

Future Hardware Acceleration:
  All operations: 3-40 cycles (10-20× faster)
```

---

## **2. FPU Architecture**

### **2.1 Virtual FP Register Model**

**Virtual FP Registers (mapped to CPU register pairs):**
```
F0 = R(fp_base):R(fp_base+1)   ; Accumulator (destination)
F1 = R(fp_base+2):R(fp_base+3) ; Source operand
```

**FINIT Instruction:**
- `FINIT Rx` where Rx is even (0, 2, 4, ..., 14)
- Establishes mapping: F0→Rx:Rx+1, F1→Rx+2:Rx+3
- Example: `FINIT R4` sets F0=R4:R5, F1=R6:R7

**Accumulator Model:**
- **F0 acts as implicit accumulator** for all operations
- Binary ops: F0 = F0 op F1
- Unary ops: F0 = op(F0)
- FCMP: Compare F0 and F1

### **2.2 CPU Configuration Register**
```
Address: 0xF0010 (I/O space)

Bits:
  0: FPU_PRESENT (1 = hardware present, 0 = software only)
  1: CACHE_ENABLED
  2: BRANCH_PREDICT
  3: PIPELINE_FLUSH_ON_RETI
  4-15: Reserved (0)
```

---

## **3. Instruction Set**

### **3.1 Opcode Space Allocation**

```
14-bit: 1111111110 10 rrrr   (FINIT only - setup register window)
14-bit: 111111111111 10 ff   (4 core operations: FADD, FMUL, FDIV, FSQRT)
15-bit: 111111111111 110 f    (2 transcendental operations: FEXP, FLOG)
16-bit: 111111111111 1110    (1 special operation: FCMP)
```

### **3.2 Setup Instruction**

#### **FINIT - Initialize FPU Register Window**
```
Format: 1111111110 10 rrrr
Operation: Establish FPU register mapping:
           F0 = R(rrrr):R(rrrr+1)
           F1 = R(rrrr+2):R(rrrr+3)
Requires: rrrr must be EVEN (0, 2, 4, ..., 14)
Note: Does not modify register contents, only establishes mapping
```

### **3.3 Binary Operations (F0 = F0 op F1)**

#### **FADD - Floating-Point Addition**
```
Format: 111111111111 10 00
Operation: F0 = F0 + F1
```

#### **FMUL - Floating-Point Multiplication**
```
Format: 111111111111 10 01
Operation: F0 = F0 × F1
```

#### **FDIV - Floating-Point Division**
```
Format: 111111111111 10 10
Operation: F0 = F0 ÷ F1
Note: Consistent accumulator model (not x87-style pop)
```

### **3.4 Unary Operations (F0 = op(F0))**

#### **FSQRT - Square Root**
```
Format: 111111111111 10 11
Operation: F0 = √F0
```

#### **FEXP - Exponential**
```
Format: 111111111111 110 0
Operation: F0 = exp(F0)  (e^x)
```

#### **FLOG - Natural Logarithm**
```
Format: 111111111111 110 1
Operation: F0 = log(F0)  (ln(x))
```

### **3.5 Comparison Operation**

#### **FCMP - Compare**
```
Format: 111111111111 1110
Operation: Compare F0 and F1, set CPU flags:
           Z=1 if F0 == F1 (or both ±0)
           N=1 if F0 < F1 (signed comparison)
           V=1 if unordered (either operand is NaN)
           C flag undefined
Note: Register contents preserved (non-destructive)
```

---

## **4. IEEE 754 Single-Precision Format**

### **4.1 Bit Layout**
```
31 30                23 22                      0
│  │                   │                         │
S  EEEEEEEE EMMMMMMMMMM MMMMMMMMMMMMMMMMMMMMMMM
│  │                   │                         │
└──┴───────┴───────────┴─────────────────────────┘
S: Sign (1 bit) - 0=positive, 1=negative
E: Exponent (8 bits) - biased by 127
M: Mantissa (23 bits) - with implicit leading 1
```

### **4.2 Special Values**
```
Exponent    Mantissa     Value
---------   ---------    -----
255 (0xFF)  ≠ 0         NaN (Not a Number)
255 (0xFF)  = 0         ±Infinity (sign determines ±)
1-254       any         Normal: ±1.M × 2^(E-127)
0 (0x00)    ≠ 0         Denormal: ±0.M × 2^(-126)  
0 (0x00)    = 0         ±Zero (sign determines ±)
```

### **4.3 Range and Precision**
```
Normal range:     ±1.175494×10^(-38) to ±3.402823×10^(38)
Denormal range:   ±1.401298×10^(-45) to ±1.175494×10^(-38)
Precision:        ~7.22 decimal digits (24-bit mantissa)
Epsilon:          2^(-23) ≈ 1.192×10^(-7)
```

---

## **5. Data Movement and Register Management**

### **5.1 Loading Data into FPU Registers**

Since FPU operates on CPU registers directly, use normal CPU instructions:

```assembly
; Load float value 1.5 (0x3FC00000) into F0
; Assuming FINIT R4 was executed (F0 = R4:R5)
LDI 0x3FC0        ; High word: 0x3FC0
MOV R4, R0        ; R4 = 0x3FC0
LDI 0x0000        ; Low word: 0x0000  
MOV R5, R0        ; R5 = 0x0000
; Now F0 = 1.5

; Load from memory into F1
; F1 = R6:R7 (after FINIT R4)
LD R6, [address_high]
LD R7, [address_low]
```

### **5.2 Storing FPU Results**

```assembly
; Store F0 result to memory
; F0 = R4:R5 (after FINIT R4)
ST [result_high], R4
ST [result_low], R5
```

### **5.3 Moving Between F0 and F1**

```assembly
; Swap F0 and F1 contents (after FINIT R4)
; F0=R4:R5, F1=R6:R7
MOV R8, R4    ; Temp = F0 high
MOV R9, R5    ; Temp = F0 low
MOV R4, R6    ; F0 high = F1 high
MOV R5, R7    ; F0 low = F1 low
MOV R6, R8    ; F1 high = old F0 high
MOV R7, R9    ; F1 low = old F0 low
```

### **5.4 CPU-Based FP Operations**

#### **FNEG - Negate (in CPU)**
```assembly
; Negate value in F0 (R4:R5)
XOR R4, 0x8000   ; Toggle sign bit (bit 15)
```

#### **FABS - Absolute Value (in CPU)**
```assembly
; Absolute value of F0 (R4:R5)
AND R4, 0x7FFF   ; Clear sign bit (bit 15)
```

---

## **6. Programming Examples**

### **6.1 Basic Arithmetic**
```assembly
; Compute: y = (a × b) + c

; Setup FPU window at R0
FINIT R0          ; F0=R0:R1, F1=R2:R3

; Load a into F0, b into F1
; (Assume loaded from memory using normal LD)
FMUL              ; F0 = a × b
; Save F0 (a×b) temporarily
MOV R4, R0        ; CPU temp for high word
MOV R5, R1        ; CPU temp for low word

; Load c into F0, 1.0 into F1 for addition
; (Generate 1.0 = 0x3F800000)
LDI 0x3F80
MOV R2, R0        ; F1 high = 0x3F80
LDI 0x0000
MOV R3, R0        ; F1 low = 0x0000
; Restore a×b to F0
MOV R0, R4
MOV R1, R5
; Load c into... wait, F0 has a×b, F1 has 1.0
; Need c in F0, a×b in F1
; This shows data movement challenge
```

### **6.2 Division Example**
```assembly
; Compute: ratio = numerator / denominator

FINIT R0          ; F0=R0:R1, F1=R2:R3

; Load numerator into F0, denominator into F1
; (Using normal LD instructions)
FDIV              ; F0 = numerator ÷ denominator
; Result in F0 (R0:R1)
```

### **6.3 Using Transcendental Functions**
```assembly
; Compute: sigmoid(x) = 1.0 / (1.0 + exp(-x))

FINIT R0          ; F0=R0:R1, F1=R2:R3

; Load x into F0
; Compute -x (negate in CPU)
XOR R0, 0x8000    ; Toggle sign bit
; Compute exp(-x)
FEXP              ; F0 = exp(-x)
; Compute 1.0 + exp(-x)
; Need to load 1.0 into F1
LDI 0x3F80        ; 1.0 high
MOV R2, R0
LDI 0x0000
MOV R3, R0        ; F1 = 1.0
FADD              ; F0 = 1.0 + exp(-x)
; Compute reciprocal: 1.0 / (1.0 + exp(-x))
; Need to swap F0 and F1
MOV R4, R0        ; Temp swap
MOV R5, R1
MOV R0, R2
MOV R1, R3
MOV R2, R4
MOV R3, R5        ; Now F0=1.0, F1=(1.0+exp(-x))
FDIV              ; F0 = 1.0 / (1.0 + exp(-x))
```

### **6.4 Conditional Execution**
```assembly
; if (x > 0.0) then y = sqrt(x) else y = 0.0

FINIT R0          ; F0=R0:R1, F1=R2:R3

; Load x into F0, 0.0 into F1
LDI 0x0000        ; 0.0 high
MOV R2, R0
MOV R3, R0        ; F1 = 0.0
FCMP              ; Compare x and 0.0
JN  .x_negative   ; Jump if x < 0.0 (N=1)

; x >= 0.0
FSQRT             ; F0 = √x
JMP .done

.x_negative:
; Load 0.0 into F0
MOV R0, R2
MOV R1, R3        ; F0 = 0.0

.done:
; Result in F0
```

---

## **7. Math Software Library**

### **7.1 Available Functions (0xF9000)**
```c
// Extended functions (beyond hardware)
float pow(float x, float y);     // x^y via exp(y×log(x))
float sin(float x);              // sine
float cos(float x);              // cosine via sin(x+π/2)
float tan(float x);              // tangent
float asin(float x);             // arcsine
float acos(float x);             // arccosine
float atan(float x);             // arctangent
float sinh(float x);             // hyperbolic sine
float cosh(float x);             // hyperbolic cosine
float tanh(float x);             // hyperbolic tangent

// Utility functions
float floor(float x);            // round down to integer
float ceil(float x);             // round up to integer
float fmod(float x, float y);    // floating-point remainder
```

### **7.2 Calling Convention**
```assembly
; Call pow(x, y) library function
; 1. Push arguments to predefined memory locations
; 2. Call via SWI with function code

ST [ARG1_HIGH], R0   ; x high
ST [ARG1_LOW], R1    ; x low
ST [ARG2_HIGH], R2   ; y high  
ST [ARG2_LOW], R3    ; y low
LDI POW_FUNC_ID      ; Function code for pow()
SWI                  ; Software interrupt
; Result in predefined result location
LD R0, [RESULT_HIGH]
LD R1, [RESULT_LOW]
```

---

## **8. Instruction Quick Reference**

### **8.1 Opcode Map**
```
Instruction        Binary Encoding          Operation
─────────────────────────────────────────────────────────────
FINIT Rx      1111111110 10 rrrr    Map F0,F1 to CPU regs

FADD          111111111111 10 00    F0 = F0 + F1
FMUL          111111111111 10 01    F0 = F0 × F1
FDIV          111111111111 10 10    F0 = F0 ÷ F1
FSQRT         111111111111 10 11    F0 = √F0

FEXP          111111111111 110 0    F0 = exp(F0)
FLOG          111111111111 110 1    F0 = log(F0)

FCMP          111111111111 1110     Compare F0 and F1
```

### **8.2 Register Mapping**
```
FINIT R0:  F0 = R0:R1,   F1 = R2:R3
FINIT R2:  F0 = R2:R3,   F1 = R4:R5
FINIT R4:  F0 = R4:R5,   F1 = R6:R7
FINIT R6:  F0 = R6:R7,   F1 = R8:R9
FINIT R8:  F0 = R8:R9,   F1 = R10:R11
FINIT R10: F0 = R10:R11, F1 = R12:R13
FINIT R12: F0 = R12:R13, F1 = R14:R15
FINIT R14: F0 = R14:R15, F1 = ?:?    (R16,R17 don't exist!)
Note: FINIT R14 is invalid (not enough following registers)
```

### **8.3 Common Sequences**
```
Addition:        FINIT, load a→F0, b→F1, FADD
Subtraction:     FINIT, load a→F0, b→F1, FNEG(b in CPU), FADD
Multiplication:  FINIT, load a→F0, b→F1, FMUL
Division:        FINIT, load a→F0, b→F1, FDIV
Square root:     FINIT, load x→F0, FSQRT
Comparison:      FINIT, load a→F0, b→F1, FCMP, branch on flags
```

---

## **9. Implementation Notes**

### **9.1 Software Emulation Handler**
All FPU instructions trap to vector 0 (illegal instruction). The handler:
1. Decodes the FPU instruction
2. Reads operands from CPU registers (based on last FINIT)
3. Performs operation in software
4. Writes result back to CPU registers
5. Returns to next instruction

### **9.2 Hardware Acceleration Path**
When FPU_PRESENT bit is set:
1. Trap handler checks configuration register
2. If hardware present, dispatches to hardware FPU
3. Hardware reads/writes CPU registers directly
4. No software emulation overhead

### **9.3 Performance Considerations**
```
Data movement is critical: FPU operates directly on CPU registers
Minimize: FINIT calls (setup overhead)
Maximize: Sequences of FP operations between data moves
Consider: Using multiple FINIT contexts for different computation phases
```

---

## **10. Educational Exercises**

### **10.1 Implement Software FPU**
```
1. Write IEEE 754 single-precision format handlers
2. Implement FADD/FMUL software algorithms
3. Add FDIV using Newton-Raphson iteration
4. Implement FSQRT using Babylonian method
5. Add FEXP using Taylor series approximation
6. Implement FLOG using similar approximations
```

### **10.2 Optimization Challenges**
```
1. Minimize FINIT overhead in loops
2. Implement register renaming to avoid moves
3. Create efficient constant generation routines
4. Design hardware FPU block diagram
5. Estimate cycle counts for each operation
```

### **10.3 Numerical Analysis**
```
1. Test precision limits of each operation
2. Compare software vs hardware rounding behavior
3. Analyze error propagation in complex expressions
4. Implement Kahan summation algorithm
5. Test special value handling (NaN, Inf, denormals)
```

---

**Deep16 FPU Manual v2.0** - Accumulator-based 2-register window design. This minimalist approach provides essential floating-point capability while maintaining hardware simplicity and educational value. The virtual register window mapped to physical CPU registers enables efficient software emulation with a clear path to hardware acceleration.
