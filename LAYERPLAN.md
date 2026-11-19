Diese Hardware-Restriktion ist ein entscheidender architektonischer Punkt: Da SWI auf dem Deep16-Kern mit gesetztem Supervisor-Bit und deaktivierten Interrupts (I=0) läuft, würde jede blockierende Schleife im BIOS (wie Warten auf SPI-Flash, UART oder PS/2-Polling) Timer-, Raster- und Audio-IRQs einfrieren – was auf dem FPGA-Board zu Audio-Aussetzern oder verpassten Raster-Splits führt.
Aus dieser Restriktion ergibt sich eine saubere, strikte Rollentrennung zwischen BIOS und BDOS:
• BIOS (HAL, SWI mit I=0): Ausschließlich atomare, nicht-blockierende Primitiven (Register lesen/schreiben, ein Byte abholen/senden, Status prüfen, einen Transfer anstoßen). Alle Warteschleifen und Pollings verschwinden aus dem BIOS.
• BDOS (Systemschicht, läuft im normalen User-Kontext mit I=1): Übernimmt sämtliche Polling-Schleifen, Timeouts und Block-Transfers auf Basis der non-blocking BIOS-Calls. Da das BDOS per Far-Call (JML) im normalen Kontext (I=1) läuft, bleiben Hardware-Interrupts während Flash-Ladevorgängen oder seriellen Transfers voll aktiv.
Hier ist der angepasste Refactoring-Plan unter dieser Non-Blocking-Restriktion:

Ziel-Architektur (Non-Blocking BIOS + Interrupt-fähiges BDOS)


Schicht	Kontext & Interrupts	Verantwortung	Darf aufrufen
3. Forth-Kernel	Normal (I=1)	REPL, Compiler, Dictionary, High-Level-Wörter	BDOS (für blockierende/mehrstufige I/O- & Datei-Operationen) & BIOS (für atomare Status-/Einzelbyte-Calls)
2. BDOS	Normal (I=1, per JML)	Dateisystem (Slices, Lookup, Loader) sowie alle Polling-/Warteschleifen (Flash-Burst, Block-Read, Line-Input, PS/2-Init)	BIOS (nur non-blocking SWI-Primitiven)
1. BIOS / HAL	Supervisor (I=0, per SWI)	Ausschließlich nicht-blockierende Hardware-Zugriffe, Trap-Emulation (ILL) & ISRs (IRQ)	Nur eigene non-blocking Subroutinen & MMIO-Register


Schritt 1: Bestehende blockierende Schleifen aus dem BIOS entfernen

Zuerst müssen nicht nur die Forth-Abhängigkeiten, sondern auch alle vorhandenen Warteschleifen im BIOS eliminiert werden, die heute I=0 blockieren:
• 1.1 bios_f4 (getch) non-blocking machen: **erledigt 2026-11-18.**
	• Früher pollten uart_getch_wait / bios_getch_wait endlos auf CONSOLE_STATUS (I=0).
	• Jetzt prüft SWI 4 (getch_nb) CONSOLE_STATUS einmalig. Liegt kein Zeichen an, kehrt es sofort mit R0 = 0xFFFF zurück; sonst liefert es das Zeichen in R0. Die Warteschleife liegt in word_key und läuft mit I=1. Umgesetzt in `forth_nano.asm` und `forth.asm`; Tests decken den Idle-Fall und den normalen `key`-Pfad ab.
