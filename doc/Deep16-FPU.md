# **Deep16 Floating-Point Unit (FPU) Manual v3.0**
## **Fixed Register Window FPU with Transcendental Support**

---

## **1. Overview**

Deep16 includes a floating-point capability through **software emulation** of FPU instructions, with a path for future hardware acceleration. The FPU uses a fixed 2-register window model with built-in transcendental functions.

### **1.1 Key Features**
- **7 computational operations** including transcendentals
- **Fixed 2-register window** - F0=R2:R3, F1=R4:R5
- **IEEE 754 single-precision** (32-bit) format
- **FEXP/FLOG support** - Enables advanced mathematical functions
- **Software emulation first** - hardware acceleration path
- **Educational focus** - understand FPU internals and function implementation

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

### **2.1 Fixed Register Window**

**FPU uses fixed CPU register pairs:**
```
F0 (accumulator) = R2:R3
F1 (operand)     = R4:R5
```

**Rationale for this assignment:**
1. **R0:R1 remain free** for LDI and general temporary use
2. **R2-R5** are general-purpose registers not used for special purposes
3. **Doesn't conflict** with stack registers (R12-R14)
4. **Predictable and consistent** for compiler code generation

### **2.2 Register Usage Guidelines**
```assembly
; R0:R1 - Free for LDI and general temporary
; R2:R3 - F0 (FP accumulator - modified by FP ops)
; R4:R5 - F1 (FP operand - typically source)
; R6-R11 - General purpose (safe from FPU)
; R12 (FP) - Frame pointer
; R13 (SP) - Stack pointer  
; R14 (LR) - Link register
; R15 (PC) - Program counter
```

### **2.3 CPU Configuration Register**
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
14-bit: 11111111111110 xx   (4 core operations)
15-bit: 111111111111110 x    (2 transcendental operations)  
16-bit: 1111111111111110     (1 comparison operation)
```

### **3.2 Core Arithmetic Operations**

#### **FADD - Floating-Point Addition**
```
Format: 11111111111110 00
Operation: F0 = F0 + F1
Stack effect: R2:R3 = R2:R3 + R4:R5
```

#### **FMUL - Floating-Point Multiplication**
```
Format: 11111111111110 01
Operation: F0 = F0 × F1
Stack effect: R2:R3 = R2:R3 × R4:R5
```

#### **FDIV - Floating-Point Division**
```
Format: 11111111111110 10
Operation: F0 = F0 ÷ F1
Stack effect: R2:R3 = R2:R3 ÷ R4:R5
```

#### **FSQRT - Square Root**
```
Format: 11111111111110 11
Operation: F0 = √F0
Stack effect: R2:R3 = √(R2:R3)
```

### **3.3 Transcendental Operations**

#### **FEXP - Exponential**
```
Format: 111111111111110 0
Operation: F0 = exp(F0)  (e^x)
Stack effect: R2:R3 = exp(R2:R3)
Note: Enables pow(), exp2(), sigmoid(), etc.
```

#### **FLOG - Natural Logarithm**
```
Format: 111111111111110 1
Operation: F0 = log(F0)  (natural log, ln(x))
Stack effect: R2:R3 = ln(R2:R3)
Note: Enables log10(), pow(), etc.
```

### **3.4 Comparison Operation**

#### **FCMP - Compare**
```
Format: 1111111111111110
Operation: Compare F0 and F1, set CPU flags
           Z=1 if equal (or both ±0)
           N=1 if F0 < F1 (signed comparison)
           V=1 if unordered (either operand is NaN)
Stack effect: Preserves all registers
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

## **5. Data Movement and Setup**

### **5.1 Loading Data into FPU Registers**

**Load from memory:**
```assembly
; Load value into F0 (R2:R3)
LD  R2, [address_high]
LD  R3, [address_low]

; Load value into F1 (R4:R5)
LD  R4, [address_high]
LD  R5, [address_low]
```

**Load constant using LDI (R0 free!):**
```assembly
; Load 1.0 (0x3F800000) into F0
LDI 0x3F80        ; High word
MOV R2, R0        ; F0 high = 0x3F80
LDI 0x0000        ; Low word
MOV R3, R0        ; F0 low = 0x0000
; R0 still free for next operation
```

**Move between FP registers:**
```assembly
; Copy F0 to F1
MOV R4, R2        ; F1 high = F0 high
MOV R5, R3        ; F1 low = F0 low

; Copy F1 to F0
MOV R2, R4        ; F0 high = F1 high
MOV R3, R5        ; F0 low = F1 low
```

