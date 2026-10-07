; bench.asm - typischer Befehlsmix fuer den Core-Benchmark
;
; Eine Endlosschleife ohne HALT: scripts/bench.mjs misst, wie viele
; step()-Aufrufe pro Sekunde herauskommen. Genau ein Schritt = genau eine
; Instruktion (Delay Slots zaehlen als eigene Schritte mit), die Schrittzahl
; ist also die ausgefuehrte Befehlszahl.
;
; Mischung pro Runde (13 Schritte):
;    6x ALU  (ADD x2, SUB, XOR, AND + Zaehler-SUB)   ~46 %
;    1x Registerkopie (MOV)                           ~8 %
;    2x Speicher (LD, ST)                            ~15 %
;    2x Schieben (SL, SR)                            ~15 %
;    1x bedingter Sprung + Delay-Slot-NOP            ~15 %
;
; Der Runden-Zaehler R4 laeuft einmal alle 65536 Runden auf 0: dann ist Z
; gesetzt, JNZ faellt durch und JZ holt die Schleife zurueck (zwei
; Instruktionen mehr, ein seltener Pfad wie im echten Code). Faellt auch JZ
; durch, landet das Programm auf HLT - die Messung wuerde das merken.

.org 0x0100

start:
        LDI  0x0200            ; Datenpuffer
        MOV  R6, R0            ; R6 = Speicherzeiger
        LSI  R1, 5             ; Akku
        LSI  R2, 7             ; zweiter Operand
        LSI  R3, 0             ; Laufzaehler fuer das XOR-Muster
        LSI  R4, 15            ; Runden-Zaehler

loop:
        ADD  R1, R2            ; ALU: addieren
        SUB  R3, 1             ; ALU: subtrahieren
        MOV  R5, R1            ; Registerkopie
        XOR  R5, R3            ; ALU: logisch
        LD   R7, R6, 0         ; Speicher lesen
        ADD  R7, R5            ; ALU
        ST   R7, R6, 0         ; Speicher schreiben
        SL   R7, 1             ; schieben
        SR   R7, 1             ; ... und zurueck
        AND  R7, R1            ; ALU: UND (nur Registerform)
        SUB  R4, 1             ; Runden-Zaehler, setzt die Flags
        JNZ  loop              ; meistens: weiterlaufen
        NOP                    ; Delay Slot
        JZ   loop              ; nur nach Zaehler-Ueberlauf: zurueck
        NOP                    ; Delay Slot
