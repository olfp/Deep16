# Design-Spezifikation: Deep16 Grafik-Subsystem (GCoP)

Projekt-Status: **Design-Phase / Planungsgrundlage.** GFX ist ferne Zukunft; dieses
Dokument beschreibt eine beabsichtigte Richtung, **keine** Implementierungs-Spezifikation.
Es ersetzt die frühere Fassung (Commit `3710b63`) nach einer Architektur-Review.

Ziel-Hardware: Sipeed Tang Nano 9K (Gowin GW1NR-9K, 8.640 LUT4 / 26 BSRAM / 64 Mbit PSRAM).
Referenzen: `doc/Deep16-Arch.md`, `doc/Deep16-Prog-Man.md`, `rtl/*.sv`, `VERILOG.md`.

Kern-Konzept: Framebuffer-lose, objektorientierte Grafik-Engine via mikroprogrammierter
Spezial-CPU (GCoP – Graphics Co-Processor), Beam-Racer-Prinzip.

---

## 0. Revisionsstand – was sich gegenüber `3710b63` geändert hat

| # | Befund der Review | Status |
|---|---|---|
| 1 | H-Blank-Timing war falsch (370 px ⇒ 40 Hz statt 60 Hz) | **korrigiert**, §1 |
| 2 | PSRAM-Bandbreite im Maximalfall über Budget; §5-Rechnung unbelegt | **korrigiert**, §6 |
| 3 | Paletten-Schema (pro 16 px) war als Normalfall modelliert | **neu gefasst als Betriebsmodi**, §5 |
| 4 | OAM-Scan-Budget fehlte; keine Obergrenze für Objekte benannt | **ergänzt**, §4.3 + §6.3 |
| 5 | Kein CPU/GCoP-Memory-Arbiter | **als offener Punkt aufgenommen**, §4.5 |
| 6 | Aktuelles Deep16-RTL passt nicht auf den GW1NR-9K (Speicher!) | **als Voraussetzung aufgenommen**, §9 |
| 7 | „gesamter Speicher" per 20-Bit-Leitung widersprüchlich | **korrigiert**, §2.1 |
| 8 | Kein CPU-sichtbares Register-Interface | **Entwurf ergänzt**, §7 |
| 9 | Keine Interrupts | **Entwurf ergänzt**, §7.2 |
| 10 | Textmodus 80×25 ohne Lebensraum | **als offene Entscheidung festgehalten**, §8 |
| 11 | Überschriften-Kollision, Alpha-Blending-Begriff, fehlendes Clipping, fehlender Hintergrund, `Interlacing`-Flag ohne Modus, Chat-Reste am Dokumentende | **korrigiert** |

---

## 1. Systemübersicht & Display-Spezifikationen

Das System nutzt das Beam-Racer-Prinzip. Bilder werden in Echtzeit zeilenweise während des
HDMI-Auswurfs generiert. Ein klassischer, permanenter Vollbild-Framebuffer entfällt.

* Target-Auflösung (Logisch): 640 × 360 Pixel (exakt 16:9).
* Ausgabe-Auflösung (Physisch): 1280 × 720p @ 60 Hz via HDMI, CTA-861-Timing.
* Skalierung: 2×2 Integer-Scaling (perfekt verdoppelte Pixel, kein Unschärfe-Flimmern).
* Farbtiefe: 4 Bit pro Pixel (16 Indizes: 0x0 = transparent, 0x1–0xF = Palettenfarbe).
* Ausgabefarben: 16 Bit HighColor (RGB 565) über die aufgelöste Palette.

### 1.1 Korrigierte Zeitbasis (CTA-861 720p60 @ 74,25 MHz)

Die frühere Fassung nannte 370 Pixelclocks H-Blank. Das ergibt mit 1280 aktiven Pixeln
H_total = 1650 und damit **40 Hz** – nicht 720p60. Korrekt sind:

| Größe | Wert |
|---|---|
| Pixelclk | 74,25 MHz |
| H_active | 1280 Pixelclocks = 17,24 µs |
| H_blank | **920 Pixelclocks = 12,39 µs** |
| H_total | 2200 Pixelclocks = 29,63 µs |
| Zeilenfrequenz | 67,5 kHz |
| V_total | 1125 Zeilen ⇒ 60 Hz |

**Konsequenz für die Auslegung:** Das reale H-Blank ist rund **2,5× länger** als zunächst
angenommen. Der GCoP gewinnt Budget, nicht verliert es. Sämtliche Auslegungsrechnungen in
§4 und §6 sind gegen diese Zahlen zu rechnen.

