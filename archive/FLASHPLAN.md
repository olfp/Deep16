# DeepForth Blocks auf dem Tang Nano 9K — Design

> **Stand: Entwurf. Kein Code.** Entscheidungen des Autors:
> Medium = **Config-SPI-Flash über MSPI**, Semantik = **Sektor-Blocks
> (2048 Zellen) mit `UPDATE`/`FLUSH`**, Vorgehen = **nur Plan/Design**.
>
> **2026-10-12 — Blockgeometrie überarbeitet.** Statt eines klassischen
> 1-KB-Blocks (16×64) ist ein **Block = ein 4-KB-Flash-Sektor = 2048 Zellen**,
> mit einem **80×24-Textfenster (1920 Zeichen)** und **128 Zellen Blockkopf**.
> Begründung in §3 und §4.
>
> Dieses Dokument ist die Diskussionsgrundlage, kein Implementierungsauftrag.

---

## 1. Board-Fakten (belegt)

Aus der Sipeed-Wiki (Tang Nano 9K, GW1NR-LV9QN88PC6/I5):

| Ressource | Wert | Rolle für Blocks |
|---|---|---|
| SPI-Flash (extern, Config) | **32 Mbit = 4 MB** | gewähltes Medium; hält aber das Bitstream |
| User-Flash (on-die) | 608 Kbit ≈ 76 KB | nicht gewählt (nur Gowin-Primitive) |
| PSRAM (on-die) | 64 Mbit = 8 MB | Hauptspeicher (siehe `PLANPSRAM.md`), flüchtig |
| TF/microSD-Slot | vorhanden | Rückfallebene, eigene Pins |
| BSRAM | 468 Kbit / 26 Blöcke | Sektorpuffer des Controllers |
| Header | 2×24P, HDMI-IOs mit Pull-ups | kaum freie IO |

Der Config-Flash ist **derselbe**, aus dem die FPGA konfiguriert. Er ist über den
**MSPI-Modus** nach der Konfiguration für die User-Logik zugänglich. Genaues
Primitiv, Pin-Modus (single-/dual-purpose) und Adresszählung **müssen gegen
DS117 / IPUG279 geprüft werden** — auf dieser Maschine gibt es keine
Gowin-Toolchain.

---

## 2. Die harte Randbedingung: Bitstream nicht anfassen

- Das Bitstream liegt ab Flash-Adresse 0. **Ein Erase dort macht das Board
  unbootbar** (JTAG-Programmer nötig).
- Deshalb: **Region reservieren.** Größe = Länge der `.fs`/`.bin`, aufgerundet auf
  ein 64-KB-Vielfaches, plus eine Sicherheitslücke (eine 64-KB-Blockgrenze).
- **Zwei Wächter**, nicht einer:
  1. in Forth: jede Blocknummer wird gegen `[0, N)` geprüft (Fehlerpfad statt
     stiller Schreibvorgang),
  2. im RTL: Adresskomparator, der Erase/Program unterhalb `REGION_START`
     verweigert.
- Auf dem echten Board erst nach Board-Bring-up scharf schalten; im Simulator
  zeigt der Wächter nur den Fehlerpfad.

Zahlenbeispiel (Bitstream konservativ 1 MB reserviert, **nachzumessen**):

```
Flash          4 MB   = 4.194.304 Byte
reserviert    1 MB (Bitstream + Lücke, auf 64 KB gerundet)
Region        3 MB   = 3.145.728 Byte
Sektor        4 KB   = 2048 Zellen  ->  768 Blöcke/Sektoren (Nr. 0..767)
Block         1 Sektor -> 80x24-Bildschirm (1920) + 128 Zellen Kopf
```

Ein Block **ist** ein Sektor: eine Nummer für beides. Adresse
`flash = REGION_START + (block << 12)`.

---

## 3. Blockgeometrie: Sektor als Block, 80×24 als Textfenster

Deep16 hat **keinen Byte-Zugriff** — `LD`/`ST` sind Wortoperationen, und der
Forth-Kernel legt Text **ein Zeichen pro Zelle** ab (`tib_kbd`, `TIB_LIMIT=86`
Wörter für 86 Zeichen). Damit ist „1 KB Block" zweideutig, und die klassische
Forth-Definition (1024 Bytes, 16×64) passt nur halb zur Maschine.

