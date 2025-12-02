# **Deep16 Floating-Point Unit (FPU) Manual**
## **Software Emulation with Future Hardware Acceleration**

---

## **1. Overview**

Deep16 includes a floating-point capability through **software emulation** of FPU instructions, with a path for future hardware acceleration. All FPU instructions use reserved opcode space and trap to software emulation via the illegal instruction handler.

### **1.1 Key Features**
- **6 computational operations** + **2 interface operations**
- **FMA-focused design** - Fused Multiply-Add as core operation
- **4-deep hardware stack** for operand management
- **IEEE 754 single-precision** (32-bit) format
- **Software emulation first** - hardware acceleration path
- **Educational focus** - understand FPU internals through software

### **1.2 Performance Characteristics**
```
Software Emulation (initial):
  FMA:    ~80 cycles    FDIV:   ~150 cycles
  FSQRT:  ~200 cycles   FCMP:   ~30 cycles  
  FEXP:   ~300 cycles   FSIN:   ~400 cycles

Future Hardware Acceleration:
  All operations: 3-40 cycles (10-20× faster)
```

---

## **2. FPU Architecture**

### **2.1 Register Model**

**FPU Stack (4 levels deep):**
```
ST(0) - Top of Stack (TOS) - Primary operand
ST(1) - Second element
ST(2) - Third element  
ST(3) - Fourth element
```

**Accumulator Model:**
- **ST(0) acts as implicit accumulator** for FMA operations
- Stack automatically adjusts on operations

**Interface with CPU Registers:**
- FPU uses **even-numbered CPU register pairs** for 32-bit floats
- `FR(x) = R(x:x+1)` where x is even (0, 2, 4, ..., 14)

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
11-bit: 11111111101 d rrrr   (FPUSH/FPOP only)
14-bit: 11111111110 ff       (4 core operations)  
15-bit: 111111111110 f        (2 transcendental operations)
```

### **3.2 Interface Instructions**

#### **FPUSH - Push CPU Register Pair to FP Stack**
```
Format: 11111111101 0 rrrr
Operation: Push FR(rrrr) = R(rrrr:rrrr+1) onto FP stack
           Stack shifts up: ST(3) lost, ST(0) = new value
Requires: rrrr must be EVEN (0, 2, 4, ..., 14)
```

#### **FPOP - Pop FP Stack to CPU Register Pair**
```
Format: 11111111101 1 rrrr  
Operation: Pop ST(0) to FR(rrrr) = R(rrrr:rrrr+1)
           Stack shifts down: ST(1)→ST(0), ST(2)→ST(1), ST(3)→ST(2)
Requires: rrrr must be EVEN
```

### **3.3 Computational Instructions**

#### **FMA - Fused Multiply-Add**
```
Format: 11111111110 00
Operation: ST(0) = ST(1) × ST(2) + ST(0)
Stack effect: Pops ST(1) and ST(2), result becomes new ST(0)
           ST(3) moves to ST(1), new ST(2) and ST(3) are undefined

Covers: Addition, subtraction, multiplication
  Addition:      FMA(1.0, a, b)     ; 1×a + b
  Subtraction:   FMA(1.0, a, -b)    ; 1×a + (-b)
  Multiplication: FMA(a, b, 0.0)     ; a×b + 0
```

#### **FDIV - Division**
```
Format: 11111111110 01
Operation: ST(0) = ST(1) ÷ ST(0)
Stack effect: Pops ST(0), result becomes new ST(0)
           ST(2)→ST(1), ST(3)→ST(2), new ST(3) undefined
```

#### **FSQRT - Square Root**
```
Format: 11111111110 10
Operation: ST(0) = √ST(0)
Stack effect: Unary, replaces ST(0) with result
           Stack unchanged otherwise
```

#### **FCMP - Compare**
```
Format: 11111111110 11
Operation: Compare ST(1) and ST(0), set CPU flags
           Z=1 if equal, N=1 if ST(1) < ST(0), V=1 if unordered (NaN)
Stack effect: None (stack preserved)
```

#### **FEXP - Exponential**
```
Format: 111111111110 0
Operation: ST(0) = exp(ST(0))  (e^x)
Stack effect: Unary, replaces ST(0) with result
```

#### **FSIN - Sine**
```
Format: 111111111110 1
Operation: ST(0) = sin(ST(0))
Stack effect: Unary, replaces ST(0) with result
Note: Cosine via sin(x + π/2) in software library
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

## **5. Software Emulation Details**

### **5.1 Illegal Instruction Trap**
All FPU instructions initially trap to vector 0:
```
On executing FPU instruction (bits[15:14] = 11):
  1. PC' ← PC (points to next instruction)
  2. PSW' ← 0x0020 (S=1, I=0)
  3. All shadow segments ← 0
  4. All shadow GP registers ← 0
  5. Jump to vector 0 (illegal instruction handler)
```

