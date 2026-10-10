Hier ist ein kompaktes, architektonisches Design-Dokument für das Grafik-Subsystem der Deep16-Architektur, maßgeschneidert für die Umsetzung auf dem Sipeed Tang Nano 9K (Gowin GW1NR-9 FPGA).
------------------------------
## Design-Spezifikation: Deep16 Grafik-Subsystem (GCoP)
Projekt-Status: Design-Phase (FPGA-Target)
System-Architektur: 16-Bit Wort-adressiert (Hauptsystem) / 20-Bit Adressraum (Grafik)
Kern-Konzept: Framebuffer-lose, objektorientierte Grafik-Engine via mikroprogrammierter Spezial-CPU (GCoP – Graphics Co-Processor).
------------------------------
## 1. Systemübersicht & Display-Spezifikationen
Das System nutzt das Beam-Racer-Prinzip. Bilder werden in Echtzeit zeilenweise während des HDMI-Auswurfs generiert. Ein klassischer, permanenter Vollbild-Framebuffer entfällt.

* Target-Auflösung (Logisch): 640 x 360 Pixel (Exakt 16:9-Seitenverhältnis).
* Ausgabe-Auflösung (Physisch): 1280 x 720p (720p @ 60Hz) via HDMI.
* Skalierung: 2x2 Integer-Scaling (Perfekt verdoppelte Pixel ohne Unschärfe).
* Farbtiefe: 4 Bit pro Pixel (16 Indizes: 0x0 = Transparent, 0x1 bis 0xF = Palettenfarbe).
* Ausgabefarben: 16-Bit HighColor (RGB 565) via objekt-lokaler Paletten.

------------------------------
## 2. Speicher-Architektur & Segmentierung
Das Hauptsystem nutzt 16-Bit-Wortadressierung. Das Grafik-Subsystem greift über eine 20-Bit-Adressleitung auf den gesamten Speicher (inkl. des 64 Mbit PSRAMs des Tang Nano) zu.
## Segment-Adressierung (seg << 4)
Um Objektdaten kompakt zu halten, übergibt die Deep16-CPU dem GCoP für Grafikobjekte (Buffer) lediglich eine 16-Bit-Segmentadresse (seg). Die Hardware berechnet die physikalische 20-Bit-Adresse im RAM über festverdrahtete Bit-Shifts:
$$\text{Adresse}_{\text{20-Bit}} = (\text{seg} \ll 4) + \text{Wort-Offset}$$ 
Konsequenz: Jedes Grafikobjekt (Buffer) muss auf einer durch 16 Worte (32 Byte) teilbaren Adresse im RAM liegen. Ein Objekt umfasst zwingend mindestens 16 Worte.
## Layout eines Grafik-Objekts (Buffer-Segments)

+-------------------------------------------------------------+

| Wort 0x00: X-Position (16-Bit, vorzeichenbehaftet)          |
| Wort 0x01: Y-Position (16-Bit, vorzeichenbehaftet)          |
| Wort 0x02: Breite (in Pixeln)                               |
| Wort 0x03: Höhe (in Pixeln)                                 |
| Wort 0x04: Z-Position (0 = Hintergrund, 255 = Vordergrund)   |
| Wort 0x05: Flags (Bit 0: Aktiv, Bit 1-2: Interlacing Frame) |
| Wort 0x06: Lokaler Paletten-Offset                          |
| Wort 0x07 - 0x0F: Reserviert für System / Effekte           |
+-------------------------------------------------------------+

| Wort 0x10 - X: Lokale Zeilen-Paletten-Gruppen               |
| Jede Rasterzeile des Objekts hat (Breite/16) Farbzeiger     |
+-------------------------------------------------------------+

| Danach: 4-Bit gepackte Pixeldaten (4 Pixel pro 16-Bit Wort) |
+-------------------------------------------------------------+

------------------------------
## 3. Clock-Domain-Spezifikation (Taktdomänen)
Das System nutzt zwei Phasenregelschleifen (PLLs) des Gowin-FPGAs, gespeist vom 27 MHz Onboard-Quarz:

   1. clk_cpu (54 MHz): Treibt die Deep16-Haupt-CPU und das Speicher-Interface (Schreibseite).
   2. clk_pixel (74,25 MHz): Generiert das HDMI-Timing (H-Sync, V-Sync, Active Video).
   3. clk_hdmi_serial (371,25 MHz): 5-facher Pixeltakt im DDR-Modus (OSER10 Primitiven) zur TMDS-Serialisierung direkt an die HDMI-Pins.
   4. clk_psram (162 MHz): Takt für den Gowin-PSRAM-IP-Controller zur Bereitstellung der Pixeldaten.

