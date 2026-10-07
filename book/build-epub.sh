#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

chapters=(kap*.md)
if ((${#chapters[@]} == 0)); then
  echo "keine Kapitel (book/kap*.md) gefunden" >&2
  exit 1
fi

export PUPPETEER_EXECUTABLE_PATH=/tmp/chromium/chrome-linux/chrome
export PATH=/home/ubuntu/.npm/_npx/668c188756b835f3/node_modules/.bin:$PATH
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
  -o Deep16.epub

echo "→ book/Deep16.epub erstellt aus: ${chapters[*]}"
