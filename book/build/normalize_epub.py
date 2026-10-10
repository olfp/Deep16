#!/usr/bin/env python3
"""Normalisiert ein EPUB für Amazons Send to Kindle (Fehler E016).

Amazons EPUB-Eingangs-Pipeline stuft Bücher, die sie nicht reflowen kann, als
Fixed-Layout ein und liefert sie wie PDF aus ("E016"). Auslöser sind laut
Amazon-Hilfe u. a. SVG-Bilder; zusätzlich dokumentiert sind Metadaten-Probleme:

  * `<dc:language>` mit zusätzlichen Attributen lässt den Parser abstürzen
    (https://swiatczytnikow.pl/... znalazlem-przyczyne-bledu-e016/). Geholfen
    hat dort nur die nackte Form `<dc:language>pl</dc:language>`.
  * Der Regions-Subtag (`de-DE`) ist für Amazon überflüssig; die Korrektur,
    die Calibre beim EPUB→EPUB-Round-Trip anwendet, ist der Zweibuchstaben-Code.

Dieses Skript nimmt genau diese Eingriffe vor und lässt Layout, CSS, Bilder
und Text unverändert. Es ist idempotent: bereits normalisierte Dateien
bleiben unverändert.

Aufruf: normalize_epub.py EINGABE.epub AUSGABE.epub
"""

import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

APPLE_DISPLAY_OPTIONS = "META-INF/com.apple.ibooks.display-options.xml"

# Attributes, die Pandoc im <package>-Element setzt und die Amazons Parser
# nicht kennt: der iBooks-Vokabular-Prefix und xml:lang.
PACKAGE_ATTRS = ("prefix", "xml:lang")


def normalize_opf(data: bytes) -> tuple[bytes, list[str]]:
    changes: list[str] = []
    text = data.decode("utf-8")

    # 1) Apple-/Redundanz-Attribute aus <package> entfernen.
    m = re.search(r"<package\b[^>]*>", text)
    if m:
        tag = m.group(0)
        new = tag
        for attr in PACKAGE_ATTRS:
            new = re.sub(r'\s+%s="[^"]*"' % re.escape(attr), "", new)
        if new != tag:
            removed = sorted(
                a for a in PACKAGE_ATTRS if ('%s="' % a) in tag
            )
            text = text.replace(tag, new, 1)
            changes.append("<package>: %s entfernt" % ", ".join(removed))

    # 2) <dc:language> auf den nackten Zweibuchstaben-Code reduzieren.
    def plain_language(m: re.Match) -> str:
        value = m.group(2).strip()
        base = value.split("-")[0].split("_")[0].lower()
        old = m.group(0)
        if base and (old != f"<dc:language>{base}</dc:language>"):
            changes.append(f"dc:language: '{value}' -> '{base}'")
            return f"<dc:language>{base}</dc:language>"
        return old

    text = re.sub(r"<dc:language\b([^>]*)>([^<]*)</dc:language>", plain_language, text)

    return text.encode("utf-8"), changes


def normalize_container(data: bytes) -> tuple[bytes, list[str]]:
    """Entfernt den Verweis auf die Apple-display-options-Datei."""
    text = data.decode("utf-8")
    new = re.sub(
        r"\s*<rootfile\b[^>]*%s[^>]*/>" % re.escape(APPLE_DISPLAY_OPTIONS), "", text
    )
    if new != text:
        return new.encode("utf-8"), ["container.xml: Apple-Verweis entfernt"]
    return data, []


def fix_svg_cover(data: bytes) -> tuple[bytes, bool]:
    """Ersetzt Calibres SVG-Umschlag des Titelbilds durch ein schlichtes <img>.

    Calibre legt das generierte Titelbild als seitenfüllendes SVG mit
    viewBox und preserveAspectRatio="none" in eine eigene titlepage.xhtml.
    Genau solche SVG-Bilder nennt Amazons E016-Hilfe als Ursache, und das
    `@page {padding: 0pt; margin: 0pt}` darin riecht nach Fixed Layout.
    """
    text = data.decode("utf-8")
    if "<svg" not in text:
        return data, False

    m = re.search(r'xlink:href="([^"]+)"', text)
    src = m.group(1) if m else "cover_image.jpg"

    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text)
    body = (
        '    <body>\n'
        '        <div>\n'
        '            <img src="%s" alt="Titelbild" style="max-width:100%%;height:auto"/>\n'
        "        </div>\n"
        "    </body>\n" % src
    )
    text = re.sub(r"<body[^>]*>[\s\S]*</body>", body, text)
    return text.encode("utf-8"), True


def normalize_lang(data: bytes) -> tuple[bytes, list[str]]:
    """Ersetzt englische Sprachangaben durch die Buchsprache.

    Calibre erzeugt sein generiertes Titelbild mit xml:lang="en". Das ist in
    einem deutschen Buch schlicht falsch, und die Sprachangabe ist genau der
    Wert, an dem Amazons Parser laut Berichten scheitert.
    """
    text = data.decode("utf-8")
    new = re.sub(r'((?:xml:)?lang=")en(?:-[A-Za-z]{2})?(")', r"\1de\2", text)
    if new != text:
        return new.encode("utf-8"), ["Sprachangabe 'en' -> 'de'"]
    return data, []


def normalize(src: Path, dst: Path) -> list[str]:
    changes: list[str] = []
    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        items = [(info, zin.read(info.filename)) for info in zin.infolist()]

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.epub"
        with zipfile.ZipFile(out, "w") as zout:
            # mimetype muss laut OCF an erster Stelle und unkomprimiert stehen.
            zout.writestr("mimetype", b"application/epub+zip", zipfile.ZIP_STORED)
            for info, data in items:
                name = info.filename
                if name == "mimetype":
                    continue
                if name == APPLE_DISPLAY_OPTIONS:
                    changes.append("META-INF/com.apple.ibooks.display-options.xml entfernt")
                    continue
                if name.lower().endswith(".opf"):
                    # Das Paket-Dokument liegt je nach Erzeuger in "" oder
                    # in einem Unterverzeichnis ("EPUB/content.opf").
                    data, sub = normalize_opf(data)
                    changes.extend(sub)
                elif name == "META-INF/container.xml":
                    data, sub = normalize_container(data)
                    changes.extend(sub)
                elif name.lower().endswith((".xhtml", ".html")):
                    data, changed = fix_svg_cover(data)
                    if changed:
                        changes.append(f"{name}: SVG-Titelbild durch <img> ersetzt")
                    data, sub = normalize_lang(data)
                    changes.extend(sub)
                zi = zipfile.ZipInfo(name, date_time=info.date_time)
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = info.external_attr
                zout.writestr(zi, data)
        shutil.move(str(out), str(dst))
    return changes


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    changes = normalize(src, dst)
    if changes:
        for line in changes:
            print(f"  · {line}")
    else:
        print("  · nichts zu normalisieren")
    print(f"→ {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())