---

## 2. Speicher-Architektur & Segmentierung

### 2.1 Adressbreite

Das Hauptsystem nutzt 16-Bit-Wortadressierung. Der physische Adressraum umfasst
**2²⁰ Worte × 16 Bit = 2 MB** (`rtl/deep16_pkg.sv:10` `MEM_WORDS = 1048576`,
`rtl/deep16_top.sv:32`).

> **Korrektur:** Die frühere Fassung behauptete, ein 20-Bit-Bus erschließe „den gesamten
> Speicher inkl. des 64-Mbit-PSRAMs". Das ist unmöglich: 2 MB sind **25 %** der 8 MB PSRAM.
> Der GCoP sieht 2 MB. Ob der Grafikbus auf 22 Bit (wortadressiert) erweitert wird, um mehr
> PSRAM nutzbar zu machen, ist eine **offene Entscheidung** (§10, E-2).

> **Klärung zur Dokumentation:** `doc/Deep16-Arch.md` §8.1 nennt
> `PA = (Segment << 16) | Offset`. Das widerspricht der Hardware: `rtl/deep16_core.sv:571`
> rechnet `pa_m = {seg_val, 4'h0} + offset`, also `seg << 4`. **§8.1 des Arch-Dokuments ist
> fehlerhaft und sollte korrigiert werden** – nicht dieses Dokument.

### 2.2 Segment-Adressierung (seg << 4)

Um Objektdaten kompakt zu halten, übergibt die Deep16-CPU dem GCoP für Grafikobjekte lediglich
eine 16-Bit-Segmentadresse (seg). Die Hardware berechnet die physikalische Adresse im RAM
über festverdrahtete Bit-Shifts:

    Adresse_20bit = (seg << 4) + Wort-Offset

**Ausrichtung:** Jedes Grafikobjekt muss auf einer durch **16 Worte** teilbaren Adresse liegen.
Ein Objekt umfasst zwingend mindestens 16 Worte (Kopfblock) – und seine **Größe muss ebenfalls
ein Vielfaches von 16 Worten sein**, sonst lässt sich das Folgobjekt nicht regelkonform
platzieren. Beides ist vom Linker/Assembler zu erzwingen.

### 2.3 Layout eines Grafik-Objekts (Buffer-Segments)

    +-------------------------------------------------------------+
    | Wort 0x00: X-Position (signed 16-Bit)                        |
    | Wort 0x01: Y-Position (signed 16-Bit)                        |
    | Wort 0x02: Breite (Pixel)                                    |
    | Wort 0x03: Höhe (Pixel)                                      |
    | Wort 0x04: Z-Position (8 Bit genutzt: 0 = hinten, 255 = vorn)|
    |         Bits 8–15 reserviert                                  |
    | Wort 0x05: Flags (Bit 0: Aktiv, Bit 1: Mode, Bit 2: Clip)   |
    | Wort 0x06: Palettenbasis (Wort-Offset im BSRAM)              |
    | Wort 0x07–0x0F: reserviert für System/Effekte               |
    +-------------------------------------------------------------+
    | Wort 0x10 – X: Zeilen-Daten (siehe §5, abhängig vom Modus)   |
    +-------------------------------------------------------------+
    | Danach: 4-Bit gepackte Pixeldaten (4 Pixel pro 16-Bit-Wort)  |
    +-------------------------------------------------------------+

---

## 3. Clock-Domänen-Spezifikation (Taktdomänen)

Vier PLLs, gespeist vom 27-MHz-Onboard-Quarz:

1. **`clk_cpu` (54 MHz)** – Deep16-Haupt-CPU, Kontrollfluss des GCoP in H-Blank.
2. **`clk_pixel` (74,25 MHz)** – HDMI-Timing (H-Sync, V-Sync, Active Video).
3. **`clk_hdmi_serial` (371,25 MHz)** – 5× Pixeltakt, DDR-Betrieb (OSER10) zur
   TMDS-Serialisierung direkt an die HDMI-Pins.
4. **`clk_psram` (162 MHz)** – PSRAM-IP-Controller, Bereitstellung der Pixeldaten.

**Noch zu spezifizieren (offen, §10 E-3):** Der GCoP wechselt in §4 zwischen `clk_cpu`
(H-Blank) und `clk_pixel` (Active Video). Das ist ein Moduswechsel über eine Domänengrenze
hinweg. Er ist machbar, verlangt aber ein sauberes Handshake-/Gray-Code-Protokoll für das
Line-OAM-Registerarray, das in beiden Domänen lebt. Das ist bisher **nirgends beschrieben**
und gehört in die Entwurfsphase.

