# Design-Spezifikation: Deep16 Grafik-Subsystem (GCoP)

Projekt-Status: **Design-Phase / Planungsgrundlage.** GFX ist ferne Zukunft; dieses
Dokument beschreibt eine beabsichtigte Richtung, **keine** Implementierungs-Spezifikation.
Es ersetzt die frühere Fassung (Commit `3710b63`) nach einer Architektur-Review.

Ziel-Hardware: Sipeed Tang Nano 9K (Gowin GW1NR-9K, 8.640 LUT4 / 26 BSRAM / 64 Mbit PSRAM).
Referenzen: `doc/Deep16-Arch.md`, `doc/Deep16-Prog-Man.md`, `rtl/*.sv`, `VERILOG.md`.

Kern-Konzept: Framebuffer-lose, objektorientierte Grafik-Engine via mikroprogrammierter
Spezial-CPU (GCoP – Graphics Co-Processor), Beam-Racer-Prinzip.

---

## 0. Revisionsstand – Änderungen gegenüber `3710b63`

Dieses Dokument hat **zwei** Review-Durchläufe durchlaufen. Die erste Fassung der
Korrekturen (Commit `12eebb3`) enthob einen Fehler; §1.1 dokumentiert die Korrektur.

| # | Befund | Status |
|---|---|---|
| 1 | ~~H-Blank-Timing war falsch~~ | **zurückgenommen** – die erste Fassung `3710b63` hatte mit 370 Pixelclocks **recht**; die Erstkorrektur verwechselte 720p60 mit 1080p60. Korrigiert in §1.1. |
| 2 | ~~PSRAM-Bandbreite im Maximalfall über Budget~~ → **zurückgenommen:** die Rechnung war methodisch richtig, beruhte aber auf 16 gleichzeitigen Objekten. Mit ~7 (§4.4) liegt selbst der Worst-Case bei 60 %. Siehe §6.2 |
| 3 | Paletten-Schema (pro 16 px) war als Normalfall modelliert | **neu gefasst als Betriebsmodi**, §5 |
| 4 | OAM-Scan-Budget fehlte; keine Obergrenze für Objekte benannt | **ergänzt**, §4.3 + §6.3 |
| 5 | Kein CPU/GCoP-Memory-Arbiter | **als offener Punkt aufgenommen**, §4.5 |
| 6 | Aktuelles Deep16-RTL passt nicht auf den GW1NR-9K (Speicher!) | **als Voraussetzung aufgenommen**, §9 |
| 7 | „gesamter Speicher" per 20-Bit-Leitung widersprüchlich | **korrigiert**, §2.1 |
| 8 | Kein CPU-sichtbares Register-Interface | **Entwurf ergänzt**, §7 |
| 9 | Keine Interrupts | **Entwurf ergänzt**, §7.2 |
| 10 | Textmodus 80×25 ohne Lebensraum | **als offene Entscheidung festgehalten**, §8 |
| 11 | Überschriften-Kollision, Alpha-Blending-Begriff, fehlendes Clipping, fehlender Hintergrund, `Interlacing`-Flag ohne Modus, Chat-Reste am Dokumentende | **korrigiert** |
| 12 | OAM-Scan-Budget zu optimistisch (669 statt 269 Zyklen, ~16 statt ~7 Objekte) | **korrigiert**, §4.4 |
| 13 | Non-executable Video-RAM als Enabler für die PSRAM-Port-Aufteilung | **neu aufgenommen**, §2.4 + §9.2 |
| 14 | Palettengruppen-Struktur: pro Zeile ein Gruppen-Zeiger, pro 16 Pixel ein Paletten-Zeiger | **neu spezifiziert**, §5.1 + §2.3 Wort 0x06 |
| 15 | OAM-Scan hing an der Annahme „PSRAM 162 MHz" und ergab nur 6–7 Objekte | **neu gerechnet mit Deskriptoren im BSRAM:** bis zu **16 Objekte** (Line-OAM 16), Z-Sortierer wird zweite Engstelle, §4.4 |
| 16 | Bandbreite mit 100 % Burst-Effizienz angesetzt; Metadaten konkurrierten mit Pixeldaten | **neu gerechnet:** Effizienz 44/61/74 % (IPUG943E), PSRAM trägt nur noch Pixeldaten → Worst-Case 54 %, §6.2 |

---

## 1. Systemübersicht & Display-Spezifikationen

