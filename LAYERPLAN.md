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
• 1.1 bios_f4 (getch) non-blocking machen:
	• Aktuell pollt uart_getch_wait / bios_getch_wait endlos auf CONSOLE_STATUS (I=0).
	• Neu: SWI 4 (getch_nb) prüft CONSOLE_STATUS einmalig. Liegt kein Zeichen an, kehrt es sofort mit R0 = 0xFFFF (oder Carry=1) zurück; sonst liefert es das Zeichen in R0. Die blockierende Warteschleife wandert nach Forth (word_key) bzw. ins BDOS.
• 1.2 uart_mirror non-blocking machen oder per TX-FIFO/Polling im BDOS lösen:
	• Aktuell wartet uart_mirror_wait aktiv, bis TX-Ready (Bit 1 von 0xF0040) frei ist.
	• Neu: SWI 2 (putch_nb) schreibt nur, wenn TX-Ready gesetzt ist, und gibt Status 1 = gesendet / 0 = busy zurück. Das Polling bei vollem TX-FIFO übernimmt der Aufrufer (BDOS/Forth mit I=1).
• 1.3 ps2_init / ps2_send (SWI 7/8) aus dem BIOS ins BDOS verlagern:
	• ps2_init wartet aktuell bis zu mehrere Sekunden (ps2_wait_ticks, ps2_wait_frame) bei deaktivierten Interrupts.
	• Neu: Das BIOS stellt nur noch non-blocking GPIO/PS2-Control-Primitiven bereit (z. B. SWI 7: Takt/Datenleitung setzen bzw. Status 0xF0066 lesen). Die komplette Initialisierungs- und Timeout-Statemachine (ps2_init) wandert ins BDOS, wo sie mit I=1 laufen darf.
• 1.4 ILL-Handler und BIOS-Variablen isolieren (wie zuvor geplant):
	• udiv16, sdiv32, udiv und div16_call wandern ins BIOS (rein rechnerisch, deterministisch, ohne I/O-Warten).
	• Alle BIOS-Zustandsvariablen (gs_active, gs_ptr, tile_row, tile_col, out_col, text_attr usw.) wandern in ein eigenes BIOS-Datensegment (0x5700+), und das BIOS sichert R4–R12 selbstständig.

Schritt 2: Atomare, nicht-blockierende SPI- & UART-Primitiven im BIOS

Statt eines blockierenden 4-KB-Flash-Readers bekommt das BIOS nur noch registerbasierte, sofort zurückkehrende SPI-Funktionen:
• SWI 13 (spi_ctrl): Setzt Chip-Select (CS1 assert/release) und Teiler (SPDIV in 0xF0080 / 0xF0086) ohne Warten.
• SWI 14 (spi_start): Schreibt ein Byte in SPI_DATA (0xF0084) und stößt den Transfer an (kehrt sofort zurück).
• SWI 15 (spi_poll): Liest SPI_STAT (0xF0082). Wenn Busy-Bit = 0, wird das empfangene Byte aus SPI_DATA in R0 zurückgegeben (R1 = 1); wenn noch beschäftigt, kehrt es sofort mit R1 = 0 zurück.
• SWI 16 (uart_rx_nb): Liest ein Byte aus dem UART (0xF0040/0xF0042), falls bereit (R1 = 1), sonst sofort R1 = 0.
• SWI 17 (constat): Prüft einmalig, ob ein Konsolenzeichen bereitliegt (R0 = 1 oder 0).
• SWI 18 (set_echo / get_echo): Liest/setzt das BIOS-interne Echo-Flag.
• SWI 19 (tile_blit_row): Schreibt 80 Zeichen in die Tilemap (reiner Speicher-Copy ohne Hardware-Polling, daher deterministisch und extrem kurz).

Schritt 3: BDOS als Interrupt-freundliche (I=1) Polling- & Treiberschicht

Das BDOS läuft per Far-Call (JML) im normalen Kontext (I=1). Hier finden ab sofort alle Schleifen statt, die auf Hardware warten müssen:
• 3.1 BDOS-SPI-Transfer (bdos_spi_xfer):
	• Ruft SWI 14 (spi_start) auf und pollt anschließend SWI 15 (spi_poll) in einer Schleife mit I=1. Timer-, Raster- und Audio-IRQs können während jedes SPI-Bytes problemlos feuern.
• 3.2 BDOS-Slice-Reader (bdos_read_slice) & Dateisystem:
	• bdos_dir (Funktion 1), bdos_lookup (Funktion 2), bdos_load (Funktion 3) und die neue Funktion bdos_load_source (Funktion 4) nutzen ausschließlich SWI 13–15.
	• Damit ersetzt das BDOS gleichzeitig slice_read und Forth's cf_burst_code.
• 3.3 BDOS-Block-UART-Reader (bdos_serial_read, Funktion 5):
	• Übernimmt die Logik von word_serialread (XMODEM-Paare lesen, Abbruch bei PS/2-Taste), nutzt dafür aber SWI 16 (uart_rx_nb) und SWI 17 (constat) im I=1-Kontext.
• 3.4 BDOS-PS/2-Init (bdos_ps2_init, Funktion 6):
	• Führt den Reset- und Timeout-Handshake für die PS/2-Tastatur über die non-blocking BIOS-GPIO-Calls aus, ohne während der 300-ms-Wartezeiten die Interrupts zu sperren.

Schritt 4: Forth-Kernel auf BDOS & Non-Blocking BIOS umstellen

• key (word_key): Ruft SWI 4 (getch_nb) in einer kleinen Forth-Schleife auf, bis ein Zeichen kommt (läuft mit I=1).
• key? (word_keyq): Ruft SWI 17 (constat) auf.
• emit / put_char: Ruft SWI 2 (putch_nb) auf (bei busy wird kurz wiederholt, weiterhin mit I=1).
• serial-read: Delegiert direkt an BDOS Funktion 5 (bdos_serial_read).
• boot_script (forth/boot.fth): Nutzt ausschließlich BDOS Funktion 2 (lookup) und Funktion 4 (load_source) zum Laden von essentials und edit. Sämtliche direkten 0xF0080- und 0xF0040-Zugriffe verschwinden aus Forth.

Übersicht der neuen Aufruf- und Interrupt-Garantien

1. Keine I=0-Warteschleifen mehr: Jede SWI-Routine hat eine feste, kurze Obergrenze an Taktzyklen (kein Warten auf langsame Peripherie).
2. Kein Hardware-Durchgriff von oben: Weder Forth noch BDOS enthalten noch eine einzige MMIO-Adresse (0xF0000–0xF6FFF).
3. Strikte Einbahnstraße:
	• Forth ruft BDOS (für Files, Burst-I/O, PS/2-Init) und BIOS (für schnelle non-blocking Status-/I/O-Calls).
	• BDOS ruft ausschließlich BIOS (SWI).
	• BIOS ruft niemanden oberhalb auf und kennt keine Forth-Variablen.
Sollen wir mit Schritt 1 beginnen und ich zeige dir konkret, wie bios_f2 (putch_nb), bios_f4 (getch_nb) und der isolierte ill_handler im BIOS-Teil von forth_nano.asm umgebaut werden?
