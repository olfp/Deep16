# Mermaid-Test: Das PSW

> Testdatei für die Illustrationen des Buches **»Deep16 für 6502-Programmierer«**.
>
> Das Diagramm nutzt `block-beta` mit unbenannten Blöcken — das rendert in allen
> gängigen Werkzeugen (GitHub, VS Code, Typora, mermaid.ink) identisch.
> Die Feldbeschreibungen sind **direkt ins Diagramm integriert**: von jedem Feld
> führt eine Linie nach unten und rechts zur zugehörigen Beschreibung am rechten
> Rand — die klassische ASCII-»Leiter« aus den Prozessor-Handbüchern.

## Das Processor Status Word (PSW)

Das PSW ist das 16-Bit-Statusregister der Deep16. Die unteren Bits (`N Z V C I`)
sind dem 6502-Programmierer sofort vertraut. Die oberen Bits (`SR DS ER DE`)
steuern die Segment-Mechanik — auf der 6502 gibt es so etwas nicht, genau das
macht Kapitel 2 des Buches spannend.

```mermaid
block-beta
  columns 20
  DE["DE<br/>15"]:1
  ER["ER[3:0]<br/>14..11"]:4
  DSE["DS<br/>10"]:1
  SR["SR[3:0]<br/>9..6"]:4
  SB["S<br/>5"]:1
  IB["I<br/>4"]:1
  CB["C<br/>3"]:1
  VB["V<br/>2"]:1
  ZB["Z<br/>1"]:1
  NB["N<br/>0"]:1
  space:4
  space:16
  DN0["&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;0: Negative (1=negativ)"]:4
  space:16
  DN1["&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;1: Zero (1=null)"]:4
  space:16
  DN2["&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2: Overflow (1=Überlauf)"]:4
  space:16
  DN3["&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;3: Carry (1=Übertrag)"]:4
  space:16
  DN4["&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;4: Interrupt Enable (1=frei)"]:4
  space:16
  DN5["&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;5: Shadow View (1=aktiv)"]:4
  space:16
  DN6["&nbsp;&nbsp;&nbsp;6-9: SR[3:0] Stack-Register-Auswahl"]:4
  space:16
  DN7["10: Dual Stack (1=SS als Registerpaar)"]:4
  space:16
  DN8["&nbsp;11-14: ER[3:0] Extra-Register-Auswahl"]:4
  space:16
  DN9["15: Dual Extra (1=ES als Registerpaar)"]:4
  NB --> DN0
  ZB --> DN1
  VB --> DN2
  CB --> DN3
  IB --> DN4
  SB --> DN5
  SR --> DN6
  DSE --> DN7
  ER --> DN8
  DE --> DN9
  classDef seg fill:#dbeafe,stroke:#1d4ed8
  classDef ctl fill:#fef3c7,stroke:#b45309
  classDef flg fill:#dcfce7,stroke:#15803d
  class DE,ER,DSE,SR seg
  class SB,IB ctl
  class CB,VB,ZB,NB flg
  classDef desc fill:#ffffff,stroke:#94a3b8,font-family:monospace,font-size:16px,text-align:right
  class DN0,DN1,DN2,DN3,DN4,DN5,DN6,DN7,DN8,DN9 desc
```

> **Farben:** <span style="color:#1d4ed8">blau</span> = Segment-/Kontext-Mechanik,
> <span style="color:#b45309">gelb</span> = Interrupt-Steuerung,
> <span style="color:#15803d">grün</span> = Arithmetik-Flags.
> Die Beschreibungsspalte rechts ist bewusst neutral gehalten (weiß/grau) und
> alle Textzeilen enden bündig am rechten Rand — wie in der ASCII-Vorlage.

### Bedeutung der Bits

| Bit(s) | Name | Bedeutung | Vergleich zur 6502 |
|--------|------|-----------|--------------------|
| 0 | `N` | Negative Flag (1 = Ergebnis negativ) | ≙ N |
| 1 | `Z` | Zero Flag (1 = Ergebnis null) | ≙ Z |
| 2 | `V` | Overflow Flag (1 = vorzeichenbehafteter Überlauf) | ≙ V |
| 3 | `C` | Carry Flag (1 = Übertrag/Borrow) | ≙ C |
| 4 | `I` | Interrupt Enable (1 = Interrupts frei) | ≙ I, aber per `SETI`/`CLRI` |
| 5 | `S` | **Shadow View** (1 = Shadow-Kontext aktiv) | **neu!** Kern der Interrupt-Mechanik |
| 6–9 | `SR[3:0]` | Stack-Register-Auswahl (0–15) | **neu!** SS ist frei wählbar |
| 10 | `DS` | Dual Stack (1 = SS via Registerpaar) | **neu!** |
| 11–14 | `ER[3:0]` | Extra-Register-Auswahl (0–15) | **neu!** ES ist frei wählbar |
| 15 | `DE` | Dual Extra (1 = ES via Registerpaar) | **neu!** |

**Reset-Zustand:** `0x0020` → nur Bit 5 (`S`=1) gesetzt, Interrupts gesperrt.
Weitere Hinweise für 6502-Umsteiger: Es gibt **kein** Dezimal-Flag (`D`) und
kein Break-Flag (`B`) — dezimale Arithmetik kennt die Deep16 nicht; Interrupts
werden über `I` maskiert und über `S` kontextgetrennt (Kapitel 5).