### **5.2 Storing FPU Results**
```assembly
; Store F0 to memory
ST  R2, [result_high]
ST  R3, [result_low]

; Store F1 to memory
ST  R4, [result_high]
ST  R5, [result_low]
```

### **5.3 CPU-Based FP Operations**

#### **FNEG - Negate**
```assembly
; Negate F0 (R2:R3)
XOR R2, 0x8000    ; Toggle sign bit (bit 15)

; Negate F1 (R4:R5)  
XOR R4, 0x8000    ; Toggle sign bit
```

#### **FABS - Absolute Value**
```assembly
; Absolute value of F0 (R2:R3)
AND R2, 0x7FFF    ; Clear sign bit (bit 15)

; Absolute value of F1 (R4:R5)
AND R4, 0x7FFF    ; Clear sign bit
```

#### **FSUB - Subtraction (via negation + addition)**
```assembly
; Compute a - b
; Assume: a in F0, b in F1

; Negate b in F1
XOR R4, 0x8000    ; F1 = -b
FADD              ; F0 = a + (-b) = a - b
```

---

## **6. Programming Examples**

### **6.1 Basic Arithmetic**
```assembly
; Compute: y = (a × b) + c

; Load a into F0, b into F1
LD  R2, [a_high]
LD  R3, [a_low]
LD  R4, [b_high]
LD  R5, [b_low]

; Compute a × b
FMUL              ; F0 = a × b

; Save a×b temporarily (to memory)
ST  R2, [temp_high]
ST  R3, [temp_low]

; Load c into F0
LD  R2, [c_high]
LD  R3, [c_low]

; Load saved a×b into F1
LD  R4, [temp_high]
LD  R5, [temp_low]

; Add: F0 = c + (a×b)
FADD              ; F0 = a×b + c

; Result in F0 (R2:R3)
```

### **6.2 Using Transcendental Functions**
```assembly
; Compute: sigmoid(x) = 1 / (1 + exp(-x))

; Input: x in memory at [x]

; Load x into F0
LD  R2, [x_high]
LD  R3, [x_low]

; Negate x
XOR R2, 0x8000    ; F0 = -x

; Compute exp(-x)
FEXP              ; F0 = exp(-x)

; Add 1.0
LDI 0x3F80        ; 1.0 high
MOV R4, R0        ; F1 high = 1.0
LDI 0x0000        ; 1.0 low
MOV R5, R0        ; F1 low = 1.0
FADD              ; F0 = 1 + exp(-x)

; Compute reciprocal: 1 / (1 + exp(-x))
; Save denominator
ST  R2, [denom_high]
ST  R3, [denom_low]

; Load 1.0 into F0
LDI 0x3F80
MOV R2, R0
LDI 0x0000
MOV R3, R0

; Load denominator into F1
LD  R4, [denom_high]
LD  R5, [denom_low]

; Divide: 1 / denominator
FDIV              ; F0 = 1 / (1 + exp(-x))

; Result in F0 (R2:R3)
```

### **6.3 Power Function using FEXP/FLOG**
```assembly
; Compute: y = a^b (a to the power b)

; Input: a, b in memory

; Load a into F0
LD  R2, [a_high]
LD  R3, [a_low]

; Compute log(a)
FLOG              ; F0 = log(a)

; Save log(a)
ST  R2, [log_a_high]
ST  R3, [log_a_low]

; Load b into F0
LD  R2, [b_high]
LD  R3, [b_low]

; Load log(a) into F1
LD  R4, [log_a_high]
LD  R5, [log_a_low]

; Multiply: b × log(a)
FMUL              ; F0 = b × log(a)

; Compute exp(b × log(a))
FEXP              ; F0 = exp(b × log(a)) = a^b

; Result in F0 (R2:R3)
```

### **6.4 Conditional Execution**
```assembly
; If (x > threshold) then y = sqrt(x) else y = 0

; Load x into F0, threshold into F1
LD  R2, [x_high]
LD  R3, [x_low]
LD  R4, [thresh_high]
LD  R5, [thresh_low]

; Compare x and threshold
FCMP              ; Sets flags based on x - threshold
JN  x_le_thresh   ; Jump if x <= threshold (x < threshold)

; x > threshold: compute sqrt(x)
; x already in F0
FSQRT             ; F0 = sqrt(x)
JMP done
NOP

x_le_thresh:
; x <= threshold: set y = 0
LDI 0
MOV R2, R0        ; F0 high = 0
MOV R3, R0        ; F0 low = 0

done:
; Result in F0 (R2:R3)
```

