const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const fontkit = require('@pdf-lib/fontkit');
const { rgb } = require('pdf-lib');

const GLYPH_FONT_PATH = path.join(__dirname, '../assets/fonts/NotoSansSC-Regular.ttf.br');
let glyphFont;

// 云函数运行时用 fontkit 解析字体，仅用于取字形轮廓（不嵌入 PDF）。
// 解析一次后缓存复用，避免每次导出重复解压 ~10MB 字体。
function loadGlyphFont() {
  if (!glyphFont) {
    const compressed = fs.readFileSync(GLYPH_FONT_PATH);
    glyphFont = fontkit.create(zlib.brotliDecompressSync(compressed));
  }
  return glyphFont;
}

// 用嵌入字体的真实字宽度量文本，供 textLayout 计算字号/换行。
function measureText(font, text, size) {
  const scale = size / font.unitsPerEm;
  const run = font.layout(String(text === undefined || text === null ? '' : text));
  let width = 0;
  run.positions.forEach((pos) => { width += pos.xAdvance; });
  return width * scale;
}

function lineStartX(rect, padding, lineWidth, alignment) {
  const usableWidth = Math.max(0, rect.width - padding * 2);
  if (alignment === 'center') return rect.x + padding + (usableWidth - lineWidth) / 2;
  if (alignment === 'right') return rect.x + padding + (usableWidth - lineWidth);
  return rect.x + padding;
}

// 将一行文本按字形逐个绘制为矢量轮廓。fontkit 字形 y 向上，drawSvgPath 会再翻转
// 一次，因此先 scale(1,-1) 预翻转，绘制后基线正好落在 baselineY。
function drawLine(page, font, text, startX, baselineY, fontSize, color) {
  const scale = fontSize / font.unitsPerEm;
  const run = font.layout(String(text));
  let penX = startX;
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index] || { xAdvance: glyph.advanceWidth, xOffset: 0, yOffset: 0 };
    const svgPath = glyph.path && glyph.path.scale(1, -1).toSVG();
    if (svgPath) {
      page.drawSvgPath(svgPath, {
        x: penX + (position.xOffset || 0) * scale,
        y: baselineY + (position.yOffset || 0) * scale,
        scale,
        color,
      });
    }
    penX += (position.xAdvance || 0) * scale;
  });
}

// 把 textLayout 的排版结果绘制到某个 widget 的绝对矩形内。
// 在可用高度内垂直居中，避免文字贴着 AcroForm 边框/下划线（否则汉字下缘会与
// 下划线重合）；多行按 lineHeight 递减。
function drawLayoutInBox({ page, rect, layout, font, padding = 1, color = rgb(0, 0, 0) }) {
  const scale = layout.fontSize / font.unitsPerEm;
  const ascent = font.ascent * scale;
  const descent = Math.abs(font.descent) * scale;
  const lines = layout.lines || [];
  const lineHeight = layout.lineHeight || layout.fontSize * 1.2;
  // 文本块的实际视觉高度：首行占 ascent+descent，其余每行加一个行距。
  const blockHeight = ascent + descent + Math.max(0, lines.length - 1) * lineHeight;
  // 让文本块在框内垂直居中：块中心对齐框中心。即使矮框放不下也对称溢出，
  // 不会像顶部/底部对齐那样让汉字下缘压在 AcroForm 下划线上。
  const boxCenterY = rect.y + rect.height / 2;
  let baselineY = boxCenterY + blockHeight / 2 - ascent;

  lines.forEach((line) => {
    if (line) {
      const width = measureText(font, line, layout.fontSize);
      const startX = lineStartX(rect, padding, width, layout.alignment);
      drawLine(page, font, line, startX, baselineY, layout.fontSize, color);
    }
    baselineY -= lineHeight;
  });
}

module.exports = {
  loadGlyphFont,
  measureText,
  drawLayoutInBox,
};
