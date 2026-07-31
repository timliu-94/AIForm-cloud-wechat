const DEFAULT_FONT_SIZE = 10.5;
const DEFAULT_MIN_FONT_SIZE = 4;
const DEFAULT_LINE_HEIGHT_RATIO = 1.2;
const DEFAULT_PADDING = 1;
const FONT_SIZE_STEP = 0.25;

// Helvetica AFM widths (1/1000 em). The PDF exporter uses the same font, so
// preview wrapping is deterministic without depending on the device font.
const HELVETICA_WIDTHS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

'0123456789'.split('').forEach((char) => {
  HELVETICA_WIDTHS[char] = 556;
});

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ');
}

function isCjkOrWide(char) {
  const code = char.codePointAt(0);
  return code > 0xff;
}

function measureHelveticaText(text, fontSize) {
  const units = Array.from(String(text || '')).reduce((total, char) => {
    if (HELVETICA_WIDTHS[char]) return total + HELVETICA_WIDTHS[char];
    return total + (isCjkOrWide(char) ? 1000 : 556);
  }, 0);
  return (units / 1000) * fontSize;
}

function isBreakCharacter(char) {
  return /\s/.test(char) || /[-/_,.;:]/.test(char);
}

function wrapParagraph(paragraph, maxWidth, fontSize, measureText) {
  if (!paragraph) return [''];
  const chars = Array.from(paragraph);
  const lines = [];
  let offset = 0;

  while (offset < chars.length) {
    let lastFit = offset;
    let lastBreak = -1;
    let cursor = offset;

    while (cursor < chars.length) {
      const candidate = chars.slice(offset, cursor + 1).join('');
      if (measureText(candidate, fontSize) > maxWidth + 0.001) break;
      lastFit = cursor + 1;
      if (isBreakCharacter(chars[cursor])) lastBreak = cursor + 1;
      cursor += 1;
    }

    if (cursor >= chars.length) {
      lines.push(chars.slice(offset).join('').replace(/\s+$/g, ''));
      break;
    }

    // Even one glyph cannot fit. Keep it as a line so the caller can report
    // overflow instead of entering an infinite loop or silently dropping it.
    if (lastFit === offset) lastFit = offset + 1;
    const cut = lastBreak > offset ? lastBreak : lastFit;
    lines.push(chars.slice(offset, cut).join('').replace(/\s+$/g, ''));
    offset = cut;
    while (offset < chars.length && /\s/.test(chars[offset])) offset += 1;
  }

  return lines.length ? lines : [''];
}

function wrapText(text, maxWidth, fontSize, measureText) {
  const paragraphs = normalizeText(text).split('\n');
  const lines = [];
  paragraphs.forEach((paragraph) => {
    wrapParagraph(paragraph, maxWidth, fontSize, measureText)
      .forEach((line) => lines.push(line));
  });
  return lines.length ? lines : [''];
}

function normalizeAlignment(value) {
  const alignment = String(value || '').toLowerCase();
  if (alignment === 'center' || alignment === 'right') return alignment;
  return 'left';
}

function containsType(inputType, pattern) {
  const values = Array.isArray(inputType) ? inputType : [inputType];
  return values.some((value) => pattern.test(String(value || '')));
}