**Entscheidung (2026-10-12):**

| Größe | Wert | Rechnung |
|---|---|---|
| Block = Sektor | **2048 Zellen** | 2048 × 16 Bit = 4096 Byte = 1 Flash-Sektor |
| Textfenster | **1920 Zeichen** | `C/L = 80`, 24 Zeilen (der sichtbare Bildschirm) |
| Blockkopf | **128 Zellen** | Name/Flags/Reserve, 256 Byte |
| Flash je Block | **4096 Byte** | ein Block = ein Sektor, keine Verschwendung außer dem Kopf |

Warum so:

- **Zeichen pro Zelle trifft sich mit dem Sektor.** 2048 Zeichen belegen
  2048 × 16 Bit = exakt 4096 Byte, also **genau einen Löschsektor**. Kein
  Read-Modify-Erase-Write, kein Nachbarblock, keine Packerei.
- **80 Spalten passen exakt aufs Display.** Text anzeigen = Wörter kopieren
  (1920 Zellen, wie in Kapitel 8 §8.2 gemessen), keine 64→80-Umsetzung.
- **2048 = 2¹¹.** Die Adresse ist `block << 12`, weil der *Sektor* die
  Schrittweite ist; die Textgröße geht gar nicht in die Adresse ein.
- **Ein Bildschirm ist ein Block.** Kein Scrollen im Editor: der ganze Block
  ist sichtbar.

Verworfen: 2 KB **Bytes** gepackt (zwei Blöcke im Sektor ⇒ Nachbar-RMW);
`C/L = 64` mit 32×64 (schmal, obwohl es 2048 exakt auffüllt); 1 KB (belegt nur
einen halben Sektor).

---

## 4. Flash-Geometrie und Löschgranularität

SPI-NOR (GD25Q32/W25Q32-Klasse):

| Einheit | Größe | Kommando |
|---|---|---|
| Read | beliebig | `0x03` / `0x0B` |
| Page Program | 256 B | `0x02` (darf keine Page-Grenze kreuzen) |
| **Sector Erase** | **4096 B** | `0x20`, tSE ≈ 45 ms |
| Block Erase | 64 KB | `0xD8` |
| Status | — | `0x05`, Bit0 = WIP |
| JEDEC ID | — | `0x9F` |

Kernkonsequenz: **Erase vor Program**, und Flash kann nur 1→0. Weil der Block
per Konstruktion **gleich der Löscheinheit** ist, fällt das Problem weg:

- **Ein Block = ein Sektor.** Es gibt keine Nachbarn im selben Sektor.
- `FLUSH` löscht **einen** Sektor und programmiert 4 KB = 16 Pages à 256 Byte.
  **Kein Read-Modify-Erase-Write.**
- Der residente Puffer ist ein ganzer Block = 2048 Zellen = 4096 Byte.
- Der 128-Zellen-Blockkopf (Zellen 1920..2047) liegt im selben Sektor und wird
  mitgelöscht/-geschrieben; er ist kein Sonderfall.

Adresse: `flash = REGION_START + (block << 12)`.

---

## 5. MMIO-Vertrag (geräteunabhängig)

I/O-Fenster `ES=0xF000` (physisch `0xF0000`). Belegt sind `0x0060`/`0x0062`
(Tastatur) und das Bildschirmfenster ab `0x1000`. Vorschlag im freien Bereich
`0x0080+`:

| Offset | Name | R/W | Bedeutung |
|---|---|---|---|
| `0x0080` | `ST_BLK` | R/W | Block-/Sektor-Nr. (16 bit); Auto-Reset von `ST_PTR` beim Schreiben |
| `0x0082` | `ST_CMD` | W | `1`=LOAD Block→Puffer, `2`=STORE Puffer→Block, `3`=ERASE (Wipe), `4`=ID, `0`=Abbruch |
| `0x0084` | `ST_STAT` | R | b0 BUSY, b1 DIRTY, b2 ERR, b3 WEL, b4 PRESENT |
| `0x0086` | `ST_PTR` | R/W | Zellindex im Sektor `0..2047` |
| `0x0088` | `ST_DATA` | R/W | Zelle bei `ST_PTR`; Zugriff inkrementiert `ST_PTR` |