### **5.2 Emulation Handler**
```assembly
.org 0x0000
ill_handler:
    ; Save context
    ST   R0, [SP-1]
    ST   R1, [SP-2]
    
    ; Get faulting instruction
    SMV  R0, APC      ; R0 = PC' (after fault)
    SUB  R0, 1        ; R0 = address of illegal instruction
    LD   R1, [R0]     ; R1 = instruction
    
    ; Check if FPU instruction
    AND  R2, R1, 0xC000  ; bits[15:14]
    CMP  R2, 0xC000      ; 11xxxx xxxx xxxx?
    JNZ  .true_illegal
    
    ; Decode and emulate FPU instruction
    CALL emulate_fpu     ; Software at 0xF8000
    
    ; Skip faulting instruction on return
    SMV  R0, APC
    JMP  R0
    
.true_illegal:
    ; Real illegal instruction
    CALL report_error
    HLT
```

### **5.3 Emulation Library Location**
```
0xF8000 - 0xF8FFF: FPU software emulation
0xF9000 - 0xF9FFF: Math library (exp, log, sin, cos, etc.)
```

---

## **6. Programming Examples**

### **6.1 Generating Constants**
```assembly
; Generate 1.0f (0x3F800000) in FR0 (R0:R1)
LDI  0x3F80      ; High word (sign-extended to 0x3F80)
MOV  R0, R0      ; R0 = 0x3F80
LDI  0x0000      ; Low word
MOV  R1, R0      ; R1 = 0x0000
; R0:R1 now contains 1.0f

; Generate 0.0f
LDI  0
MOV  R2, R0      ; R2 = 0x0000
MOV  R3, R0      ; R3 = 0x0000

; Generate -1.0f (0xBF800000)
LDI  0xBF80      ; High word with sign bit
MOV  R4, R0
LDI  0x0000
MOV  R5, R0
```

### **6.2 Basic Arithmetic**
```assembly
; Compute: y = (a × b) + c

; Load constants first
; (Generate 1.0 in R10:R11, 0.0 in R12:R13 as shown above)

; Computation
FPUSH a          ; ST(0)=a
FPUSH b          ; ST(0)=b, ST(1)=a
FPUSH 0.0        ; ST(0)=0.0, ST(1)=b, ST(2)=a
FMA              ; ST(0)=a×b+0.0 = a×b, ST(1)=0.0
FPUSH c          ; ST(0)=c, ST(1)=a×b, ST(2)=0.0
FPUSH 1.0        ; ST(0)=1.0, ST(1)=c, ST(2)=a×b
FMA              ; ST(0)=c×1.0 + (a×b) = a×b + c
FPOP result      ; Store result
```

### **6.3 Sign Operations (CPU-based)**
```assembly
; Negate value in FR0 (R0:R1)
FPOP  R2         ; Pop to R2:R3
; Toggle sign bit (bit 15 of high word)
XOR   R2, 15     ; R2 XOR (1 << 15) - toggles sign bit!
FPUSH R2         ; Push back negated

; Absolute value of FR4 (R4:R5)
FPOP  R6         ; Pop to R6:R7
; Clear sign bit (bit 15 of high word)
; Need mask with all bits except bit 15
LDI  0x7FFF      ; 0111111111111111
AND  R6, R0      ; Clear sign bit
FPUSH R6         ; Push back
```

### **6.4 Using Transcendental Functions**
```assembly
; Compute: y = sin(x) × exp(-x²/2)

FPUSH x          ; ST(0)=x
FDUP             ; Need DUP... but we don't have it!
; Alternative: Push twice from CPU
; (After generating x in CPU register pair)

; This shows why DUP would be useful
; Workaround: Use software library for complex expressions
```

---

## **7. Math Software Library**

### **7.1 Available Functions (0xF9000)**
```c
// Basic operations (for complex expressions)
float add(float a, float b);
float sub(float a, float b);
float mul(float a, float b);
float neg(float a);
float abs(float a);

// Transcendentals  
float exp(float x);      // e^x
float log(float x);      // ln(x)
float log10(float x);    // log10(x)
float pow(float x, float y);  // x^y
float sin(float x);
float cos(float x);      // via sin(x + π/2)
float tan(float x);      // sin(x)/cos(x)
float asin(float x);     // arcsin
float acos(float x);     // arccos
float atan(float x);     // arctan
float atan2(float y, float x);  // arctan(y/x)

// Special functions
float sqrt(float x);     // Already in hardware
float cbrt(float x);     // cube root
float hypot(float x, float y);  // √(x² + y²)
```

### **7.2 Calling Convention**
```assembly
; Call sin(x) library function
; 1. Push argument(s) to stack
; 2. Call via SWI with function code

; Example: y = sin(x)
; (Assume x already in FR0)
LDI  SIN_FUNC_ID    ; Function code for sin()
SWI                 ; Software interrupt
; Result in ST(0)
FPOP result
```

---

## **8. Performance Optimization Tips**