Das System nutzt das Beam-Racer-Prinzip. Bilder werden in Echtzeit zeilenweise während des
HDMI-Auswurfs generiert. Ein klassischer, permanenter Vollbild-Framebuffer entfällt.

* Target-Auflösung (Logisch): 640 × 360 Pixel (exakt 16:9).
* Ausgabe-Auflösung (Physisch): 1280 × 720p @ 60 Hz via HDMI, CTA-861-Timing.
* Skalierung: 2×2 Integer-Scaling (perfekt verdoppelte Pixel, kein Unschärfe-Flimmern).
* Farbtiefe: 4 Bit pro Pixel (16 Indizes: 0x0 = transparent, 0x1–0xF = Palettenfarbe).
* Ausgabefarben: 16 Bit HighColor (RGB 565) über die aufgelöste Palette.

### 1.1 Zeitbasis (CTA-861 VIC 4, 720p60 @ 74,25 MHz)

> **Warnung – die Erstkorrektur war falsch.** Commit `12eebb3` behauptete, die
> ursprünglichen 370 Pixelclocks H-Blank ergäben 40 Hz und seien durch 920 zu ersetzen.
> Das war ein Verwechslungsfehler: die Werte 2200/1125/148,5 MHz gehören zu **1080p60**,
> nicht zu 720p60. Übernommen wurden sie bei 74,25 MHz und ergaben folgerichtig 30 Hz.
> **Die Ursprungsfassung `3710b63` hatte recht.** Die folgenden Werte sind gegen
> CEA-861 Table 4 geprüft und sollen künftig zitiert statt neu abgeleitet werden.

| Größe | Wert | Quelle |
|---|---|---|
| Pixelclk | 74,25 MHz | VIC 4 |
| H_active | 1280 Pixelclocks = 17,24 µs | VIC 4 |
| **H_blank** | **370 Pixelclocks = 4,98 µs** | VIC 4 |
| H_total | 1650 Pixelclocks = 22,22 µs | VIC 4 |
| Zeilenfrequenz | 45,0 kHz | VIC 4 |
| V_active / V_total | 720 / 750 Zeilen (30 V-Blank) | VIC 4 |
| **V_blank (ganzes Bild)** | 30 Zeilen × 22,22 µs = **666,7 µs** | abgeleitet |
| Bildrate | 74,25 MHz / (1650 × 750) = 60,00 Hz | VIC 4 |

**Konsequenz für die Auslegung:** Das H-Blank beträgt **4,98 µs** – knapp die Hälfte der
Zeit, die der erste Korrekturversuch annahm. Das OAM-Scan-Budget (§4.4) ist entsprechend
**knapper als in `12eebb3` behauptet**, nicht reichlicher. Ein Y-Bucket-Index ist damit
**zwingend**, nicht als Folgeprojekt verschiebbar.

Unverändert gültig bleiben: die aktive Videozeit von 17,24 µs und damit die
Bandbreitenrechnung in §6.2, denn `H_active = 1280` ist von der Blanking-Korrektur nicht
berührt. Ebenso bleibt V_blank mit 666,7 µs ein großzügiges Fenster für den ISR (§7.2).

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
    | Wort 0x06: Paletten-Gruppen-Basis (Index im BSRAM, §5)      |
    | Wort 0x07–0x0F: reserviert für System/Effekte               |
    +-------------------------------------------------------------+
    | Wort 0x10 – X: Zeilen-Daten (siehe §5, abhängig vom Modus)   |
    +-------------------------------------------------------------+
    | Danach: 4-Bit gepackte Pixeldaten (4 Pixel pro 16-Bit-Wort)  |
    +-------------------------------------------------------------+

> **Kopfblock = OAM-Eintrag (2026-10-12).** Die 16 Worte sind das *logische* Layout. In der
> Ausführung liegen die Deskriptoren gepackt im **BSRAM** (3 Worte à 32 Nutzbits, §4.4) —
> der Scanner liest sie dort, nicht aus der Video-Bank. Das Buffer-Segment in der Video-Bank
> trägt damit nur noch **Pixeldaten und Zeilen-Zeiger**. Die Schreibregel CPU ↔ OAM ist offen
> (§10 E-11).

### 2.4 Non-executable Video-RAM

**Festlegung:** Ein Speicherbereich von **64 K Worten** (128 KB) wird als Video-RAM
reserviert und **als nicht-ausführbar** gekennzeichnet. Er ist weder über den
Instruction-Fetch-Port lesbar noch als Sprungziel gültig.

