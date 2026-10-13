* ArchRev: Sollten Loads die Flags setzen? Wie ist das üblicherweise?
* PSRAM
* Assembler: `include` - eine andere Datei an der aktuellen Stelle
  einziehen, damit forth.asm seine eigene Quelldatei nicht mehr
  selbst schneiden muss. Ohne das ist der folgende Punkt nicht
  sauber zu machen, und der Assembler ist der letzte Ort, an dem
  so etwas hingehört: es ist eine reine Vorverarbeitung, keine
  Laufzeitfunktion des Deep16.
* Forth-Kernel: BIOS herausfaktorisieren. Der BIOS-Teil liegt
  heute ab `bios_entry` im selben File wie der Kernel, obwohl er
  ein eigenes Programm ist: eigene Einsprungadresse (CS=0xF800),
  eigener Dispatch über die Funktionsnummer in DS:0, eigene
  Symboltabelle, und der Test pinnt seine Offsets über
  `BIOS_LAYOUT`. Er gehört in `asm/bios.asm`, und forth.asm
  lädt es per `include`. Zwei Nutzen: der Dispatch wird lesbar,
  ohne durch zweihundert Zeilen Interpreter davor hindurch zu
  navigieren, und ein BIOS lässt sich ändern, ohne den Kernel
  anzufassen - was genau der Fehlerklasse hier entgegenkommt,
  weil ein Kernel-Fix derzeit jedes Mal die BIOS-Layout-Pins
  mitzieht.
