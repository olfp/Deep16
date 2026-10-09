-- Rendert ```mermaid-Blöcke mit mmdc.
--
-- Standard: Inline-SVG (scharf; für Apple Books, Web und PDF).
-- MERMAID_FORMAT=png: Rasterbilder (PNG). Amazons "Send to Kindle" lehnt
--   eingebettete SVG-Bilder ab (Fehler E016, "not compatible with Kindle's
--   reflowable layout"), daher nutzt der Kindle-Build PNG.
-- MERMAID_PNG_DIR: Zielordner für die PNGs (Standard ".mermaid-png"),
--   relativ zum Arbeitsverzeichnis des Pandoc-Laufs.

local png_mode = (os.getenv("MERMAID_FORMAT") or "svg") == "png"
local png_dir = os.getenv("MERMAID_PNG_DIR") or ".mermaid-png"
local counter = 0
local last_title = nil

-- Merkt sich die letzte (kurze) Absatzzeile, um dem PNG einen Alt-Text aus
-- der Diagramm-Titelzeile zu geben (die Titelzeilen gehen dem Diagramm direkt
-- voraus, siehe STYLE.md §4).
function Para(el)
  local t = pandoc.utils.stringify(el)
  if t ~= "" and #t <= 120 then
    last_title = t
  end
  return nil
end

local function mmdc_env()
  return 'PUPPETEER_EXECUTABLE_PATH=/tmp/chromium/chrome-linux/chrome ' ..
         'PATH=/home/ubuntu/.npm/_npx/668c188756b835f3/node_modules/.bin:$PATH '
end

function CodeBlock(block)
  if not (block.classes and block.classes:includes("mermaid")) then
    return block
  end

  local tmp = os.tmpname()
  local mmd = tmp .. ".mmd"
  local f = io.open(mmd, "w")
  if not f then
    return block
  end
  f:write(block.text)
  f:close()

  if png_mode then
    counter = counter + 1
    os.execute('mkdir -p "' .. png_dir .. '"')
    local png = string.format('%s/diagram-%03d.png', png_dir, counter)
    os.execute(mmdc_env() ..
      'mmdc -i "' .. mmd .. '" -o "' .. png .. '" -p /tmp/mmdc_conf.json ' ..
      '-s 2 -b white --quiet')
    os.remove(mmd)
    local probe = io.open(png, "rb")
    if probe then
      probe:close()
      -- Bild als Block. Der Titel wird als alt-Text gesetzt (kein sichtbarer
      -- Text, da die deutschen Titelzeilen bereits im Fließtext stehen).
      local alt = last_title or "Bit-Codierungsdiagramm"
      return pandoc.Para{ pandoc.Image(pandoc.Str(alt), png) }
    end
    return block
  end

  local svgf = tmp .. ".svg"
  local cmd = mmdc_env() ..
    'mmdc -i "' .. mmd .. '" -o "' .. svgf .. '" -p /tmp/mmdc_conf.json --quiet'
  os.execute(cmd)
  local s = io.open(svgf, "r")
  if s then
    local svg = s:read("*a")
    s:close()
    os.remove(mmd)
    os.remove(svgf)
    -- Pandoc schreibt das Roh-SVG als XHTML weiter. In XHTML muss jedes '&'
    -- escaped sein; mmdc lässt im eingebetteten @font-face-Lizenzkommentar
    -- (SIL OFL, "PERMISSION & CONDITIONS") nackte '&' stehen -> ungültiges
    -- XHTML, an dem Apple Books die Seite abbricht. Bereits gültige Entities
    -- werden geschützt, alle übrigen '&' zu '&amp;'.
    local SENT = '\1'
    svg = svg:gsub('&(%a+;|%#%d+;|%#x%x+;)', SENT .. '%1')
    svg = svg:gsub('&', '&amp;')
    svg = svg:gsub(SENT, '&')
    -- Pandoc 3.7 schreibt leere Attribute wie style="" als bloßes "style"
    -- und erzeugt damit ungültiges XHTML (Apple Books bricht die Seite ab).
    -- Leere Attribute wirken nicht und werden daher vorher entfernt.
    svg = svg:gsub('%s+[%w:_%-]+=""', '')
    svg = svg:gsub("%s+[%w:_%-]+=''", '')
    return pandoc.RawInline("html", svg)
  end
  os.remove(mmd)
  pcall(os.remove, svgf)
  return block
end