**Größenwahl:** 640 × 360 bei 4 Bit/Pixel = 57.600 Worte. Ein 64-K-Wort-Bereich fasst damit
**genau einen Vollbild-Objektsatz** an Pixeldaten; die Kopfblöcke liegen seit dem BSRAM-OAM
(§4.4) nicht mehr hier. Kleinere Schnitte passen ebenso.

**Warum das drei Probleme gleichzeitig löst:**

1. **Port-Aufteilung für die PSRAM (→ §9.2).** Weil der Fetch-Pfad Video-RAM nachweislich
   nie berührt, sind die Konsumenten disjunkt: Fetch + Daten nur auf Haupt-RAM, GCoP-Read
   und CPU-Write nur auf Video-RAM. Ohne diese Zusicherung müsste jederzeit mit einem Fetch
   in den Videobereich gerechnet werden und die Aufteilung wäre nicht beweisbar.
2. **Fehlerklasse Beseitigung.** In einer framebufferlosen Engine liest der GCoP Sprite-Daten
   aus demselben RAM, aus dem die CPU läuft – es gibt keine Framebuffer-Hardware, die beide
   trennt. Ein verirrter Zeiger oder Sprung in Sprite-Daten ist damit kein seltener Bug,
   sondern ein strukturell wahrscheinlicher: die CPU führt Bilddaten als Befehle aus. NX
   wandelt das in einen sauberen ILL-Trap (der Trap-Mechanismus existiert bereits).
3. **Abgrenzung gegen die PSRAM-Umsetzung (→ §9.1).** Die Auszeichnung macht die
   Adressaufteilung der PSRAM überprüfbar, statt sie per Konvention anzunehmen.

**Mechanismus:** base+limit in MMIO, ein Komparator im Fetch-Pfad – **kein** NX-Bit je
Segment. Begründung: die 16-Bit-Segmentregister ergeben bei `seg << 4` und 16-Bit-Offset
überlappende 128-KB-Fenster (§2.2), keine 64-KB-Partitionen; ein Segment-Bit wäre die
falsche Granularität. Der Video-Bereich wird stattdessen per Basis- und Endadresse beschrieben,
ein Zugriff im Fetch-Pfad fällt in den ILL-Trap.

**Regel: Video-RAM ist schreib-only für die CPU.** Die CPU schreibt Objekt- und Pixeldaten
ausschließlich im V-Blank (ISR, §7.2) und liest sie **nie** zurück, solange der GCoP liest.
Diese Regel ist tragend – fällt sie, konkurrieren CPU-Read und GCoP-Read wieder um denselben
Port und der Vorteil aus §9.2 entfällt. Kollisionsdetektion o. Ä. ist entsprechend auf Kopien
im Haupt-RAM umzuleiten.

**Landbar vor GFX – unabhängig.** Diese Funktion muss nicht auf die Grafik-Engine warten.
Der bestehende 80×25-Textpuffer bei `0xF1000` ist bereits reserviert, wird nach Konvention
nie ausgeführt und ist von der Testsuite abgedeckt. Ihn als erstes NX-Gebiet zu verwenden
prüft und testet den kompletten Pfad gegen einen bereits vertrauten Bereich – damit ist NX
vor GFX ausgereift und nicht neu.

---

## 3. Clock-Domänen-Spezifikation (Taktdomänen)

Vier PLLs, gespeist vom 27-MHz-Onboard-Quarz:

1. **`clk_cpu` (54 MHz)** – Deep16-Haupt-CPU, Kontrollfluss des GCoP in H-Blank.
2. **`clk_pixel` (74,25 MHz)** – HDMI-Timing (H-Sync, V-Sync, Active Video).
3. **`clk_hdmi_serial` (371,25 MHz)** – 5× Pixeltakt, DDR-Betrieb (OSER10) zur
   TMDS-Serialisierung direkt an die HDMI-Pins.
4. **`clk_psram` (162 MHz)** – PSRAM-IP-Controller, Bereitstellung der Pixeldaten.

> **Nachtrag 2026-10-12:** Die 162 MHz sind **unbelegt**. Die PSRAM-Dies können 166 MHz
> (CL3), aber ein quelloffener 1:1-Controller auf genau dieser Platine erreicht ~83 MHz;
> 162 MHz verlangen die Gowin-IP mit 1:2-Getriebe. Siehe §6.2, Prämissen.

