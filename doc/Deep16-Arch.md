# Deep16 (深十六) Architecture Specification
## 16-bit RISC Processor with Enhanced Memory Addressing

---

## 1. Processor Overview

### 1.1 Architectural Philosophy
Deep16 is a 16-bit RISC processor designed with a balanced approach to simplicity, performance, and educational value. The architecture embraces classic RISC principles while introducing innovative features for practical embedded systems use.

### 1.2 Key Architectural Features
- **16-bit fixed-length instructions** - Simplified decoding and alignment
- **16 general-purpose registers** - Reduced memory traffic
- **Segmented memory addressing** - 20-bit physical address space (1MB)
- **Complete shadow register system** - Zero-overhead interrupt context switching
- **5-stage pipelined implementation** - With delayed branch optimization
- **Unified L1 cache option** - Configurable 4KB direct-mapped cache
- **Memory-mapped I/O** - Simplified peripheral access
- **Word-based memory system** - No byte alignment complications

### 1.3 Performance Targets
- **Base CPI**: 1.0-1.3 (ideal to realistic)
- **Operating frequency**: 80MHz in modern FPGAs
- **Branch penalty**: 0 cycles (delayed branch architecture)
- **Cache hit rate**: 85-95% with 4KB unified cache
- **Memory bandwidth**: 160 MB/s at 80MHz

---

## 2. Microarchitecture

### 2.1 Pipeline Structure

#### 2.1.1 5-Stage Pipeline
```
Stage    Purpose                    Key Operations
-----    -----------------------   ------------------------------------
IF       Instruction Fetch         - Read instruction from cache/memory
                                    - Increment PC
                                    - Handle branch prediction

ID       Instruction Decode        - Decode instruction
                                    - Read register file  
                                    - Resolve hazards
                                    - Calculate branch targets

EX       Execute                   - ALU operations
                                    - Address calculation
                                    - Branch condition evaluation
                                    - Shift/rotate operations

MEM      Memory Access             - Data cache access
                                    - Segment register access  
                                    - I/O operations
                                    - Cache miss handling

WB       Write Back                - Write results to register file
                                    - Update pipeline state
```

#### 2.1.2 Pipeline Register Structure
Each pipeline stage is separated by registers containing:
- **Instruction word** and associated metadata
- **Register values** and intermediate results
- **Control signals** for subsequent stages
- **Exception and interrupt** state information

### 2.2 Hazard Handling

#### 2.2.1 Data Hazards
**Types of Data Hazards:**
1. **RAW (Read After Write)** - Most common, handled by forwarding
2. **WAR (Write After Read)** - Eliminated by in-order execution
3. **WAW (Write After Write)** - Eliminated by in-order execution

**Forwarding Paths:**
- **EX/MEM → EX**: ALU results available immediately
- **MEM/WB → EX**: Memory load results with 1-cycle latency
- **Architectural Move**: Bypasses forwarding for stable state access

#### 2.2.2 Control Hazards
**Delayed Branch Solution:**
- **One delay slot** following every branch/jump
- **Compiler responsibility** to schedule useful instructions
- **Zero cycle penalty** for correctly scheduled branches

**Branch Resolution:**
- **Conditional branches**: Resolved in EX stage
- **Register jumps**: Resolved in ID stage  
- **Far jumps (JML)**: Require pipeline flush

### 2.3 Memory Hierarchy

#### 2.3.1 Cache Architecture (Optional)

**Unified L1 Cache Features:**
- **Size**: 4KB configurable implementation
- **Organization**: Direct-mapped
- **Line size**: 16 bytes (8 instructions or 4 data words)
- **Write policy**: Write-through with write buffer
- **Allocation policy**: Read-allocate

**Cache Tag Structure:**
```
+----------------+--------+-----+
| Tag (15 bits)  | Index (8 bits) | Offset (1 bit) |
+----------------+--------+-----+
```
- **Total address**: 20 bits (1MB physical)
- **Index**: 8 bits (256 cache lines)
- **Offset**: 1 bit (selecting word in 16-byte line)
- **Tag**: 15 bits (remaining address bits)

