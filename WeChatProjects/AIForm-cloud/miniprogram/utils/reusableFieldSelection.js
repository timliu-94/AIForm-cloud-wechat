const STORAGE_KEY = 'reusable_field_selection_v1';
const CACHE_VERSION = 1;

function normalizeSemanticText(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[\s_\-:：/（）().]+/g, ' ');
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.indexOf(keyword) >= 0);
}

const SENSITIVE_KEYWORDS = [
  '姓名',
  '姓氏',
  '氏名',
  '曾用名',
  '出生姓名',
  '出生时姓名',
  '护照名',
  '身份证',
  '身份号码',
  '身份编号',
  '个人识别号',
  '证件号码',
  '证件编号',
  '护照号码',
  '护照号',
  '护照签发',
  '护照有效期',
  '旅行证件号码',
  '旅行证件编号',
  '国籍',
  '公民身份',
  '出生日期',
  '出生地点',
  '出生地',
  '性别',
  '手机号',
  '手机号码',
  '电话号码',
  '联系电话',
  '电子邮箱',
  '电子邮件',
  '家庭住址',
  '居住地址',
  '现住址',
  '永久地址',
  'surname',
  'family name',
  'given name',
  'first name',
  'full name',
  'former name',
  'maiden name',
  'passport number',
  'passport no',
  'passport date of issue',
  'passport place of issue',
  'passport expiry',
  'passport expiration',
  'travel document number',
  'travel document no',
  'national identity',
  'national id',
  'identity number',
  'identity no',
  'id number',
  'id no',
  'personal identification number',
  'nationality',
  'citizenship',
  'date of birth',
  'birth date',
  'place of birth',
  'birth place',
  'gender',
  'sex',
  'phone number',
  'telephone number',
  'mobile number',
  'email address',
  'e-mail address',
  'home address',
  'residential address',
  'permanent address',
];

const JAPAN_DEFAULT_SELECTED_KEYWORDS = [
  '居住身份',
  '酒店名称',
  '在日担保人',
  '在日邀请人',
  '是否',
];

function isJapanForm(form) {
  const templateVersion = form.templateVersion || {};
  const country = normalizeSemanticText(form.country || templateVersion.country);
  const templateId = normalizeSemanticText(form.templateId);
  return country === '日本'
    || country === 'japan'
    || templateId.indexOf('jp ') === 0
    || templateId === 'jp';
}

function isJapanDefaultSelectedBlock(leaf, fields) {
  const semanticText = [
    leaf && leaf.text,
    ...(fields || []).reduce((texts, field) => texts.concat([
      field.label,
      field.fieldName,
      field.inputType,
      field.name,
    ]), []),
  ].map(normalizeSemanticText).join(' ');
  return includesAny(semanticText, JAPAN_DEFAULT_SELECTED_KEYWORDS);
}

function isSensitiveReusableField(field) {
  const texts = [
    field && field.label,
    field && field.fieldName,
    field && field.inputType,
    field && field.name,
  ].map(normalizeSemanticText);
  if (texts.some((text) => includesAny(text, SENSITIVE_KEYWORDS))) return true;

  // 单字的「姓」「名」只能按完整语义字段匹配，避免误伤「酒店名称」等共用信息。
  return texts.some((text) => [
    '姓',
    '名',
    '电话',
    '邮箱',
    'email',
    'e mail',
    'phone',
    'mobile',
    'telephone',
  ].indexOf(text) >= 0);
}

function isSensitiveReusableBlock(leaf, fields) {
  const text = normalizeSemanticText(leaf && leaf.text);
  if (includesAny(text, SENSITIVE_KEYWORDS)) return true;
  return (fields || []).some(isSensitiveReusableField);
}

function buildReusableBlockOptions(form) {
  const blocks = [];
  const japanForm = isJapanForm(form);
  (form.pages || []).forEach((page) => {
    (page.leaves || []).forEach((leaf) => {
      const inputFields = leaf.inputFields || (leaf.fields || []).filter((field) => !field.isHandwriting);
      if (!leaf.needInput || !inputFields.length) return;
      // 日本签证使用业务指定白名单；其他国家继续使用通用个人信息排除规则。
      const defaultSelected = japanForm
        ? isJapanDefaultSelectedBlock(leaf, inputFields)
        : !isSensitiveReusableBlock(leaf, inputFields);
      blocks.push({
        name: leaf.leafId,
        title: leaf.text || inputFields.map((field) => field.label).join(' / '),
        fieldNames: inputFields.map((field) => field.id),
        acroformNames: inputFields.reduce((map, field) => {
          map[field.id] = field.name;
          return map;
        }, {}),
        defaultSelected,
        selected: defaultSelected,
      });
    });
  });
  return blocks;
}

function buildSelectionScope(form) {
  const templateVersion = form.templateVersion || {};
  return JSON.stringify([
    form.templateId || '',
    templateVersion.id || '',
    templateVersion.version || '',
    templateVersion.versionDir || '',
    templateVersion.pdfFilename || templateVersion.editableFilename || '',
    templateVersion.acroformSchema || '',
  ]);
}

function readCache() {
  try {
    const cache = wx.getStorageSync(STORAGE_KEY);
    if (!cache || cache.version !== CACHE_VERSION) return { version: CACHE_VERSION };
    return cache;
  } catch (err) {
    console.warn('Read reusable field selection cache failed:', err);
    return { version: CACHE_VERSION };
  }
}

function readSelectionOverrides(feature, scope) {
  const cache = readCache();
  const entry = cache[feature] && cache[feature][scope];
  if (!entry || !entry.overrides || typeof entry.overrides !== 'object') return {};
  return entry.overrides;
}

function applySelectionPreference(blocks, feature, scope) {
  const overrides = readSelectionOverrides(feature, scope);
  return (blocks || []).map((block) => ({
    ...block,
    selected: typeof overrides[block.name] === 'boolean'
      ? overrides[block.name]
      : block.defaultSelected,
  }));
}

function saveSelectionPreference(blocks, feature, scope) {
  if (!feature || !scope) return;
  const overrides = {};
  (blocks || []).forEach((block) => {
    if (block.selected !== block.defaultSelected) overrides[block.name] = block.selected === true;
  });

  const cache = readCache();
  const featureCache = cache[feature] && typeof cache[feature] === 'object'
    ? { ...cache[feature] }
    : {};
  if (Object.keys(overrides).length) {
    featureCache[scope] = { overrides, updatedAt: Date.now() };
  } else {
    delete featureCache[scope];
  }
  cache[feature] = featureCache;

  try {
    wx.setStorageSync(STORAGE_KEY, cache);
  } catch (err) {
    console.warn('Save reusable field selection cache failed:', err);
  }
}

module.exports = {
  STORAGE_KEY,
  applySelectionPreference,
  buildReusableBlockOptions,
  buildSelectionScope,
  isSensitiveReusableBlock,
  isSensitiveReusableField,
  isJapanDefaultSelectedBlock,
  isJapanForm,
  saveSelectionPreference,
};