• 1.2 uart_mirror non-blocking machen oder per TX-FIFO/Polling im BDOS lösen: **1.2a, 1.2b (D16D) und der D16MINI-UART-Build erledigt 2026-11-18.**
	• Aktuell wartet uart_mirror_wait aktiv, bis TX-Ready (Bit 1 von 0xF0040) frei ist.
	• Neu: SWI 2 (putch_nb) schreibt nur, wenn TX-Ready gesetzt ist, und gibt Status 1 = gesendet / 0 = busy zurück. Das Polling bei vollem TX-FIFO übernimmt der Aufrufer (BDOS/Forth mit I=1).
	• 1.2a: Das BIOS bietet jetzt `uart-ready` (D16D: SWI 13, UART: SWI 6) und `put_char` pollt es mit I=1, bevor es f2 aufruft.
	• 1.2b: Auf D16D spiegeln `bios_f1` (binit), `bios_f3` (putstr) und das `getstr`-Echo nicht mehr in die UART; `put_char` übernimmt den Mirror nach dem Ready-Poll.
	• 1.2c (D16MINI-UART): `bios_f5` ist jetzt eine non-blocking RX-Pumpe (Teilzeile in `gs_active`/`gs_ptr`, Rückgabe 0/1). `read_uart_line` pollt sie mit I=1, `echo_line` sendet den Puffer-Delta über `put_char` (inkl. `BS SP BS`). `bios_f1`/`bios_f3` sind Dispatch-Stubs; `console_clear` und `bios_putstr_direct` drucken über `print_text`. Tests: `tests/uart-kernel.test.js` (Banner, Echo, Backspace, Definition, `accept`, `refill`).
• 1.3 ps2_init / ps2_send (SWI 7/8) aus dem BIOS ins BDOS verlagern: **erledigt 2026-11-18.**
	• ps2_init wartet aktuell bis zu mehrere Sekunden (ps2_wait_ticks, ps2_wait_frame) bei deaktivierten Interrupts.
	• Umgesetzt: `bios_f7` bleibt der bitweise Sender (ein Frame ist durch den Tastaturtakt begrenzt); `bios_f8` ist jetzt ein non-blocking Status/Timer-Snapshot. Die Reset-/ACK-/BAT-/Enable-Statemachine läuft als BDOS-Funktion 9 in `bdos_ps2_init` (0x1F78) mit I=1. `binit` ruft sie nicht mehr auf; der Kernel ruft BDOS 9 nach `binit` und vor Menü/Banner. Tests: `tests/ps2-bios.test.js`, `tests/segmented.test.js`.
• 1.4 ILL-Handler und BIOS-Variablen isolieren (wie zuvor geplant): **erledigt 2026-11-18.**
	• udiv16, sdiv32, udiv und div16_call sind als BIOS-Kopien vorhanden (0x5550 bzw. 0x578F); der ILL-Handler läuft über einen Trampolin (0x4D24) in der BIOS-Kopie (CS=0x3000, Offset 0x600) und ruft diese Kopien. Die Forth-Aufrufstellen sind auf die BIOS-SWIs 14/15 umgestellt (Rückfall auf die Kernel-Kopien nur für Nicht-D16D-Builds); f16 war der ungenutzte udiv-Stub und ist seit 2026-11-19 `constat`.
	• Alle BIOS-Zustandsvariablen (gs_active, gs_ptr, tile_row, tile_col, out_col, text_attr usw.) wandern in ein eigenes BIOS-Datensegment (0x5700+), und das BIOS sichert R4–R12 selbstständig.
	• Befund 2026-11-18: Der ILL-Umzug, die Divisions-SWIs 14–15 und der Zustandsumzug sind umgesetzt. Die Zellen liegen im gemeinsamen BIOS-Block 0x5790 (gültig ab 0x4A00 und 0x5600); der Kernel liest/schreibt `out_col`, `tile_off` und `gs_active` über die Accessoren f17–f19. Beim ersten Anlauf schrieb der ANSI-Parser `out_esc` noch über DS, während er es über CS las, sodass ESC-Sequenzen als Glyphen im Tilemap landeten; die Stores sind jetzt CS. BIOS-Funktionszahl: 23 (f16 dient seit 2026-11-19 als `constat`).

Schritt 2: Atomare, nicht-blockierende SPI- & UART-Primitiven im BIOS