**Cache Control Registers:**
- **Cache Enable (CE)**: Global cache enable/disable
- **Cache Flush (CF)**: Invalidate all cache lines
- **Cache Lock (CL)**: Lock critical code/data in cache

#### 2.3.2 Memory Access Timing

**Cache Hit:**
- **Instruction fetch**: 1 cycle (IF stage)
- **Data access**: 1 cycle (MEM stage)

**Cache Miss:**
- **Instruction miss**: 3-5 cycle penalty (block load)
- **Data miss**: 3-5 cycle penalty (block load)
- **Write buffer**: 1-entry buffer hides write latency

**No-Cache Operation:**
- **Memory read**: 2-3 cycles (assuming fast SRAM)
- **Memory write**: 1 cycle (with ready signal)

### 2.4 Execution Units

#### 2.4.1 ALU Design
**16-bit Arithmetic Unit:**
- **Operations**: ADD, SUB, CMP with full flag generation
- **Flag logic**: N, Z, V, C with precise exception handling
- **Forwarding**: Results available in same cycle

**Logical Unit:**
- **Bitwise operations**: AND, OR, XOR
- **Test operations**: TBC, TBS (flag-only variants)
- **Single-operand**: INV, NEG, SWB

#### 2.4.2 Shift/Rotate Unit
**Barrel Shifter Design:**
- **Single-cycle** shifts/rotates of 0-15 positions
- **Comprehensive support**: Logical, arithmetic, rotate with/without carry
- **Multi-word capability**: Through carry propagation

#### 2.4.3 Multiply/Divide Unit
**Iterative Design:**
- **MUL**: 8-16 cycles (early termination for small operands)
- **MUL32**: 16 cycles for full 32-bit result
- **DIV**: 16-32 cycles (early termination)
- **Pipelined**: Can proceed concurrently with other operations

---

## 3. Memory System Architecture

### 3.1 Segmented Addressing

#### 3.1.1 Address Generation
**Physical Address Calculation:**
```
Physical Address = (Segment Base << 4) + Effective Address
```

**Segment Register Usage:**
- **CS**: Always used for instruction fetch
- **DS**: Default for data access (LD/ST instructions)
- **SS**: Used when PSW.SR points to stack operations
- **ES**: Used for explicit access or PSW.ER configuration

#### 3.1.2 Implicit Segment Selection
The PSW controls which segment register is used for data accesses:

**Stack Segment Selection (PSW.SR):**
```
PSW.SR = 13, PSW.DS = 0  → SP accesses SS
PSW.SR = 12, PSW.DS = 1  → FP/SP pair accesses SS
```

**Extra Segment Selection (PSW.ER):**
```
PSW.ER = 11, PSW.DE = 0  → R11 accesses ES  
PSW.ER = 10, PSW.DE = 1  → R10/R11 pair accesses ES
```

### 3.2 Cache Implementation Details

#### 3.2.1 Cache Organization

**4KB Unified Cache Structure:**
```
+-------------------------+---------------+----------+
| Tag RAM (256×15 bits)   | Data RAM (256×64 bits) | Valid Bits |
+-------------------------+---------------+----------+
```

**Cache Line Format:**
```
+----------+----------+----------+----------+----------+----------+----------+----------+
| Word 0   | Word 1   | Word 2   | Word 3   | Word 4   | Word 5   | Word 6   | Word 7   |
+----------+----------+----------+----------+----------+----------+----------+----------+
```

#### 3.2.2 Cache Operation

**Read Hit:**
1. Address broken into tag, index, offset
2. Tag comparison with valid bit check
3. Data word selected based on offset
4. Result available in 1 cycle

**Read Miss:**
1. Cache line invalidated (if dirty in write-back mode)
2. Main memory read of entire 16-byte line
3. Cache line updated with new data
4. Requested word forwarded to processor
5. Total penalty: 3-5 cycles