### **8.1 Minimize FPU-CPU Transfers**
```
BAD: FPUSH, FPOP, manipulate, FPUSH, FPOP
GOOD: Keep values in FP stack as long as possible
```

### **8.2 Use Constants Efficiently**
```assembly
; Generate constants once, reuse
LDI  0x3F80      ; 1.0 high
MOV  R10, R0
LDI  0x0000
MOV  R11, R0
; Now R10:R11 = 1.0f for entire computation
```

### **8.3 Batch Operations**
```
Group FPU operations together to minimize
trap handler overhead in software emulation.
```

### **8.4 Future Hardware Planning**
```
Same code will run faster when hardware FPU
is added - no changes needed!
```

---

## **9. Common Issues and Solutions**

### **9.1 "Register Not Even" Error**
```
FPUSH requires EVEN register numbers:
Valid: FPUSH R0, FPUSH R2, ..., FPUSH R14
Invalid: FPUSH R1, FPUSH R3, ...
Reason: 32-bit floats need two 16-bit registers
```

### **9.2 Stack Underflow/Overflow**
```
FPU stack is 4 levels deep:
- Underflow: Popping from empty stack
- Overflow: Pushing to full stack (ST(3) is lost!)
Solution: Plan stack usage carefully
```

### **9.3 NaN and Infinity Handling**
```
Operations producing NaN or Infinity:
- Division by zero
- Square root of negative number  
- Invalid FMA operations
Check status via FCMP or examine result bits.
```

### **9.4 Precision Issues**
```
Single precision: ~7 decimal digits
Accumulate errors in long computations
Consider using double in software for critical parts
```

---

## **10. Future Hardware FPU**

### **10.1 Migration Path**
When hardware FPU is implemented:
1. **Same instructions** - binary compatible
2. **CPU config bit** set to 1 (FPU_PRESENT)
3. **Trap handler** checks bit, executes hardware if present
4. **No code changes** required

### **10.2 Hardware Specifications**
```
Estimated gate count: ~25,000 gates (28nm)
Operations: Same 8 instructions
Stack: 4-level hardware stack
Performance: 3-40 cycles per operation
IEEE 754: Fully compliant, all rounding modes
```

### **10.3 Enabling Hardware**
```assembly
; Check if hardware FPU present
LD    R0, [0xF0010]     ; CPU config register
TBC   R0, 0             ; Test FPU_PRESENT bit
JNZ   .hw_fpu_available

; Software emulation path
CALL  emulate_fpu_instruction
```

---

## **11. Instruction Quick Reference**

### **11.1 Opcode Map**
```
Instruction        Binary Encoding          Operation
─────────────────────────────────────────────────────────────
FPUSH Rx       11111111101 0 rrrr   Push FR(rrrr) to stack
FPOP  Rx       11111111101 1 rrrr   Pop stack to FR(rrrr)

FMA            11111111110 00       ST(0)=ST(1)×ST(2)+ST(0)
FDIV           11111111110 01       ST(0)=ST(1)÷ST(0)
FSQRT          11111111110 10       ST(0)=√ST(0)
FCMP           11111111110 11       Compare ST(1) & ST(0)

FEXP           111111111110 0       ST(0)=exp(ST(0))
FSIN           111111111110 1       ST(0)=sin(ST(0))
```

### **11.2 Stack Effects**
```
Operation      Stack Before      Stack After      Notes
────────────   ─────────────     ────────────     ─────
FPUSH val      a b c d           val a b c        d lost!
FPOP           val a b c         a b c ?          ? undefined

FMA            acc x y z         (x×y+acc) z ? ?  pops x,y
FDIV           x y z w           (x÷y) z w ?      pops y
FSQRT          x y z w           √x y z w         unary
FCMP           x y z w           x y z w          no change
FEXP/FSIN      x y z w           f(x) y z w       unary
```

### **11.3 Common Sequences**
```
Addition:       1.0, a, b, FMA
Subtraction:    1.0, a, -b, FMA  (negate b in CPU first)
Multiplication: 0.0, a, b, FMA
Division:       a, b, FDIV
Square root:    a, FSQRT
```

---

## **12. Educational Exercises**

### **12.1 Implement Software FPU**
```
1. Write the illegal instruction handler
2. Implement FMA software emulation
3. Add FDIV using Newton-Raphson
4. Implement FSQRT using approximation
5. Add FEXP/FSIN using polynomial approximations
```

### **12.2 Performance Analysis**
```
1. Profile software emulation performance
2. Identify bottlenecks for hardware acceleration
3. Design hardware FPU block diagram
4. Estimate gate count vs performance tradeoffs
```

### **12.3 Numerical Methods**
```
1. Implement IEEE 754 compliance tests
2. Compare software vs (simulated) hardware results
3. Analyze rounding error accumulation
4. Implement Kahan summation algorithm
```

---

**Deep16 FPU Manual v1.0** - Software emulation with hardware acceleration path. This design provides immediate floating-point capability through software while maintaining a clean migration path to future hardware implementation.