**Noch zu spezifizieren (offen, §10 E-3):** Der GCoP wechselt in §4 zwischen `clk_cpu`
(H-Blank) und `clk_pixel` (Active Video). Das ist ein Moduswechsel über eine Domänengrenze
hinweg. Er ist machbar, verlangt aber ein sauberes Handshake-/Gray-Code-Protokoll für das
Line-OAM-Registerarray, das in beiden Domänen lebt. Das ist bisher **nirgends beschrieben**
und gehört in die Entwurfsphase.

---

## 4. Die Grafik-Spezial-CPU (GCoP)

Der GCoP ist ein dedizierter, mikroprogrammierter 20-Bit-Kern. Sein Kontrollfluss wird durch
ein fest in das FPGA-Block-RAM (BSRAM) eingebranntes Mikrocode-ROM gesteuert.

### 4.1 Phase A – Horizontal Blanking (H-Blank), 370 Pixelclocks = 4,98 µs

Während der HDMI-Strahl unsichtbar zur nächsten Zeile springt, arbeitet der GCoP im
Kontrollfluss-Modus auf CPU-/Speichertaktung:

1. **OAM-Scan** – Durchlaufen der Objekt-Deskriptoren im **BSRAM**, nicht mehr im PSRAM
   (§4.4). Der Y-Bucket-Index liefert dabei die auf dieser Zeile aktiven Objekte.
2. **Kollisionsprüfung** – trifft die aktuelle Zeile Y das Objekt, d. h.
   `Y_pos <= Y < Y_pos + Höhe`?
3. **Line-OAM-Caching** – die gültigen Treffer werden in ein internes Registerarray im
   FPGA (Distributed RAM) kopiert. Mit dem Y-Bucket-Index (§4.4) sind bis zu 16 möglich;
   ein Array von 16 Einträgen genügt.
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

### 4.4 OAM-Scan-Budget (BSRAM-OAM, neu gerechnet am 2026-10-12)

> **Prämisse geändert.** Die Erstfassung ließ den OAM-Scan über das **PSRAM** laufen und
> rechnete mit „PSRAM-Latenz + Burst ≈ 40 Zyklen" je Objekt. Damit hing die Objektzahl an
> einem ungeprüften Speichertakt (162 MHz, §3) — und die Fallback-Zeile „@ 162 MHz ≈ 20
> Objekte" war die einzige Rettung. Diese Rechnung ist ersetzt.

Die Objekt-*Deskriptoren* liegen im **BSRAM** (Dual-Port, 1 Takt Latenz). Damit ist das
H-Blank-Budget ein reines **Zyklenbudget** und vom PSRAM-Takt unabhängig.

Mit `H_blank = 4,98 µs` (§1.1) bleiben **269 Zyklen @ 54 MHz** — dieselbe Gesamtsumme,
jetzt aber vollständig auf dem Chip:

```
269  ≥  n · (W_obj + c)  +  n²/2
```

* `n` — Objekte auf dieser Zeile (der Y-Bucket liefert genau sie)
* `W_obj` — OAM-Wörter, die der Scanner je Objekt liest
* `c = 2` — Schleifen-, Y-Abgleich- und Einfüge-Overhead je Objekt
* `n²/2` — Z-Sortierer, **seriell** mit dem Scan (nicht parallel)

**Was der Scanner je Objekt braucht** (§2.3): X, Breite, Höhe, Z, Flags,
Paletten-Gruppen-Basis, Zeilen-Basis — sieben Felder. Die BSRAM-Breite entscheidet, wie
viele Takte das kostet:

| OAM-Layout | Breite | Wörter je Objekt | **Objekte/Zeile** |
|---|---|---|---|
| voller 16-Wort-Kopf, ungepackt | 16 Bit | 16 | 11 |
| Felder einzeln gelesen | 16 Bit | 7 | 15 |
| **gepackt (empfohlen)** | **36 Bit** | **3** | **18** |

Der BSRAM-Modus `512×36` liefert 32 Nutzbits je Takt; drei solcher Worte decken alle sieben
Felder ab (`X|Z|Flags`, `Breite|Höhe`, `Palettenbasis|Zeilenbasis`). Rechnung für das
gepackte Layout: `5n + n²/2 ≤ 269` → **n = 18** (90 + 162 = 252).

**Der Sortierer ist jetzt die zweite Engstelle.** Bei n = 16 kostet `n²/2` = **128 der 269
Zyklen (48 %)**. Fast die Hälfte des Budgets geht für das Sortieren drauf, nicht für den
Speicher. Die Zeit der 40-Zyklen-Speicherzugriffe ist vorbei; die Zeit der Sortierung beginnt.

**Festlegung — Line-OAM-Tiefe 16:**