---

## 4. Die Grafik-Spezial-CPU (GCoP)

Der GCoP ist ein dedizierter, mikroprogrammierter 20-Bit-Kern. Sein Kontrollfluss wird durch
ein fest in das FPGA-Block-RAM (BSRAM) eingebranntes Mikrocode-ROM gesteuert.

### 4.1 Phase A – Horizontal Blanking (H-Blank), 920 Pixelclocks = 12,39 µs

Während der HDMI-Strahl unsichtbar zur nächsten Zeile springt, arbeitet der GCoP im
Kontrollfluss-Modus auf CPU-/Speichertaktung:

1. **OAM-Scan** – sequentielles Durchlaufen der Liste aktiver Grafiksegmente im RAM.
2. **Kollisionsprüfung** – trifft die aktuelle Zeile Y das Objekt, d. h.
   `Y_pos <= Y < Y_pos + Höhe`?
3. **Line-OAM-Caching** – bis zu 16 gültige Treffer werden in ein internes Registerarray im
   FPGA (Distributed RAM) kopiert.
4. **Z-Sortierung** – die Treffer werden nach Z von hinten nach vorne priorisiert.
5. **Zeilen-Datenzeiger holen** – je Objekt der Zeilen-Datenzeiger für die aktuelle Y-Position.

### 4.2 Phase B – Active Video, 1280 Pixelclocks = 17,24 µs

Sobald die Zeile gezeichnet wird, schaltet der GCoP in den DMA-/Streaming-Modus synchron zur
Pixelclock:

1. Die GCoP fordert die 4-Bit-Pixeldaten der gecachten Objekte per Burst-Read aus dem PSRAM an.
2. Der Index wird über die Palette (§5) in eine 16-Bit-RGB565-Farbe übersetzt und in den
   aktiven Line-Buffer geschrieben. Alle 16 horizontalen Pixel wechselt die Engine zum
   nächsten Paletten-Zeiger (nur im Modus `PER_16PX`, §5).
3. **Alpha-Test (Colorkey):** Index `0x0` ist transparent und **schreibt nicht**. Höhere
   Z-Werte überschreiben niedrigere.

> **Korrektur:** Die frühere Fassung sprach hier von „Alpha-Blending". Implementiert ist ein
> reiner Alpha-*Test* (1-Bit-Transparenz) – es wird **nicht** gemischt. Begriff korrigiert.

> **Noch offen (E-4):** Der **Hintergrund** ist nicht definiert. Schreibt ein transparenter
> Pixel nicht, muss der Line-Buffer beim Zeilenbeginn mit einer Hintergrundfarbe vorbelegt
> werden (global oder ggf. als eigenes Objekt mit Z = 0). Ohne diese Festlegung ist der
> Zeilenanfang undefiniert.

### 4.3 Clipping

Objekte können negative oder jenseits von 640 liegende X-Positionen haben. Vor dem Rastern
ist auf das horizontale Sichtfenster zu clippen; insbesondere beginnt der 16-Pixel-Blocklauf
nicht zwangsläufig auf einer Blockgrenze. Ein Clipping-Pfad ist in der früheren Fassung
**vollständig gefehlt** und gehört in den Entwurf.

### 4.4 OAM-Scan-Budget (Neu)

Das Budget ist knapp, aber nicht limitierend – **sofern eine Obergrenze für die Gesamtzahl
der Objekte gesetzt wird**:

| Größe | Wert |
|---|---|
| H-Blank-Dauer | 12,39 µs |
| Zyklen @ `clk_cpu` 54 MHz | 669 |
| Kosten pro Objekt (16-Wort-Kopf, PSRAM-Latenz + Burst) | ≈ 40 Zyklen |
| **Objekte pro Zeile @ 54 MHz** | **≈ 17** |
| Objekte pro Zeile @ 162 MHz (Scan auf PSRAM-Takt) | ≈ 50 |

**Festlegung:** Der OAM-Scan läuft in Phase A auf CPU-Takt ⇒ **maximal ca. 16 aktive
Objekte** im Gesamtsystem, mit Reserve für den Sortierer. Soll mehr benötigt werden, ist ein
Grob-Y-Bucket-Index (360 Einträge, Zeile → Objektliste) vorzuschalten – der klassische
PPU-Ansatz. Das ist als Folgeprojekt vorgesehen, nicht als Bestandteil der ersten Stufe.