**Merke:** Nur `LDS`/`STS` dekodieren Ports — `LD`/`ST` liefern an Ports den
RAM-Füllwert `0xFFFF` (Befund aus Kapitel 6). Der Treiber muss zwingend `LDS`/`STS`
mit `ES=0xF000` benutzen.

Alternativen (später): ein **speicherabgebildetes Blockfenster** (z. B. bei
`0xF2000`) auf den Sektorpuffer — schneller, weil Forth direkt `@`/`!` nutzt,
aber ein zweites Fenster neben dem Bildschirm. Für „minimal + Dreikern-Parität"
zuerst der Wortport.

---

## 6. Gerätemodell über drei Kerne

Das ist der eigentliche Aufwand, nicht die Platine.

- **JS-Kern (goldene Referenz):** `SectorDevice`, Backing = `ArrayBuffer` (4 MB),
  Erase→`0xFF`, Page-Program, WIP als **Zyklenzähler** (`T_ERASE`/`T_PROG`
  parametrisiert), JEDEC-ID. Optional Export/Import als `.img` und Persistenz in
  `localStorage` für die IDE.
- **Rust/WASM:** identisch spiegeln (wie `lib.rs` es für den Kern tut).
- **RTL:** `deep16_flash.sv` als Zustandsautomat hinter demselben MMIO; in
  Verilator ein **behavioristisches Flash-Modell** mit denselben Parametern. Das
  echte MSPI-Primitiv nur auf Hardware.
- **Adressen und Speicherkarte** in allen drei Kernen gleich eintragen; Doku
  (`doc/Deep16-Arch.md` §8.2, `README.md`) nachziehen.
- **Determinismus:** Erase-/Programmzeiten dürfen das beobachtbare Ergebnis nicht
  ändern. Analog zu `PLANPSRAM.md` §7 ein **Latenz-/Timing-Invarianztest**:
  gleicher Programmablauf bei `T_ERASE ∈ {1, 45 ms}` ⇒ gleicher Blockinhalt.
- **`step()`-Vertrag:** Das Gerät ist **nicht blockierend**. Ein Erase von 45 ms
  wird nicht als ein Aufruf abgewickelt, sondern als Zustand, den die Firmware
  über `ST_STAT.BUSY` pollt. Sonst friert die IDE ein.

---

## 7. Forth-Schicht (minimal, klassisch)

Zustand (Variablen im Datenbereich, `0x3000`-Umgebung / `dict_free`-Bereich):

```
BLK      ( -- addr )   aktueller Block; 0 = Eingabe von der Tastatur
RES_BLK  ( -- addr )   residenter Block, -1 = keiner
DIRTY    ( -- addr )   Puffer geändert
BUF      ( -- addr )   2048-Zellen-Blockpuffer im Haupt-RAM
```

Wortschatz (Minimum):

| Wort | Wirkung |
|---|---|
| `BLOCK ( n -- addr )` | Block laden, wenn nicht resident (vorher dirty → `SAVE-BUFFERS`); gibt `BUF` zurück; setzt `BLK` **nicht** |
| `BUFFER ( n -- addr )` | wie `BLOCK`, aber ohne Lesen (Puffer ohne Load) |
| `UPDATE` | `DIRTY := true` |
| `SAVE-BUFFERS` / `FLUSH` | dirty: `BUF` → `ST_DATA` (2048 Zellen), `ST_CMD=STORE`, auf `!BUSY` warten, `DIRTY:=false` |
| `EMPTY-BUFFERS` | `RES_BLK := -1`, `DIRTY := false` (verwirft) |
| `BLK` | Variable, oben |
| `LOAD ( n -- )` | Block als Quelle interpretieren |
| `LIST ( n -- )` | Textfenster als 24 Zeilen à 80 Zeichen ausgeben (optional) |
| `WIPE ( n -- )` | Block auf Leerzeichen (optional) |

`LOAD`-Integration ist der heikle Teil: Der Interpreter läuft heute auf
`TIB`+`>IN` und holt am Ende einer Zeile über `word_accept` neu von der Tastatur.
Für Blocks gilt:

```
LOAD:  n BLOCK  ->  TIB := BUF, >IN := 0, BLK := n,
       Sprung in interpret_loop.
       Am Zeilenende (interpret_done): wenn BLK <> 0, nächste der 24 Zeilen
       (TIB += 80) und weiter; nach der letzten Zeile zurück zu BLK := 0,
       normale Prompt.
```

Das nutzt den vorhandenen Parser vollständig; die Änderung liegt nur an der
Rückkehr nach `interpret_done` und an der TIB-Quelle. `BLK = 0` schaltet sicher
auf die Tastatur zurück.

**BIOS-Block-Invariante beachten** (`STATUS.md` §3): `bios_*`-Routinen dürfen
ihre Länge nicht ändern, sonst bricht der 23-Zeilen-REPL. Neue BIOS-Aufrufe nur
mit NOP-Polsterung.

---

## 8. Phasen (Design → Simulation → Hardware)

| Phase | Inhalt | Hardware? |
|---|---|---|
| **0** | Dieses Dokument: Blockgröße, MMIO, Semantik festgelegt | nein |
| **1** | `SectorDevice` im JS-Kern + Host-Backing + Unit-Tests (Erase/Program/WIP) | nein |
| **2** | MMIO in WASM und RTL spiegeln; Paritätstests; Timing-Invarianz | nein |
| **3** | Forth `BLOCK`/`UPDATE`/`FLUSH`/`LOAD` + Guards; Round-Trip-Test | nein |
| **4** | Board-Bring-up: MSPI-Primitiv, Pin-Modus, echte Flash-Zeiten, Regionswächter scharf | **ja** |

Phasen 1–3 laufen vollständig in der IDE/Verilator und sind hier prüfbar. Phase 4
nicht.

---

## 9. Checkliste der Fallen

1. **Wortproblem:** 2048 Zellen = 2048 Zeichen = 4096 Byte (Zeichen pro Zelle);
   Textfenster 80×24 = 1920 Zeichen, 128 Zellen Kopf. Nicht „Bytes" mit „Zellen"
   verwechseln.
2. **Erase vor Program**, 4-KB-Sektor, nur 1→0; **Block = Sektor = 4096 Byte**,
   ein Block je Sektor, immer den ganzen Block schreiben (kein Nachbar-RMW).
3. **Endurance ~100k.** Kein Erase bei `UPDATE`; nur bei `FLUSH`/`SAVE-BUFFERS`.
4. **Timing:** tSE ≈ 45 ms, tPP ≈ 0,7 ms; WIP pollen; kein HW-Interrupt ⇒
   Busy-Wait; Gerät als Zustandsautomat, `step()` nicht blockieren.
5. **Bitstream-Schutz:** Regionswächter in Forth **und** RTL; Reserve nachmessen.
6. **MSPI/Pin-Modus** hier nicht verifizierbar → gegen DS117/IPUG279 prüfen.
7. **Dreikern-Parität**; MMIO-Adressen konsistent; nur `LDS`/`STS` sehen Ports.
8. **Determinismus:** parametrisierte Zeiten, Timing-Invarianztest.
9. **Endianness/Packing**, falls später doch byte-orientiert.
10. **BIOS-Längeninvariante** respektieren.
11. **PSRAM gibt es noch nicht** (`PLANPSRAM.md` nicht umgesetzt) — der
    Sektorpuffer liegt vorerst im RTL-Array; 4 KB sind unkritisch.

---

## 10. Offene Punkte (zu klären, bevor Code entsteht)

- **Bitstream-Größe** aus der echten `.fs`/`.bin` messen → Regionsgrenze.
- **Pin-Modus** (single-/dual-purpose) und **MSPI-Primitiv** in Gowin EDK.
- **Blockraster**: `C/L = 80`, 24 Zeilen (1920) + 128 Zellen Kopf — bestätigt?
- **Blockkopf-Inhalt**: Name/Flags/Version, oder vorerst Nullen?
- **`ST_DATA`-Port vs. Speicherfenster** — Port für Parität, Fenster für Tempo.
- **Blocknummerierung**: ab 0 oder 1, Systemblocks (z. B. 0 = Header) reservieren?
- **Persistenz im IDE**: `localStorage` oder `.img`-Export/-Import?
- **Buchbezug:** neues Kapitel 9 (Forth-Kern), verwandt mit `EVALUATE`
  (`STATUS.md` „Nächste Schritte" 7).