| Posten | Zyklen |
|---|---|
| Scan: 16 × (3 + 2) | 80 |
| Z-Sort: 16² / 2 | 128 |
| **Summe** | **208 von 269 → 61 Zyklen Reserve** |

Ein ungepacktes Layout (16-Bit-Felder, 9 Zyklen/Objekt) käme auf 144 + 128 = **272** — über
Budget. Das Packen ist damit keine Optimierung, sondern **Voraussetzung**.

**Folgen für die Beschlüsse aus §10:**
* **E-6 (Y-Bucket)** bleibt entschieden und zwingend — unverändert.
* **E-7 (Sortierverfahren)** rückt von „offen, klein" auf **die nächste Engstelle**. Wer über
  16 Objekte hinaus will, muss den Z-Sortierer ersetzen (Bucket bzw. Einsortieren in ein
  vorsortiertes Array), nicht den Scanner beschleunigen.
* Die frühere Fallback-Zeile „Objekte/Zeile @ 162 MHz ≈ 20" **entfällt** — sie war nur die
  Konsequenz daraus, den Scan im PSRAM zu halten.

**Nebenwirkung (neu, §10 E-11):** Liegen die Deskriptoren im BSRAM, muss die **CPU** sie dort
aktualisieren, wenn sie ein Objekt anlegt oder bewegt — der Scanner liest denselben Block.
Das braucht eine Regel (Ping-Pong über zwei Bänke, oder CPU schreibt nur im V-Blank, §7.2).

**Entlastung für §6.2:** Der Scan liest nur Metadaten und die jetzt im BSRAM — über das
PSRAM läuft nur noch das Pixel-Streaming. Das macht die PSRAM-Zugriffe lang und sequenziell
und ist der Grund, warum §6.2 neu gerechnet werden konnte.

### 4.5 Memory-Arbitration (Neu, offen)

In Phase B liest der GCoP per Burst aus dem PSRAM, während die Deep16-Haupt-CPU weiterläuft.
Die Tang-Nano-9K-PSRAM ist **einzelportig**. Es ist daher zwingend festzulegen:

* Wer bekommt bei Kollision Vorrang – CPU oder GCoP?
* Wird der GCoP hart präemptiert (Pixelverlust) oder per Warteschlange verzögert?
* Was kostet das die CPU-Durchsatzrate?

Ohne diese Regel ist §6 nicht belastbar, weil jede Budgetrechnung eine CPU-Ruhigannahme
trägt. **Diese Frage ist vor dem RTL-Entwurf zu beantworten (E-1).**

---

## 5. Palette: Betriebsmodi und Palettengruppen (Neu gefasst)

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

### 5.1 Palettengruppen-Struktur (pro Zeile ein Gruppen-Zeiger)

Die Kernaussage: **Jede Objektzeile hat einen eigenen Palettengruppen-Zeiger**, und eine
Gruppe besteht aus **einem Paletten-Zeiger pro 16 Pixel** (horizontal).

```
Objektzeile (z. B. 640 Pixel breit)
├── Wort 0x06 → Palettengruppen-Basis (Index in BSRAM)
│   └── Palettengruppe = 40 Zeiger à 6 Bit (640 / 16)
│       ├── Zeiger 0  → Palette für Pixel   0–15
│       ├── Zeiger 1  → Palette für Pixel  16–31
│       ├── ...
│       └── Zeiger 39 → Palette für Pixel 624–639
```

**Speicherbedarf:**

| Parameter | Wert |
|-----------|------|
| Objektbreite (max) | 640 Pixel |
| Granularität | 16 Pixel |
| Paletten-Zeiger pro Zeile | **40** |
| Paletten im BSRAM (1 Block = 1024×16) | **64** à 16 Farben |
| Bits pro Paletten-Zeiger | **6 Bit** (0–63) |
| Speicher pro Zeile (Paletten-Zeiger) | 40 × 6 Bit = **240 Bit = 15 Worte** |

**Wo stehen die 15 Worte pro Zeile?** Nicht im Objekt-Segment – sie liegen als
**Paletten-Pointer-Cache** im BSRAM und werden während H-Blank für die *aktiven* Zeilen
nachgeladen (Y-Bucket liefert die aktiven Objekte, §1.1). Der Cache fasst 16 Objekte × 40
Zeiger = 640 Zeiger = 320 Einträge à 16 Bit → **< 1 BSRAM-Block**.