function resolveLayoutPolicy(field = {}) {
  const rect = Array.isArray(field.rect) ? field.rect : [0, 0, 0, 0];
  const width = Math.abs(finiteNumber(rect[2], 0) - finiteNumber(rect[0], 0));
  const height = Math.abs(finiteNumber(rect[3], 0) - finiteNumber(rect[1], 0));
  const fontSizeMax = positiveNumber(
    field.fontSizeMax || field.font_size_max || field.fontSize || field.font_size,
    DEFAULT_FONT_SIZE,
  );
  const requestedMin = positiveNumber(
    field.fontSizeMin || field.font_size_min,
    DEFAULT_MIN_FONT_SIZE,
  );
  const fontSizeMin = Math.min(fontSizeMax, requestedMin);
  const explicitMode = String(field.layoutMode || field.layout_mode || '').toLowerCase();
  const semanticMultiline = field.component === 'textarea'
    || containsType(field.inputType || field.input_type, /地址|说明|备注|单位|学校|职业|address|description/i);
  const tallEnough = height >= fontSizeMax * 2.1;
  let mode = explicitMode;
  if (mode !== 'singleline' && mode !== 'multiline' && mode !== 'comb') {
    mode = field.combed || field.isCombed
      ? 'comb'
      : (field.multiline || field.is_multiline || semanticMultiline || tallEnough
        ? 'multiline'
        : 'singleline');
  }

  return {
    width,
    height,
    mode,
    fontSizeMax,
    fontSizeMin,
    lineHeightRatio: positiveNumber(
      field.lineHeightRatio || field.line_height_ratio,
      DEFAULT_LINE_HEIGHT_RATIO,
    ),
    padding: Math.max(0, finiteNumber(field.padding, DEFAULT_PADDING)),
    alignment: normalizeAlignment(field.textAlignment || field.text_alignment),
  };
}

function layoutAtSize(text, policy, fontSize, options) {
  const measureText = options.measureText || measureHelveticaText;
  const measureHeight = options.measureHeight || ((size) => size * 0.925);
  const usableWidth = Math.max(0, policy.width - policy.padding * 2);
  const usableHeight = Math.max(0, policy.height - policy.padding * 2);
  const normalized = normalizeText(text);
  const lines = policy.mode === 'multiline'
    ? wrapText(normalized, usableWidth, fontSize, measureText)
    : [normalized.replace(/\n+/g, ' ')];
  const widths = lines.map((line) => measureText(line, fontSize));
  const fontHeight = measureHeight(fontSize);
  const lineHeight = fontHeight * policy.lineHeightRatio;
  const usedHeight = policy.mode === 'multiline'
    ? lines.length * lineHeight
    : fontHeight;
  const fitsWidth = widths.every((width) => width <= usableWidth + 0.001);
  const fitsHeight = usedHeight <= usableHeight + 0.001;

  return {
    lines,
    widths,
    fontSize,
    fontHeight,
    lineHeight,
    usedHeight,
    usedWidth: widths.length ? Math.max(...widths) : 0,
    overflow: !fitsWidth || !fitsHeight,
  };
}

function layoutText(text, field, options = {}) {
  const policy = options.policy || resolveLayoutPolicy(field);
  let fontSize = policy.fontSizeMax;
  let result = null;

  while (fontSize >= policy.fontSizeMin - 0.001) {
    result = layoutAtSize(text, policy, fontSize, options);
    if (!result.overflow) break;
    fontSize = Math.round((fontSize - FONT_SIZE_STEP) * 100) / 100;
  }

  if (!result || result.overflow) {
    result = layoutAtSize(text, policy, policy.fontSizeMin, options);
  }

  return {
    ...result,
    mode: policy.mode,
    multiline: policy.mode === 'multiline',
    alignment: policy.alignment,
    padding: policy.padding,
    boxWidth: policy.width,
    boxHeight: policy.height,
  };
}

function buildScaledTextStyle(layout, scale, unit = 'px') {
  const safeScale = Math.max(0, finiteNumber(scale, 0));
  const fontSize = layout.fontSize * safeScale;
  const lineHeight = layout.lineHeight * safeScale;
  const padding = layout.padding * safeScale;
  return [
    `font-size:${fontSize.toFixed(2)}${unit}`,
    `line-height:${lineHeight.toFixed(2)}${unit}`,
    `padding:${padding.toFixed(2)}${unit}`,
    `text-align:${layout.alignment}`,
    `justify-content:${layout.multiline ? 'flex-start' : 'center'}`,
  ].join(';');
}

module.exports = {
  DEFAULT_FONT_SIZE,
  DEFAULT_MIN_FONT_SIZE,
  measureHelveticaText,
  resolveLayoutPolicy,
  wrapText,
  layoutText,
  buildScaledTextStyle,
};