------------------------------
## 4. Die Grafik-Spezial-CPU (GCoP)
Der GCoP ist ein dedizierter, mikroprogrammierter 20-Bit-Kern. Sein Kontrollfluss wird durch ein fest in den FPGA-Block-RAM (BSRAM) eingebranntes Mikrocode-ROM gesteuert.
## Phasenweiser Arbeitsablauf## Phase A: Horizontal Blanking (H-Blank) – Dauer: ~4,98 µs (370 Pixelclocks)
Während der HDMI-Strahl unsichtbar zur nächsten Zeile springt, arbeitet der GCoP im Kontrollfluss-Modus auf der CPU/Speicher-Taktung:

   1. OAM-Scan: Der GCoP durchläuft sequenziell die Liste der aktiven Grafiksegmente im RAM.
   2. Kollisionsprüfung: Liegt die nächste Zeile Y im Bereich $Y_{\text{pos}} \le Y < (Y_{\text{pos}} + \text{Höhe})$?
   3. Line-OAM Caching: Bis zu 16 gültige Treffer werden in ein internes, extrem schnelles Register-Array im FPGA (Distributed RAM) kopiert.
   4. Z-Sortierung: Die getroffenen Objekte werden anhand ihrer Z-Position von hinten nach vorne im Line-OAM priorisiert.

## Phase B: Active Video – Dauer: ~17,2 µs (1280 Pixelclocks)
Sobald die Zeile gezeichnet wird, schaltet der GCoP in den DMA/Streaming-Modus synchron zur Pixelclock:

   1. Der GCoP fordert die 4-Bit-Pixeldaten der gecachten Objekte via Burst-Read aus dem PSRAM an.
   2. Parallel lädt er den lokalen Paletten-Block des Objekts. Alle 16 horizontalen Pixel schaltet die Engine hart auf den nächsten geladenen Paletten-Zeiger um.
   3. Alpha-Blending & Transparenz:
   * Liest der Stream den Wert 0x0, bleibt der Pixel transparent (kein Schreibvorgang in den Line-Buffer).
      * Bei Werten 0x1 bis 0xF wird die entsprechende 16-Bit-Farbe (RGB 565) aus der objekt-lokalen Palette geladen und in den aktiven Line-Buffer geschrieben. Höhere Z-Werte überschreiben niedrigere Z-Werte.
   
------------------------------
## 5. Ressourcen- & Machbarkeits-Check (Tang Nano 9K)
Da das Mikroprogramm fest im BSRAM des FPGAs verankert ist, bleibt das Design extrem kompakt und effizient.

* Logikelemente (LUT4): Das GCoP-Design (inkl. Mikrocode-Decoder, Adress-Shifter und Alpha-Blender) benötigt ca. 1.200 bis 1.500 LUTs (ca. 17 % der verfügbaren 8.640 LUTs des Chips).
* Block-RAM (BSRAM):
* Das Mikrocode-ROM belegt genau 1 BSRAM-Block.
   * Der Line-Buffer (2x 640 Wörter für Ping-Pong-Wechselbetrieb) belegt 2 BSRAM-Blöcke.
   * Der Rest der 26 BSRAMs steht vollständig der Deep16-Haupt-CPU (Stack, Cache, Bootloader) zur Verfügung.
* Speicherbandbreite: Bei max. 16 Objekten pro Zeile reicht die Bandbreite des 162 MHz PSRAMs (ca. 324 MB/s) vollkommen aus, um die zeilenbasierten Grafik-Bursts latenzfrei in den Line-Buffer zu streamen.

Möchtest du für dieses Design als Nächstes die genaue Bit-Belegung des GCoP-Mikrocode-Worts (Befehlssatz-Architektur für den Grafik-Kern) definieren, oder sollen wir die Struktur des Verilog-Moduls für den Alpha-Blender ausarbeiten?