**Write Operation (Write-Through):**
1. Data written to cache (if hit)
2. Simultaneous write to write buffer
3. Write buffer handles main memory update
4. Processor continues immediately

#### 3.2.3 Cache Performance Analysis

**Expected Hit Rates:**
- **Instruction cache**: 90-98% (spatial locality)
- **Data cache**: 80-95% (temporal locality)
- **Unified cache**: 85-96% (balanced workload)

**Performance Impact:**
- **Best case** (95% hit rate): Effective CPI ≈ 1.05
- **Worst case** (no cache): Effective CPI ≈ 1.8-2.2
- **Typical case** (90% hit rate): Effective CPI ≈ 1.15

### 3.3 Memory Protection

#### 3.3.1 Simplified Protection Model
Deep16 employs a simple protection scheme:

**Segment-based Protection:**
- **Code Segment (CS)**: Execute-only
- **Data Segments (DS/SS/ES)**: Read/Write
- **No user/supervisor mode** - Single privilege level
- **No page protection** - Keep it simple philosophy

**Boot ROM Protection:**
- **Write protection** for addresses 0xFFFF0-0xFFFFF
- **Reset vector integrity** guaranteed

---

## 4. Interrupt System Architecture

### 4.1 Complete Shadow Register System

#### 4.1.1 Shadow Register Set
```
Normal Registers    Shadow Registers    Purpose
---------------    ----------------    -------
CS                 CS'                 Code Segment
DS                 DS'                 Data Segment  
SS                 SS'                 Stack Segment
ES                 ES'                 Extra Segment
PC                 PC'                 Program Counter
PSW                PSW'                Processor Status Word
```

#### 4.1.2 Context Switching Mechanism

**Interrupt Entry Sequence:**
1. **Complete state save** to shadow registers (hardware automatic)
2. **PSW modification**: PSW.S=1, PSW.I=0 (enter interrupt context)
3. **Segment setup**: CS=0 (interrupts run in segment 0)
4. **Vector fetch**: PC = memory[interrupt_vector]
5. **Pipeline flush** and restart

**Interrupt Exit Sequence:**
1. **RETI instruction** execution
2. **Context restore**: PSW.S=0 (switch to normal view)
3. **Pipeline flush** and restart from saved PC
4. **No data movement** - pure view switching

### 4.2 Interrupt Handling

#### 4.2.1 Vector Table
**Fixed Locations in Segment 0:**
```
0x0000: RESET_VECTOR    (Cold start and warm reset)
0x0001: HW_INT_VECTOR   (Hardware interrupts)
0x0002: SWI_VECTOR      (Software interrupts)
```

#### 4.2.2 Priority and Masking
**Fixed Priority:**
1. **Reset** (highest priority)
2. **Hardware Interrupts**
3. **Software Interrupts** (lowest priority)

**Interrupt Control:**
- **Global enable/disable**: PSW.I bit
- **Individual masking**: Through interrupt controller
- **Nesting**: Not supported (keep it simple)

### 4.3 SMV Instruction Architecture

#### 4.3.1 Symmetric Access
**Normal Mode (PSW.S=0):**
```assembly
SMV R0, ACS      ; R0 = CS' (read shadow CS)
SMV APC          ; PC' = R0 (write shadow PC)
```

**Interrupt Mode (PSW.S=1):**
```assembly
SMV R0, ACS      ; R0 = CS (read normal CS)  
SMV APC          ; PC = R0 (write normal PC)
```

#### 4.3.2 Use Cases
**Debugging:**
- Inspect interrupted context from normal mode
- Examine normal context from interrupt mode

**Context Manipulation:**
- Modify return address before RETI
- Adjust saved processor state

---

## 5. I/O System Architecture

### 5.1 Memory-Mapped I/O