### **6.5 Efficient Constant Generation**
```assembly
; Common constants generation macros

.macro LOAD_ONE
    LDI 0x3F80     ; 1.0 high
    MOV R2, R0     ; F0 high
    LDI 0x0000     ; 1.0 low
    MOV R3, R0     ; F0 low
.endm

.macro LOAD_PI
    ; π = 3.1415926535 = 0x40490FDB
    LDI 0x4049     ; π high
    MOV R2, R0     ; F0 high
    LDI 0x0FDB     ; π low
    MOV R3, R0     ; F0 low
.endm

.macro LOAD_E
    ; e = 2.718281828 = 0x402DF854
    LDI 0x402D     ; e high
    MOV R2, R0     ; F0 high
    LDI 0xF854     ; e low
    MOV R3, R0     ; F0 low
.endm
```

---

## **7. Math Software Library**

### **7.1 Extended Functions (Built using FEXP/FLOG)**

**Available at software library address 0xF9000:**
```c
// Power functions
float pow(float x, float y);     // x^y via exp(y×log(x))
float exp2(float x);             // 2^x via exp(x×log(2))
float exp10(float x);            // 10^x via exp(x×log(10))

// Logarithm functions
float log10(float x);            // log10(x) = log(x)/log(10)
float log2(float x);             // log2(x) = log(x)/log(2)

// Trigonometric functions (Taylor series approximations)
float sin(float x);
float cos(float x);
float tan(float x);
float asin(float x);
float acos(float x);
float atan(float x);

// Hyperbolic functions
float sinh(float x);             // (exp(x) - exp(-x))/2
float cosh(float x);             // (exp(x) + exp(-x))/2
float tanh(float x);             // sinh(x)/cosh(x)

// Special functions
float hypot(float x, float y);   // √(x² + y²)
float fmod(float x, float y);    // Floating-point remainder
```

### **7.2 Example Library Implementation**
```assembly
; Library: pow(x, y) = exp(y × log(x))
; Input: x in F0, y in F1
; Output: result in F0

pow_function:
    ; Save y to memory
    ST  R4, [temp_y_high]
    ST  R5, [temp_y_low]
    
    ; Compute log(x)
    FLOG              ; F0 = log(x)
    
    ; Load y into F1
    LD  R4, [temp_y_high]
    LD  R5, [temp_y_low]
    
    ; Multiply: y × log(x)
    FMUL              ; F0 = y × log(x)
    
    ; Compute exp(y × log(x))
    FEXP              ; F0 = exp(y × log(x)) = x^y
    
    RET
```

### **7.3 Library Calling Convention**
```assembly
; Call sin(x) library function
; 1. Push argument to FPU registers
; 2. Call via SWI with function code

; Load x into F0
LD  R2, [x_high]
LD  R3, [x_low]

; Call library
LDI SIN_FUNC_ID     ; Function code for sin()
SWI                 ; Software interrupt

; Result in F0 (R2:R3)
```

---

## **8. Performance Optimization Tips**

### **8.1 Minimize FPU-CPU Transfers**
```
BAD: Load to CPU reg, move to FP reg, compute, move back
GOOD: Keep values in FP registers (R2-R5) as long as possible
```

### **8.2 Use R0 Efficiently for Constants**
```assembly
; Generate constant once, reuse
LDI  0x3F80      ; 1.0 high
MOV  R6, R0      ; Save in R6 for reuse
LDI  0x0000      ; 1.0 low
MOV  R7, R0      ; Save in R7

; Later, load to F0:
MOV R2, R6       ; F0 high = 1.0
MOV R3, R7       ; F0 low = 1.0
```

### **8.3 Batch FPU Operations**
```assembly
; Group FPU operations to minimize
; trap handler overhead in software emulation

; Instead of:
; FADD, LD, ST, FMUL, LD, ST

; Do:
; LD, LD, FADD, FMUL, ST, ST
```

### **8.4 Future Hardware Planning**
```
Same code will run faster when hardware FPU
is added - no changes needed!
```

---

## **9. Common Issues and Solutions**

### **9.1 Register Conflict**
```
FPU uses fixed registers R2-R5:
- Don't use R2-R5 for other purposes during FP sequences
- Save/Restore R2-R5 if calling functions during FP computation
```

### **9.2 NaN and Infinity Handling**
```
Operations producing NaN or Infinity:
- Division by zero
- Square root of negative number  
- Invalid operations
Check status via FCMP or examine result bits.
```

