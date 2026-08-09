const DEFAULT_FONT_SIZE = 10.5;
const DEFAULT_MIN_FONT_SIZE = 4;
const DEFAULT_LINE_HEIGHT_RATIO = 1.2;
const DEFAULT_PADDING = 1;
const FONT_SIZE_STEP = 0.25;

// 与小程序图片预览保持同一份 Noto Sans SC advance width 表。
const NOTO_SANS_SC_LATIN_WIDTHS = '224,323,474,555,555,921,680,278,338,338,467,555,278,347,278,392,555,555,555,555,555,555,555,555,555,555,278,278,555,555,555,474,946,608,657,638,688,589,552,689,728,293,535,646,543,812,723,742,633,742,635,596,599,721,575,878,573,531,603,338,392,338,555,559,606,563,618,510,620,554,325,564,607,275,275,552,284,926,610,606,620,620,388,468,377,607,521,802,498,521,475,338,270,338,555,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,1000,224,323,555,555,555,555,270,1000,606,832,386,479,555,347,473,606,370,1000,411,411,606,628,1000,1000,606,411,407,479,873,903,889,474,608,608,608,608,608,608,918,638,589,589,589,589,293,293,293,293,712,723,742,742,742,742,742,1000,742,721,721,721,721,531,652,643,563,563,563,563,563,563,877,510,554,554,554,554,275,275,275,275,608,610,606,606,606,606,606,1000,606,607,607,607,607,521,620,521'
  .split(',').map(Number);

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

function measureNotoSansSCText(text, fontSize) {
  const units = Array.from(String(text || '')).reduce((total, char) => {
    const code = char.codePointAt(0);
    const latinWidth = code >= 32 && code <= 255
      ? NOTO_SANS_SC_LATIN_WIDTHS[code - 32]
      : 0;
    return total + (latinWidth || 1000);
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
  const measureText = options.measureText || measureNotoSansSCText;
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

module.exports = {
  DEFAULT_FONT_SIZE,
  DEFAULT_MIN_FONT_SIZE,
  measureHelveticaText: measureNotoSansSCText,
  measureNotoSansSCText,
  resolveLayoutPolicy,
  wrapText,
  layoutText,
};