**Kostenbewertung `PER_16PX`:** Bei W = 640 entfallen 1280 Byte Palette auf 320 Byte
Pixeldaten – die Palette ist **viermal so groß wie das Bild**. Das ist der Grund, warum dieser
Modus als Extremfall dokumentiert, aber nicht als Ziel geführt wird.

---

## 6. Ressourcen- & Machbarkeits-Check (Tang Nano 9K)

### 6.1 Logik und BSRAM

* **LUT4:** Der GCoP (Mikrocode-Decoder, Adress-Shifter, Alpha-Tester, Skalierer) wird mit
  ca. 1.200–1.500 LUTs angesetzt (~17 % der 8.640 LUTs).
  > **Zu prüfen:** Diese Schätzung stammt aus der Erstfassung und umfasst **weder** das
  > Line-OAM-Array **noch** den Z-Sortierer. Beide sind LUTRAM bzw. Logik und dürfen den
  > Aufpreis nicht ignorieren. Erneute Schätzung nach dem RTL-Entwurf nötig.
  > *Neu (§4.4, 2026-10-12):* Mit den Deskriptoren im BSRAM liegt die Objektzahl bei bis zu
  > **16** je Zeile. Das Line-OAM wächst auf 16 Einträge à ~5 Wörtern (~640 FF, LUTRAM/
  > Distributed RAM). Der Z-Sortierer wächst analog (n²/2: **128** statt 24 Vergleiche bei
  > n = 16) und ist jetzt die **zweite Engstelle** im H-Blank-Budget. Die LUT-Schätzung von
  > 1.200–1.500 ist damit wieder offen — der Sortierer ist der teuerste Einzelposten und
  > braucht eine eigene Schätzung nach dem RTL-Entwurf.
* **BSRAM:**
  * Mikrocode-ROM: 1 Block.
  * **OAM (Objekt-Deskriptoren): 1 Block.** Gepackt 3 Worte à 32 Nutzbits je Objekt (§4.4)
    → im Modus `512×36` rund **170 Objekte**. Die CPU schreibt diesen Block, der Scanner
    liest ihn (offene Nebenwirkung, §10 E-11).
  * Line-Buffer: 2 × 640 Wörter à 16 Bit RGB565 = 2 × 10.240 Bit. Ein 18-Kbit-BSRAM-Block
    fasst das **mehrfach**; die Angabe „2 Blöcke" ist also konservativ und unkritisch.
  * Paletten-RAM (`GLOBAL`-Modus): 32 Worte pro Palette, mehrere Paletten in einem Block.
  * Paletten-Pointer-Cache (§5.1): 16 Objekte × 40 Zeiger = 640 Zeiger = 320 Einträge à 16 Bit
    → **< 1 BSRAM-Block**. Wird während H-Blank für aktive Zeilen nachgeladen.
  * Verbleibende Blöcke für Stack, Cache, Bootloader.

### 6.2 Speicherbandbreite (mit Burst-Effizienz, neu gerechnet am 2026-10-12)

Zwei Korrekturen gegenüber der Erstfassung. Erstens: **324 MB/s sind eine Spitze, keine
verfügbare Bandbreite.** Gowins IP-Datenblatt (IPUG943E) nennt für die PSRAM-IP die
Burst-**Effizienz**:

| Burst-Länge | Effizienz | effektiv bei 324 MB/s Spitze |
|---|---|---|
| 128 Byte | 74 % | **240 MB/s** |
| 64 Byte | 61 % | 198 MB/s |
| 32 Byte | 44 % | 143 MB/s |

Kürzere Bursts sind nicht tabelliert; darunter fällt die Effizienz weiter. Die Erstfassung
rechnete mit **100 %**.

Zweitens: **was überhaupt noch über das PSRAM läuft, hat sich geändert.** Mit OAM im BSRAM
(§4.4) und dem Paletten-Pointer-Cache im BSRAM (§5.1) trägt die PSRAM **nur noch
Pixeldaten**. Objektköpfe, Palettenzeiger und Sortierdaten konkurrieren nicht mehr. Der
Zugriff ist damit **lang und sequenziell** — die beste Effizienzklasse. Die Aufteilung
`GLOBAL` / `PER_16PX` (§5) wirkt sich auf das PSRAM **nicht mehr** aus; sie kostet nur noch
BSRAM-Zeiger.

Bedarf je Zeile (17,24 µs Active Video), 4 Bit/Pixel, 4 Pixel je 16-Bit-Wort:

