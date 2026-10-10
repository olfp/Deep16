#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Aufruf: ./build-epub.sh [svg|kindle|kindle-calibre]
#
#   svg            -> epub/Deep16.epub                 Inline-SVG-Diagramme,
#                                                     scharf fuer Apple Books/Web.
#   kindle         -> epub/Deep16-kindle.epub          PNG-Diagramme + Metadaten
#                                                     normalisiert (E016).
#   kindle-calibre -> epub/Deep16-kindle-calibre.epub  wie "kindle", zusaetzlich
#                                                     durch Calibre normalisiert.
#                                                     <- die Datei fuer Amazon.
#
# Ergebnisse landen in book/epub/, Zwischenergebnisse in book/build/
# (das wird bei jedem Build geleert und nicht versioniert).
#
# Hintergrund E016: Amazons Send to Kindle liefert EPUBs, die es nicht
# reflowen kann, als Fixed-Layout aus ("Original layout preserved"). Nach
# Amazons eigener Hilfe sind SVG-Bilder ein Ausloeser; Calibre hat beim
# EPUB->EPUB-Round-Trip darueber hinaus die Sprache auf den Zweibuchstaben-Code
# reduziert und die Apple-Attribute im <package>-Element entfernt. Beides
# macht normalize_epub.py auch ohne Calibre. Am Geraet bestaetigt (2026-10-10):
# nur die Calibre-Variante wird von Send to Kindle akzeptiert.
mode="${1:-svg}"
case "$mode" in
  svg)
    out="epub/Deep16.epub"
    unset MERMAID_FORMAT MERMAID_PNG_DIR 2>/dev/null || true
    ;;
  kindle)
    out="epub/Deep16-kindle.epub"
    export MERMAID_FORMAT=png
    export MERMAID_PNG_DIR="build/mermaid-png"
    trap 'rm -rf build/mermaid-png build/intermediate' EXIT
    ;;
  kindle-calibre)
    out="epub/Deep16-kindle-calibre.epub"
    export MERMAID_FORMAT=png
    export MERMAID_PNG_DIR="build/mermaid-png"
    trap 'rm -rf build/mermaid-png build/intermediate' EXIT
    ;;
  *)
    echo "Aufruf: $0 [svg|kindle|kindle-calibre]" >&2
    exit 1
    ;;
esac

chapters=(kap*.md)
if ((${#chapters[@]} == 0)); then
  echo "keine Kapitel (book/kap*.md) gefunden" >&2
  exit 1
fi

export PUPPETEER_EXECUTABLE_PATH=/tmp/chromium/chrome-linux/chrome
export PATH=/home/ubuntu/.npm/_npx/668c188756b835f3/node_modules/.bin:$PATH
rm -rf build/mermaid-png build/intermediate
mkdir -p build/intermediate epub

raw="build/intermediate/pandoc.epub"
pandoc "${chapters[@]}" \
  --metadata title="Deep16 für 6502-Programmierer" \
  --metadata subtitle="Die 6502 als vertrauter Ausgangspunkt — im Buch steht aber die Deep16 selbst" \
  --metadata author="Olaf Püschel" \
  --metadata lang=de-DE \
  --metadata description="Jede Idee wird am laufenden Beispiel erklärt; die 6502 taucht nur dort auf, wo ein Vergleich wirklich erhellt (Delay-Slots, Shadow-Register, Segment-Adressierung)." \
  --toc --toc-depth=2 --split-level=1 \
  --to epub3 \
  --embed-resources \
  --lua-filter=mermaid_filter.lua \
  -o "$raw"

src="$raw"
if [[ "$mode" == kindle-calibre ]]; then
  convert=$(command -v ebook-convert || echo /opt/calibre/ebook-convert)
  if [[ ! -x "$convert" ]]; then
    echo "ebook-convert nicht gefunden (Calibre fehlt)" >&2
    exit 1
  fi
  echo "→ Calibre-Round-Trip …"
  QT_QPA_PLATFORM=offscreen "$convert" "$raw" "build/intermediate/calibre.epub" \
    >/dev/null 2>&1
  src="build/intermediate/calibre.epub"
fi

if [[ "$mode" != svg ]]; then
  echo "→ Metadaten normalisieren …"
  python3 normalize_epub.py "$src" "$out"
else
  cp "$raw" "$out"
fi

echo "→ book/$out erstellt aus: ${chapters[*]} (Modus: $mode)"