**Stand 2026-11-19: f20 `spi_ctrl`, f21 `spi_start`, f22 `spi_poll` sind umgesetzt** (Tests: `tests/spi-bios.test.js`). Die ursprüngliche Nummerierung 13–19 kollidierte mit UART-ready, Division und den Zustands-Accessoren; die neuen Funktionen liegen deshalb bei 20–22. `uart_rx_nb`/`constat` sind durch f4/getch und f13/6 weitgehend abgedeckt; Echo- und Tile-Blitting-Primitiven bleiben offen.

Statt eines blockierenden 4-KB-Flash-Readers bekommt das BIOS nur noch registerbasierte, sofort zurückkehrende SPI-Funktionen:
• SWI 13 (spi_ctrl): Setzt Chip-Select (CS1 assert/release) und Teiler (SPDIV in 0xF0080 / 0xF0086) ohne Warten.
• SWI 14 (spi_start): Schreibt ein Byte in SPI_DATA (0xF0084) und stößt den Transfer an (kehrt sofort zurück).
• SWI 15 (spi_poll): Liest SPI_STAT (0xF0082). Wenn Busy-Bit = 0, wird das empfangene Byte aus SPI_DATA in R0 zurückgegeben (R1 = 1); wenn noch beschäftigt, kehrt es sofort mit R1 = 0 zurück.
• SWI 16 (uart_rx_nb): Liest ein Byte aus dem UART (0xF0040/0xF0042), falls bereit (R1 = 1), sonst sofort R1 = 0.
• SWI 17 (constat): Prüft einmalig, ob ein Konsolenzeichen bereitliegt (R0 = 1 oder 0).
• SWI 18 (set_echo / get_echo): Liest/setzt das BIOS-interne Echo-Flag.
• SWI 19 (tile_blit_row): Schreibt 80 Zeichen in die Tilemap (reiner Speicher-Copy ohne Hardware-Polling, daher deterministisch und extrem kurz).

Schritt 3: BDOS als Interrupt-freundliche (I=1) Polling- & Treiberschicht

**Stand 2026-11-19: 3.1/3.2 für den D16SEG-Build umgesetzt.** `spi_put`/`spi_get` rufen im gesegmentierten Build BIOS f21 (`spi_start`) und f22 (`spi_poll`) und pollen mit I=1; `dir_read`, `bdos_lookup` und `bdos_load` lesen dadurch ihre Slices über die BIOS-Primitiven. Der flache Simulationsbuild behält den direkten SPI-Pfad, weil er die BIOS-Kopie nicht scattert. `cf_burst` bleibt als schneller Kernel-Pfad für das Boot-Skript; **3.3 (serial-read) ist umgesetzt**: die Forth-Wortdefinition an 0x4400 übergibt `addr`/`pairs` an BDOS-Funktion 10, der Pair-Reader läuft im BDOS. 3.4 (PS/2-Init) war bereits erledigt.

Das BDOS läuft per Far-Call (JML) im normalen Kontext (I=1). Hier finden ab sofort alle Schleifen statt, die auf Hardware warten müssen:
• 3.1 BDOS-SPI-Transfer (bdos_spi_xfer):
	• Ruft SWI 14 (spi_start) auf und pollt anschließend SWI 15 (spi_poll) in einer Schleife mit I=1. Timer-, Raster- und Audio-IRQs können während jedes SPI-Bytes problemlos feuern.
• 3.2 BDOS-Slice-Reader (bdos_read_slice) & Dateisystem:
	• bdos_dir (Funktion 1), bdos_lookup (Funktion 2), bdos_load (Funktion 3) und bdos_read_slice (Funktion 11) nutzen ausschließlich die BIOS-SPI-Primitiven.
	• bdos_read_slice kopiert eine 4-KiB-Quellenscheibe in den Puffer des Aufrufers und stellt DS/ES wieder her; `bdos-slice` ist der Forth-Einstieg.