| Szenario | Wörter/Zeile | MB/s | @ 143 (44 %) | @ 198 (61 %) | @ 240 (74 %) |
|---|---|---|---|---|---|
| 7 × 640 px — Worst-Case, volle Überdeckung | 1.120 | 130 | 91 % | 66 % | **54 %** |
| 7 × 320 px | 560 | 65 | 45 % | 33 % | 27 % |
| 7 × 160 px | 280 | 33 | 23 % | 16 % | 14 % |
| 7 × 80 px — typisch | 140 | 16 | 11 % | 8 % | 7 % |

Wörter/Zeile = 7 Objekte × ⌈W/4⌉. Der teuerste Fall (7 × 640) fährt **320-Byte-Bursts je
Objekt** und liegt damit in der **74-%-Klasse**: 130 / 240 = **54 %**. Kleine Sprites holen
kürzere Bursts (7 × 80 px = 40 Byte = 44-%-Klasse), bewegen aber so wenig, dass es nicht
trägt.

**Befund:** Mit den Deskriptoren im BSRAM ist die PSRAM **nicht** der Engpass. Der
Worst-Case liegt bei **54 %** der effektiven (74 % der Spitzen-)Bandbreite, typische
Szenarien bei **7–14 %**. Das ist derselbe Schluss wie in der Erstfassung — aber jetzt mit
abgeleiteter statt angenommener Effizienz, und die 137-%-Zeile entfällt ersatzlos, weil 16
gleichzeitige Objekte nach §4.4 gar nicht erreichbar sind.

**Prämissen, an denen die Zahlen hängen — beide unbelegt:**

1. **162 MHz.** Die PSRAM-Dies sind mit 166 MHz (CL3) spezifiziert, aber das Gowin-IP sagt
   selbst *„the actual maximum frequency may vary depending on the performance of the FPGA
   device"*. Ein quelloffener 1:1-Controller für genau diese Platine (`GW1NR-LV9QN88PC6/15`)
   erreicht nur ~83 MHz; 162 MHz verlangt die Gowin-IP mit 1:2-Getriebe. **Fällt der Takt,
   skaliert diese Tabelle linear** — bei 83 MHz wäre der Worst-Case über 100 %.
2. **74 %.** Gilt nur für durchgehende ≥128-Byte-Bursts. Ein Zeilensprung oder ein
   Sprite-Split kostet Effizienz; bei 32-Byte-Bursts steht man bei 44 % (91 % im Worst-Case).

Der Wert ist **ohne CPU-Anteil** gerechnet. Sobald die Deep16-CPU parallel mitliest oder
schreibt (§4.5), ist er die harte Obergrenze, aus der die CPU-Politik (E-1) abgeleitet
werden muss.

### 6.3 Zusammenfassung der Machbarkeit

| Punkt | Bewertung |
|---|---|
| Grundkonzept (Beam-Racer, objektbasiert) | tragfähig |
| **Bandbreite – auch absoluter Worst-Case** | **unauffällig (54 % im Extremfall bei 74 % Burst-Effizienz, 7–14 % real)** – hängt an 162 MHz und 74 % (beide unbelegt) |
| OAM-Scan @ CPU-Takt | **bis 16 Objekte (Line-OAM 16)**; der **Z-Sortierer** ist die zweite Engstelle (§4.4) |
| Logikbedarf | Schätzung offen; mit 16 Objekten ist der Z-Sortierer der teuerste Einzelposten (§6.1) |
| Non-executable Video-RAM | löst Port-Aufteilung + Fehlerklasse (§2.4), vor GFX landbar |
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

### 9.2 Port-Aufteilung der PSRAM (durch §2.4 möglich gemacht)

Die On-Chip-Matrix versorgt heute **drei Read-Ports und einen Write-Port** aus einem einzigen
Array (`rtl/deep16_top.sv:92-102`): `if_rdata` (Fetch), `mem_rdata` (Daten), `vec_rdata`
(SWI-Vektor, Konstante `0x0002`) und der Store. Eine **einzelportige** PSRAM kann das nicht.

Mit dem non-executable Video-RAM (§2.4) zerfällt das in zwei Bänke mit **unterschiedlichen
Zugriffsmustern**:

| Bank | Konsumenten | Bedarf | Bemerkung |
|---|---|---|---|
| Haupt-RAM | CPU-Fetch, CPU-Daten | 2R + 1W | Durch den **unified Cache** (VERILOG.md Phase 3, noch nicht gebaut) auf Treffer abgedeckt; die PSRAM sieht nur Fehlzugriffe. |
| Video-RAM | GCoP (Read), CPU (Write) | 1R + 1W | **Zeitlich disjunkt:** CPU schreibt nur im V-Blank (666,7 µs, §1.1), der GCoP liest in H-Blank + Active Video. |

