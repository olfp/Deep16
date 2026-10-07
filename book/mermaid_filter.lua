function CodeBlock(block)
  if block.classes and block.classes:includes("mermaid") then
    local tmp = os.tmpname()
    local mmd = tmp .. ".mmd"
    local svgf = tmp .. ".svg"
    local f = io.open(mmd, "w")
    if f then
      f:write(block.text)
      f:close()
    else
      return block
    end
    local cmd = 'PUPPETEER_EXECUTABLE_PATH=/tmp/chromium/chrome-linux/chrome ' ..
                'PATH=/home/ubuntu/.npm/_npx/668c188756b835f3/node_modules/.bin:$PATH ' ..
                'mmdc -i "' .. mmd .. '" -o "' .. svgf .. '" -p /tmp/mmdc_conf.json --quiet'
    os.execute(cmd)
    local s = io.open(svgf, "r")
    if s then
      local svg = s:read("*a")
      s:close()
      os.remove(mmd)
      os.remove(svgf)
      return pandoc.RawInline("html", svg)
    end
    os.remove(mmd)
    pcall(os.remove, svgf)
  end
  return block
end