• 3.3 BDOS-Block-UART-Reader (bdos_serial_read, Funktion 5):
	• Übernimmt die Logik von word_serialread (XMODEM-Paare lesen, Abbruch bei PS/2-Taste), nutzt dafür aber SWI 16 (uart_rx_nb) und SWI 17 (constat) im I=1-Kontext.
• 3.4 BDOS-PS/2-Init (bdos_ps2_init, Funktion 6):
	• Führt den Reset- und Timeout-Handshake für die PS/2-Tastatur über die non-blocking BIOS-GPIO-Calls aus, ohne während der 300-ms-Wartezeiten die Interrupts zu sperren.

Schritt 4: Forth-Kernel auf BDOS & Non-Blocking BIOS umstellen

• key (word_key): Ruft SWI 4 (getch_nb) in einer kleinen Forth-Schleife auf, bis ein Zeichen kommt (läuft mit I=1). **Umgesetzt.**
• key? (word_keyq): Ruft SWI 16 (constat) auf. **Umgesetzt 2026-11-19**; dabei wurde der Gfx-Rückweg korrigiert: `gfx_back`/`gfx_none` holen TIB jetzt CS-relativ aus `bios_gfx_r6` statt über DS.
• emit / put_char: Ruft SWI 2 (putch_nb) auf (bei busy wird kurz wiederholt, weiterhin mit I=1). **Umgesetzt: `emit` geht über `put_char`.**
• serial-read: Delegiert direkt an BDOS Funktion 10 (bdos_serial_read). **Umgesetzt.**
• boot_script: **BDOS-Pfad implementiert, Board-Fallback aktiv (2026-11-19).** D16NANO hat mit `forth/boot-nano.fth` einen eigenen Loader. `bdos_read_slice` (BDOS-Funktion 11) und `bdos-slice` sind implementiert und getestet; auf dem Board korrumpiert der Read-Slice-Kopierpfad jedoch das frühe Dictionary, daher liest der Nano-Loader wieder über den bewährten `cf-burst`-Streamer. Der BDOS-Pfad bleibt für einen späteren Retry verfügbar. Der archivierte D16MINI-Loader behält ebenfalls `cf-burst`.

Übersicht der neuen Aufruf- und Interrupt-Garantien

1. Keine I=0-Warteschleifen mehr: Jede SWI-Routine hat eine feste, kurze Obergrenze an Taktzyklen (kein Warten auf langsame Peripherie).
2. Kein Hardware-Durchgriff von oben: Weder Forth noch BDOS enthalten noch eine einzige MMIO-Adresse (0xF0000–0xF6FFF).
3. Strikte Einbahnstraße:
	• Forth ruft BDOS (für Files, Burst-I/O, PS/2-Init) und BIOS (für schnelle non-blocking Status-/I/O-Calls).
	• BDOS ruft ausschließlich BIOS (SWI).
	• BIOS ruft niemanden oberhalb auf und kennt keine Forth-Variablen.
Schritt 1.1, 1.2a/b/c, 1.3 und 1.4 sind umgesetzt (2026-11-18). Der D16MINI-Build ist seit 2026-11-19 archiviert und wird nicht mehr gepflegt. Schritt 4 ist umgesetzt: `serial-read` liegt im BDOS, `emit` läuft über `put_char`, `key?` ruft BIOS f16 (`constat`). Der D16NANO-Bootloader nutzt vorerst `cf-burst`; der BDOS-Read-Slice-Pfad ist implementiert, wird auf dem Board aber noch nicht verwendet. Der Gfx-Rückweg wurde repariert: `gfx_back`/`gfx_none` luden TIB über DS statt über CS, was im Flat-Build nur zufällig funktionierte. `put_char` bewahrt jetzt R1–R3; im Build ohne `CONSOLE_MIRROR` hatte der UART-Zweig R2/R3 geklobbert und dem Boot-Skript den Quellzeiger zerstört (U-Flut). Ein D16SEG-Test ohne `CONSOLE_MIRROR` deckt den Board-Pfad ab.