Der eigentliche Gewinn liegt in der letzten Zeile: Weil sich Schreib- und Lesezugriffe
**zeitlich nie überlappen**, genügt für den Video-Bank **ein einziger physischer Port ohne
Arbitration und ohne FIFO**. Genau das bedient eine einzelportige PSRAM von Haus aus.

**Was das nicht löst:** Der Haupt-Bank bleibt bei 2R + 1W und braucht den Cache – NX verkleinert
die **Video**-Last, nicht die Haupt-Last. Ebenso ist die Regel „Video-RAM ist schreib-only"
tragend; wird sie verletzt, konkurrieren CPU- und GCoP-Reads wieder um denselben Port
(§2.4).

### 9.3 Weitere Voraussetzungen

* Takt- und Reset-Strategie für den Betrieb ohne On-Board-Speicher-Array.
* Debug-Zugang (JTAG/UART über `0xF0040`) für Bildschirmausgaben während der Fehlersuche.
* **Reihenfolge im Fetch-Pfad:** Ein späterer unified Cache muss **hinter** der NX-Prüfung
  liegen. Andernfalls bleiben zwischengespeicherte Zeilen aus dem Videobereich ausführbar und
  die Prüfung wäre nachträglich nur schwer einzuziehen. Diese Reihenfolge ist jetzt zu fixieren,
  obwohl der Cache noch nicht existiert.

---

## 10. Offene Entscheidungen

| ID | Frage | Blockiert |
|---|---|---|
| **E-1** | Memory-Arbitration CPU ↔ GCoP: Vorrang, Preemption, CPU-Kosten (§4.5) | Bandbreiten-Budget, RTL |
| **E-2** | Grafikbus auf 22 Bit erweitern oder bei 2 MB bleiben (§2.1)? | Adresskonzept |
| **E-3** | Clock-Domain-Crossing-Protokoll für das Line-OAM (§3) | RTL |
| **E-4** | Hintergrundfarbe und Vorbelegung des Line-Buffers (§4.2) | Bildqualität |
| **E-5** | Textmodus-Strategie FPGA ↔ JS-Emulator (§8) | Kompatibilität, UI |
| **E-6** | ~~Max. Objektzahl fest 16 oder Y-Bucket-Index vorsehen?~~ → **entschieden: Y-Bucket-Index ist zwingend** — mit Deskriptoren im BSRAM erlaubt 4,98 µs jetzt bis zu 16 Objekte (§4.4) | erledigt |
| **E-7** | Z-Sortierung: Bubble oder Auswahl-Sortierung; **seit dem BSRAM-OAM die nächste Engstelle** — 128 von 269 Zyklen bei n = 16 (§4.4) | Timing-Budget |
| **E-8** | NX-Mechanismus: base+limit gegen NX-Bit je Segment (§2.2 zeigt: Segmente sind überlappende 128-KB-Fenster) | Fetch-Pfad |
| **E-9** | Video-Bank-Anbindung: ein Port ohne FIFO (nur bei strikt schreib-only-Regel) oder FIFO/Portdopplung für Ausnahmen (§2.4, §9.2) | PSRAM-Controller |
| **E-10** | Kollisionsdetektion und ähnliche Lesefälle: Kopie im Haupt-RAM statt Rücklesen aus Video-RAM (§2.4) | API-Form |
| **E-11** | CPU ↔ OAM im BSRAM: Schreibregel, solange der Scanner denselben Block liest (Ping-Pong-Bänke oder CPU schreibt nur im V-Blank) (§4.4) | RTL, Konsistenz |

Nächster sinnvoller Schritt ist **nicht** die Ausarbeitung des Mikrocode-Worts. Es sind
diese drei, in dieser Reihenfolge:

1. **§2.4 / E-8** – NX für den Textpuffer bei `0xF1000`, unabhängig von GFX und vor dem
   PSRAM-Umbau machbar. Damit ist der Fetch-Pfad geprüft, bevor eine PSRAM-Plattform existiert.
2. **§9.1** – PSRAM-Umsetzung der Haupt-CPU. Ohne externen Hauptspeicher gibt es keine
   FPGA-Instanz, auf der eine Grafik-Engine laufen könnte.
3. **E-1** – Arbitration-Politik, sobald die Aufteilung aus §9.2 steht.