#### 5.1.1 I/O Address Space
**I/O Segment (0xF0000-0xFFFFF):**
```
0xF0000-0xF000F: System LED Controller
0xF0010-0xF001F: Interrupt Controller (SIC)
0xF0020-0xF002F: Timer/Counter
0xF0030-0xF003F: Video Display Controller  
0xF0040-0xF004F: Serial Port (UART)
0xF0060-0xF006F: Keyboard Controller
0xF1000-0xF17CF: Screen Buffer (80×25 characters)
```

#### 5.1.2 I/O Access Characteristics
- **Word-based access** only (no byte I/O)
- **No cacheing** of I/O addresses (uncacheable region)
- **Wait states** possible for slow peripherals
- **Interrupt-driven** operation recommended

### 5.2 Peripheral Integration

#### 5.2.1 Standard Peripheral Set
**Essential Peripherals:**
- **Timer/Counter**: System timing and event counting
- **UART**: Serial communication
- **Keyboard Controller**: PS/2 keyboard input
- **Video Controller**: Text and basic graphics
- **Interrupt Controller**: Centralized interrupt management

#### 5.2.2 Custom Peripheral Support
**Extension Mechanism:**
- **Reserved address ranges** for custom peripherals
- **Standard interrupt assignment** for new devices
- **Plug-and-play** address decoding

---

## 6. Implementation Considerations

### 6.1 FPGA Implementation

#### 6.1.1 Resource Requirements
**Minimum FPGA Requirements:**
- **Logic elements**: ~2,000-3,000 LEs
- **Block RAM**: 8-12 M9K blocks (with cache)
- **Clock frequency**: 80 MHz achievable
- **I/O pins**: 36+ (address, data, control)

**Optimization Options:**
- **Cache size**: Configurable from 0-8KB
- **Multiplier**: Use FPGA DSP blocks
- **Memory interface**: Customizable width and timing

#### 6.1.2 Performance Scaling
**Frequency vs. Area Trade-offs:**
- **Minimum configuration**: 50 MHz, ~1,500 LEs
- **Balanced configuration**: 80 MHz, ~2,500 LEs  
- **High performance**: 100+ MHz, ~4,000 LEs (with deep pipeline)

### 6.2 ASIC Implementation

#### 6.2.1 Standard Cell Implementation
**Estimated Characteristics:**
- **Process**: 130nm or newer
- **Area**: 0.5-1.0 mm² (with cache)
- **Frequency**: 200-400 MHz
- **Power**: 10-50 mW (typical operation)

#### 6.2.2 Customization Options
**Application-Specific Variants:**
- **Embedded version**: Small cache, minimal peripherals
- **Performance version**: Larger cache, deep pipeline
- **Low-power version**: Clock gating, power management

### 6.3 Verification Strategy

#### 6.3.1 Testing Methodology
**Comprehensive Test Suite:**
- **Instruction set verification**: Each instruction tested
- **Pipeline hazards**: All forwarding scenarios
- **Interrupt handling**: Complete context switch testing
- **Cache functionality**: Hit/miss scenarios

**Formal Verification:**
- **Property checking**: Critical control paths
- **Equivalence checking**: Pipeline stage integrity
- **Timing verification**: Setup/hold constraints

---

## 7. Performance Analysis

### 7.1 Benchmark Performance

#### 7.1.1 Dhrystone Performance
**Expected Performance:**
- **Without cache**: 0.5-0.8 DMIPS/MHz
- **With 4KB cache**: 0.9-1.2 DMIPS/MHz
- **At 80MHz**: ~80 DMIPS (with cache)

**Comparison Points:**
- **Similar to**: Early ARM7TDMI performance
- **Better than**: 8-bit microcontrollers
- **Educational target**: Understandable yet practical

#### 7.1.2 Memory Performance
**Cache Effectiveness:**
```
Workload Type        | Hit Rate | Performance Gain
---------------------|----------|-----------------
Integer benchmarks   | 90-95%   | 2.0-2.5×
Control code         | 85-90%   | 1.8-2.2×
Numerical algorithms | 80-85%   | 1.5-1.8×
I/O intensive        | 70-80%   | 1.3-1.6×
```