Der Z-Sortierer muss ebenfalls ins Budget: ein Bubble-Sort über 16 Einträge kostet ~120
Vergleiche (~2,2 µs @ 54 MHz) und ist parallel zum Scan zu planen.

### 4.5 Memory-Arbitration (Neu, offen)

In Phase B liest der GCoP per Burst aus dem PSRAM, während die Deep16-Haupt-CPU weiterläuft.
Die Tang-Nano-9K-PSRAM ist **einzelportig**. Es ist daher zwingend festzulegen:

* Wer bekommt bei Kollision Vorrang – CPU oder GCoP?
* Wird der GCoP hart präemptiert (Pixelverlust) oder per Warteschlange verzögert?
* Was kostet das die CPU-Durchsatzrate?

Ohne diese Regel ist §6 nicht belastbar, weil jede Budgetrechnung eine CPU-Ruhigannahme
trägt. **Diese Frage ist vor dem RTL-Entwurf zu beantworten (E-1).**

---

## 5. Palette: Betriebsmodi (Neu gefasst)

Die frühere Fassung modellierte die „Palette pro 16 Pixel" als *den* Normalfall. Tatsächlich
ist die Palettenauflösung ein **Spektrum**, und der realistische Betrieb liegt nahe dem
billigen Ende:

| Modus | Auflösung | Zeilenzugriffe je Objekt (Breite W) | Zweck |
|---|---|---|---|
| `GLOBAL` | 1 Palette für alle Objekte | `1 + ⌈W/4⌉` | **Normalfall.** Einheitliche Farbwelt, Sprite-Retro-Look, geringste Last. |
| `PER_OBJ` | 1 Palette je Objekt | `2 + ⌈W/4⌉` | Teambaren pro Objekt, z. B. gegnerische Einheiten. |
| `PER_16PX` | Palette je 16-Pixel-Block | `2·⌈W/16⌉ + ⌈W/4⌉` | **Maximalfall.** Bewusst spezialisiert, wird voraussichtlich nie verwendet. |

Der Modus wird **pro Objekt** in Flags Bit 1 gewählt; `GLOBAL` ist der Default. Im
`GLOBAL`-Modus liegen die Paletten im **BSRAM** (16 Farben × 16 Bit = 32 Worte) und werden
nicht pro Zeile nachgeladen – sie kosten dann einmalig gar nichts.

**Kostenbewertung `PER_16PX`:** Bei W = 640 entfallen 1280 Byte Palette auf 320 Byte
Pixeldaten – die Palette ist **viermal so groß wie das Bild**. Das ist der Grund, warum dieser
Modus als Extremfall dokumentiert, aber nicht als Ziel geführt wird.

---

## 6. Ressourcen- & Machbarkeits-Check (Tang Nano 9K)

### 6.1 Logik und BSRAM

* **LUT4:** Der GCoP (Mikrocode-Decoder, Adress-Shifter, Alpha-Tester, Skalierer) wird mit
  ca. 1.200–1.500 LUTs angesetzt (~17 % der 8.640 LUTs).
  > **Zu prüfen:** Diese Schätzung stammt aus der Erstfassung und umfasst **weder** das
  > 96-Einträge-Line-OAM-Array (16 Objekte × 6 Register) **noch** den 16-fach
  > Z-Sortierer. Beide sind LUTRAM bzw. Logik und dürfen den Aufpreis nicht ignorieren.
  > Erneute Schätzung nach dem RTL-Entwurf nötig.
* **BSRAM:**
  * Mikrocode-ROM: 1 Block.
  * Line-Buffer: 2 × 640 Wörter à 16 Bit RGB565 = 2 × 10.240 Bit. Ein 18-Kbit-BSRAM-Block
    fasst das **mehrfach**; die Angabe „2 Blöcke" ist also konservativ und unkritisch.
  * Paletten (Modus `GLOBAL`): 32 Worte pro Palette, mehrere Paletten in einem Block.
  * Verbleibende Blöcke für Stack, Cache, Bootloader.

### 6.2 Speicherbandbreite (korrigiert)

PSRAM liefert bei 162 MHz × 16 Bit = **324 MB/s**. Bedarf je Zeile (17,24 µs Active Video),
gerechnet mit 4 Bit/Pixel (4 Pixel pro Wort) und den Zeilenzugriffen aus §5:

| Szenario | `GLOBAL` | MB/s | `PER_16PX` | MB/s |
|---|---|---|---|---|
| 16 × 640 px – Maximalfall, volle Überdeckung | 2.576 W | **299** (92 %) | 3.840 W | **445** (137 %) ⚠ |
| 10 × 320 px | 810 W | 94 | 1.200 W | 139 |
| 16 × 160 px | 656 W | 76 | 960 W | 111 |
| 16 × 80 px – typisch | 336 W | 39 | 480 W | 56 |
| 8 × 128 px | 264 W | 31 | 384 W | 45 |

**Befund:** Nur der **pathologische Maximalfall** (16 Objekte, jedes über die volle
Bildbreite, vollständig überlappend) überschreitet das Budget – und das nur im Modus
`PER_16PX`. Alle realistischen Szenarien liegen bei **7–34 %** der verfügbaren Bandbreite, im
`GLOBAL`-Modus auch im Maximalfall mit 92 % noch innerhalb des Budgets.

Die frühere Fassung hatte fälschlich „reicht vollkommen aus" behauptet, dabei aber nur den
einen Maximalfall gerechnet und das Ergebnis war even dort falsch. **Ergebnis in der
Realität: unkritisch**, sofern `PER_16PX` nicht in produktiven Szenarien verwendet wird.

> Der Wert von 92 % im `GLOBAL`-Maximalfall ist ohne CPU-Anteil gerechnet. Sobald die Deep16
> CPU parallel mitliest/schreibt (§4.5), ist das die harte Obergrenze, aus der die
> CPU-Politik abgeleitet werden muss.

### 6.3 Zusammenfassung der Machbarkeit

| Punkt | Bewertung |
|---|---|
| Grundkonzept (Beam-Racer, objektbasiert) | tragfähig |
| Bandbreite realistischer Szenarien | unkritisch (7–34 %) |
| Bandbreite Maximalfall `PER_16PX` | über Budget – Modus als Experiment einstufen |
| Bandbreite Maximalfall `GLOBAL` | 92 % ohne CPU – knapp, braucht Arbitrationsentscheidung |
| OAM-Scan @ CPU-Takt | ~16 Objekte Obergrenze |
| Logikbedarf | Schätzung zu niedrig, Neuschätzung nötig |
| **Voraussetzung PSRAM-Umbau** | **blockierend, siehe §9** |

---

## 7. CPU-Anbindung: Register und Interrupts (Neu)

Ohne diese Schnittstelle ist die Engine nicht steuerbar und nicht testbar. Die Deep16-CPU
belegt laut `doc/Deep16-Prog-Man.md` §7.1 bereits den Bereich `0xF0030–0xF003F`
(16 Wörter) für den Video Display Controller.

### 7.1 Registerentwurf

| Offset | Register | Zugriff | Bedeutung |
|---|---|---|---|
| `0xF0030` | `VDC_CTRL` | RW | Bit 0 Enable, Bit 1 Reset, Bit 2 Interlace (reserviert), Bit 3 DMA-Test |
| `0xF0031` | `VDC_STATUS` | RO | Bit 0 Busy-in-H-Blank, Bit 1 VBlank-Flag, Bit 2 OAM-Überlauf |
| `0xF0032` | `VDC_OAMLIST` | RW | Segmentadresse der Objektliste |
| `0xF0033` | `VDC_OBJCOUNT` | RW | Anzahl der Objekte (≤ 16, siehe §4.4) |
| `0xF0034` | `VDC_BGPAL` | RW | Basis der globalen Palette im BSRAM |
| `0xF0035` | `VDC_BGCOLOR` | RW | Hintergrundfarbe RGB565 (siehe E-4) |
| `0xF0036` | `VDC_SCALING` | RW | logische Breite/Höhe, Default 640×360 |
| `0xF0037` | `VDC_IRQEN` | RW | Interrupt-Maske |
| `0xF0038–0xF003F` | – | – | reserviert |

### 7.2 VBlank-Interrupt (Neu)

Deep16 verfügt mit den 12 Shadow-Registern über einen Interrupt-Eintritt von 2 Zyklen
(`doc/Deep16-Arch.md` §2.3). Das ist ideal für eine VBlank-ISR, die die Objektliste
mid-frame neu aufbaut – und ist der Grund, warum der Ansatz zum Core passt:

* `VDC_IRQEN` Bit 0: VBlank → ISR, Objektliste neu aufbauen, Palette ändern.
* `VDC_IRQEN` Bit 1: OAM-Überlauf (mehr als 16 Treffer) → Diagnose.
* Der Kontextwechsel ist hardwareverwaltet; die ISR kehrt mit einem einzigen
  Rücksprung in den Anwendungscode zurück.

