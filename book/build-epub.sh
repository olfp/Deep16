#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Aufruf: ./build-epub.sh [svg|kindle]
#   svg    (Standard) -> Deep16.epub        mit Inline-SVG-Diagrammen
#                         (scharf; Apple Books, Web, PDF)
#   kindle            -> Deep16-kindle.epub mit PNG-Diagrammen
#                         (Send to Kindle lehnt eingebettete SVGs ab, E016)
mode="${1:-svg}"
case "$mode" in
  svg)
    out="Deep16.epub"
    unset MERMAID_FORMAT MERMAID_PNG_DIR 2>/dev/null || true
    ;;
  kindle)
    out="Deep16-kindle.epub"
    export MERMAID_FORMAT=png
    export MERMAID_PNG_DIR=".mermaid-png"
    trap 'rm -rf .mermaid-png' EXIT
    ;;
  *)
    echo "Aufruf: $0 [svg|kindle]" >&2
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
rm -rf .mermaid-png
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
  -o "$out"

echo "→ book/$out erstellt aus: ${chapters[*]} (Diagramme: $mode)"