### **9.3 Precision Issues**
```
Single precision: ~7 decimal digits
Accumulate errors in long computations
Consider using double in software for critical parts
```

### **9.4 Workarounds for Missing Operations**

**Subtraction:**
```assembly
; a - b
; Load a to F0, b to F1
XOR R4, 0x8000    ; Negate b in F1
FADD              ; F0 = a + (-b) = a - b
```

**Absolute Value:**
```assembly
; |x|
; Load x to F0
AND R2, 0x7FFF    ; Clear sign bit
```

**Multiplication by Constant:**
```assembly
; x × 2.5
; Load x to F0
; Load 2.5 to F1
FMUL              ; F0 = x × 2.5
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
Estimated gate count: ~30,000 gates (28nm)
Operations: Same 7 instructions
Registers: Fixed mapping to R2-R5
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
; (trap handler executes software emulation)

.hw_fpu_available:
; Hardware executes directly
```

---

## **11. Instruction Quick Reference**

### **11.1 Opcode Map**
```
Instruction        Binary Encoding          Operation
─────────────────────────────────────────────────────────────
FADD          11111111111110 00    F0 = F0 + F1
FMUL          11111111111110 01    F0 = F0 × F1
FDIV          11111111111110 10    F0 = F0 ÷ F1
FSQRT         11111111111110 11    F0 = √F0

FEXP          111111111111110 0    F0 = exp(F0)
FLOG          111111111111110 1    F0 = log(F0)

FCMP          1111111111111110     Compare F0 and F1
```

### **11.2 Register Mapping**
```
Always:
  F0 = R2:R3
  F1 = R4:R5
```

### **11.3 Common Sequences**
```
Addition:        Load a→F0, b→F1, FADD
Subtraction:     Load a→F0, b→F1, XOR R4,0x8000, FADD
Multiplication:  Load a→F0, b→F1, FMUL
Division:        Load a→F0, b→F1, FDIV
Square root:     Load x→F0, FSQRT
Exponential:     Load x→F0, FEXP
Logarithm:       Load x→F0, FLOG
Comparison:      Load a→F0, b→F1, FCMP, branch on flags
```

---

## **12. Educational Exercises**

### **12.1 Implement Software FPU**
```
1. Write IEEE 754 single-precision format handlers
2. Implement FADD/FMUL software algorithms
3. Add FDIV using Newton-Raphson iteration
4. Implement FSQRT using Babylonian method
5. Add FEXP using Taylor series approximation
6. Implement FLOG using similar approximations
7. Test all special values (NaN, Inf, denormals)
```

### **12.2 Math Function Implementation**
```
1. Implement pow() using FEXP and FLOG
2. Create sin() using Taylor series
3. Build math library with common functions
4. Compare precision with reference implementations
5. Optimize critical functions
```

### **12.3 Performance Analysis**
```
1. Profile software emulation performance
2. Identify bottlenecks for hardware acceleration
3. Design hardware FPU block diagram
4. Estimate gate count vs performance tradeoffs
5. Benchmark against software math library
```

---

## **13. Changes from Previous Version**

### **13.1 v3.0 Key Updates**
1. **Fixed register window**: F0=R2:R3, F1=R4:R5
2. **Added FEXP/FLOG**: Replaced FSUB/FABS with transcendentals
3. **Kept R0 free**: For efficient constant loading via LDI
4. **7 operation design**: FADD, FMUL, FDIV, FSQRT, FEXP, FLOG, FCMP
5. **Practical focus**: Enables advanced functions via FEXP/FLOG

### **13.2 Why These Choices?**
- **R2-R5**: General purpose, doesn't conflict with special registers
- **FEXP/FLOG**: Enable pow(), exp(), log10(), sigmoid(), etc.
- **Fixed window**: Necessary due to encoding constraints
- **R0 free**: Critical for efficient constant generation

### **13.3 Performance Impact**
- **Positive**: FEXP/FLOG enable many functions in hardware
- **Negative**: Fixed registers require careful register management
- **Neutral**: Subtraction/absolute value require extra CPU ops
- **Overall**: More powerful for mathematical computations

---

**Deep16 FPU Manual v3.0** - Fixed register window with transcendental support. This design provides powerful floating-point capability within encoding constraints, keeping R0 free for efficient programming while enabling advanced mathematical functions through FEXP and FLOG support.

*Note: All FPU instructions initially trap to software emulation. Future hardware implementation will provide direct execution.*