Ohne VBlank-Interrupt gibt es keinen rissfreien Szenenwechsel – das war in der früheren
Fassung ungeregelt.

---

## 8. Textmodus 80×25 (Entscheidung offen)

**Festgelegt: Der Textmodus bleibt erhalten und wird nicht aufgegeben.**

Der bestehende 80×25-Modus ist real: `js/deep16_ui_screen.js:5` legt den Puffer auf `0xF1000`
fest, 2000 Wörter (80 × 25), Bit 15 = Reverse Video. Er funktioniert heute ohne Framebuffer,
weil die **UI** die Glyphen on demand in den Canvas zeichnet.

Die offene Frage ist, wie er auf einem FPGA-Ziel mit dem GCoP zusammenlebt. Kandidaten:

1. **Zeichenzelle als GCoP-Objekt** – jede Zelle verweist auf eine Glyphe im ROM, wird wie
   jedes andere Objekt gerastert. Unification, ein einziger Rasterpfad.
2. **Eigene Textebene im GCoP** – der Rasterer liest zusätzlich 80 × 5 Zeilenzeiger.
3. **Framebuffer für den Textmodus** – widerspricht dem Grundkonzept, nur als Notlösung.

**Diese Entscheidung ist bewusst vertagt.** Festgehalten ist nur: Der Puffer bei `0xF1000`
bleibt gültig, und die FPGA-Variante muss mit dem JS-Emulator formatgleich bleiben
(Kompatibilitätstest §10, E-5).

---

## 9. Voraussetzungen (Neu – blockierend)

### 9.1 PSRAM-Umbau der Haupt-CPU

**Der heutige Deep16-Kern lässt sich auf dem GW1NR-9K nicht bauen.** Das ist keine
Feinheit, sondern die vorrangige Voraussetzung für alles Weitere:

| Größe | Wert |
|---|---|
| `MEM_WORDS` (`rtl/deep16_pkg.sv:10`) | 1.048.576 Worte |
| Deklarierte On-Chip-Matrix (`rtl/deep16_top.sv:32`) | `reg [15:0] mem [0:1048575]` = **16,8 Mbit** |
| Verfügbares BSRAM (GW1NR-9K, 26 × 18 Kbit) | **≈ 468 Kbit** |
| **Überhang** | **≈ 35×** |

`VERILOG.md` begründet die On-Chip-Matrix mit „ein On-Chip-FPGA-Build braucht kein externes
Speichermodell". Für diesen Baustein gilt das nicht. **Erforderlich:** Verlagerung des
Hauptspeichers in die PSRAM mit echtem Memory-Controller, dual-portfähig für CPU und GCoP.

Diese Arbeit ist **größer als der GCoP selbst** und sollte als eigenes Projekt geführt
werden. GFX ist erst danach sinnvoll terminierbar.

### 9.2 Weitere Voraussetzungen

* Takt- und Reset-Strategie für den Betrieb ohne On-Board-Speicher-Array.
* Debug-Zugang (JTAG/UART über `0xF0040`) für Bildschirmausgaben während der Fehlersuche.

---

## 10. Offene Entscheidungen

| ID | Frage | Blockiert |
|---|---|---|
| **E-1** | Memory-Arbitration CPU ↔ GCoP: Vorrang, Preemption, CPU-Kosten (§4.5) | Bandbreiten-Budget, RTL |
| **E-2** | Grafikbus auf 22 Bit erweitern oder bei 2 MB bleiben (§2.1)? | Adresskonzept |
| **E-3** | Clock-Domain-Crossing-Protokoll für das Line-OAM (§3) | RTL |
| **E-4** | Hintergrundfarbe und Vorbelegung des Line-Buffers (§4.2) | Bildqualität |
| **E-5** | Textmodus-Strategie FPGA ↔ JS-Emulator (§8) | Kompatibilität, UI |
| **E-6** | Max. Objektzahl fest 16 oder Y-Bucket-Index vorsehen (§4.4) | Skalierbarkeit |
| **E-7** | Z-Sortierung: Bubble oder Auswahl-Sortierung, Kosten abdecken (§4.4) | Timing-Budget |

Nächster sinnvoller Schritt ist **nicht** die Ausarbeitung des Mikrocode-Worts, sondern die
Entscheidung zu **E-1** und der Start von **§9.1** – ohne externen Hauptspeicher gibt es
keine FPGA-Instanz, auf der eine Grafik-Engine laufen könnte.