### 7.2 Power Analysis

#### 7.2.1 Power Consumption Estimates
**FPGA Implementation:**
- **Static power**: 10-20 mW
- **Dynamic power**: 30-80 mW (at 80MHz)
- **Total power**: 40-100 mW

**ASIC Implementation (130nm):**
- **Static power**: 1-2 mW
- **Dynamic power**: 5-20 mW (at 200MHz)
- **Total power**: 6-22 mW

#### 7.2.2 Power Management
**Available Features:**
- **Clock gating**: Idle pipeline stages
- **Sleep mode**: HLT instruction stops clock
- **Peripheral power control**: Individual device shutdown

---

## 8. Cache Implementation Details

### 8.1 Unified L1 Cache Architecture

#### 8.1.1 Cache Controller Design

**Finite State Machine:**
```
States:
- IDLE: Ready for access
- TAG_CHECK: Comparing address tags
- READ_MISS: Handling cache miss
- WRITE_THROUGH: Writing to memory
- REFILL: Loading cache line
```

**Critical Control Signals:**
- **cache_hit**: Tag match and valid bit set
- **cache_miss**: Required data not in cache
- **refill_complete**: Cache line loaded
- **write_complete**: Write buffer empty

#### 8.1.2 Cache Coherence

**Simplified Coherence Protocol:**
- **No multiprocessor support** (single core)
- **I/O coherence**: Uncached I/O region
- **Self-modifying code**: Explicit cache flush required
- **Write-through**: Always consistent with main memory

### 8.2 Performance Optimization

#### 8.2.1 Critical Word First
**Refill Optimization:**
- **Requested word** loaded first during cache miss
- **Processor restart** after critical word available
- **Background loading** of remaining line words

#### 8.2.2 Write Buffer
**Single-entry Write Buffer:**
- **Hides write latency** to main memory
- **Maintains write order** for consistency
- **Simple implementation** with minimal hardware

### 8.3 Configuration Options

#### 8.3.1 Cache Size Variants
**Supported Configurations:**
- **No cache**: Simplest implementation
- **2KB cache**: Balanced size/performance
- **4KB cache**: Recommended configuration
- **8KB cache**: Maximum practical size

#### 8.3.2 Implementation Selection
**Cache Presence Detection:**
- **Hardware configuration** at synthesis time
- **No runtime detection** - fixed architecture
- **Software transparent** - same instruction set

---

## 9. Extension Architecture

### 9.1 Custom Instruction Support

#### 9.1.1 Extension Mechanism
**Reserved Opcode Space:**
- **1111111111111XXX**: Reserved for custom instructions
- **Custom function units**: Can be added to EX stage
- **Register file access**: Through existing ports

#### 9.1.2 Implementation Guidelines
**Custom Unit Integration:**
- **Timing constraints**: Must meet EX stage timing
- **Resource sharing**: Can use existing ALU infrastructure
- **Exception handling**: Must not disrupt pipeline

### 9.2 Coprocessor Interface

#### 9.2.1 Coprocessor Architecture
**Attachment Points:**
- **EX stage**: For computational coprocessors
- **MEM stage**: For memory management units
- **Custom interface**: For specialized accelerators

#### 9.2.2 Communication Protocol
**Register-based Communication:**
- **Coprocessor registers**: Mapped to main register file
- **Control/status**: Through special move instructions
- **Data transfer**: Through memory or register ports

---

*Deep16 Architecture Specification v2.0 - Complete microarchitecture description including optional cache implementation*

**Architectural Evolution:**
- ✅ **Base RISC pipeline** with proven 5-stage design
- ✅ **Innovative shadow register** system for zero-overhead interrupts
- ✅ **Optional unified cache** for performance scaling
- ✅ **Balanced complexity** for educational and practical use
- ✅ **FPGA and ASIC** implementation paths
- ✅ **Clear extension path** for custom applications

This architecture represents a careful balance between educational clarity and practical performance, making it suitable for both learning computer architecture and building real embedded systems.
