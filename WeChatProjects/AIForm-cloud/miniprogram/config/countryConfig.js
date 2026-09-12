const {
  countryFlagFile,
  countryFormAsset,
  downloadCloudJSON,
} = require('../utils/cloudAssets');

const continents = ['欧洲', '亚洲', '北美洲', '南美洲', '非洲', '大洋洲'];
const COUNTRY_CATALOG_VERSION = '2026-09-10.1';

// 新增国家的模板如未单独指定 visaType，首页默认归类为“短期签证”。
const DEFAULT_VISA_TYPE = { id: 'application', name: '短期签证' };
const COMMON_DISTRICT = { id: 'default', name: '通用' };
const ITALY_VISA_TYPE = { id: 'tourism', name: '短期签证' };
const ITALY_DISTRICT = { id: 'shanghai', name: '中国领区' };
const JAPAN_VISA_TYPES = [
  { id: 'short-term', name: '短期签证' },
  { id: 'long-term', name: '长期签证' },
];

// 版本 ID 沿用原云目录接口的 SHA-1 结果。配置迁移后 ID 保持不变，确保已保存
// 的草稿、分享邀请和导出记录仍能定位到同一份模板。
function configuredTemplate({
  id,
  country,
  versionDir,
  pdfFilename = `${versionDir}.pdf`,
  visaType = DEFAULT_VISA_TYPE,
  visaTypes,
  district = COMMON_DISTRICT,
  publishedAt,
}) {
  const schemaFilename = `${pdfFilename.replace(/\.pdf$/i, '')}.parsed.simple.json`;
  return {
    id,
    country,
    versionDir,
    pdfFilename,
    visaType,
    ...(visaTypes ? { visaTypes } : {}),
    district,
    name: pdfFilename.replace(/\.pdf$/i, ''),
    version: versionDir,
    publishedAt,
    scope: '线上配置版本',
    status: 'active',
    enabled: true,
    availableForFill: true,
    assets: {
      sourcePdf: countryFormAsset(country, versionDir, 'commonforms', pdfFilename),
      editablePdf: countryFormAsset(country, versionDir, 'commonforms', pdfFilename),
      editableFilename: pdfFilename,
      acroformSchema: countryFormAsset(country, versionDir, 'outputs', schemaFilename),
      previewImages: {
        pattern: countryFormAsset(country, versionDir, 'preview', 'page-{page}.png'),
      },
    },
  };
}

// 首页支持范围的唯一数据源。这里没有配置的云存储目录不会自动出现在首页；
// 修改国家或版本后需要随小程序代码一起评审、测试和发布。
const countries = [
  {
    id: 'iceland',
    name: '冰岛',
    cloudDirectory: 'Iceland',
    iso2: 'is',
    continent: '欧洲',
    hot: true,
    enabled: true,
    templates: [
      configuredTemplate({
        id: 'cloud-iceland-80c4bbfe1f2b3d4d',
        country: 'Iceland',
        versionDir: '申根签证申请表（90天以内）',
        publishedAt: '2026-09-05',
      }),
    ],
  },
  {
    id: 'italy',
    name: '意大利',
    cloudDirectory: 'Italy',
    iso2: 'it',
    continent: '欧洲',
    hot: true,
    enabled: true,
    templates: [
      configuredTemplate({
        id: 'cloud-italy-41b261e471b4df79',
        country: 'Italy',
        versionDir: '上海_申根签证申请表（90天以内）',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-italy-d4faaf25fe834b61',
        country: 'Italy',
        versionDir: '上海_国家签证申请表(90天以上)',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-italy-10458c474816879d',
        country: 'Italy',
        versionDir: '北京_申根签证申请表（90天以内）',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-italy-7060f117d87be402',
        country: 'Italy',
        versionDir: '北京_国家签证申请表(90天以上)',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-italy-871354a38c50a2e3',
        country: 'Italy',
        versionDir: '广州_申根签证申请表（90天以内）',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-italy-d387136180e8dc56',
        country: 'Italy',
        versionDir: '广州_国家签证申请表(90天以上)',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-italy-f1d840f4300c059e',
        country: 'Italy',
        versionDir: '重庆_申根签证申请表（90天以内）',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-italy-06ad6fa3db5015fa',
        country: 'Italy',
        versionDir: '重庆_国家签证申请表(90天以上)',
        visaType: ITALY_VISA_TYPE,
        district: ITALY_DISTRICT,
        publishedAt: '2026-08-03',
      }),
    ],
  },
  {
    id: 'japan',
    name: '日本',
    cloudDirectory: 'Japan',
    iso2: 'jp',
    continent: '亚洲',
    hot: true,
    enabled: true,
    templates: [
      configuredTemplate({
        id: 'cloud-japan-20d1ebfb26b32018',
        country: 'Japan',
        versionDir: '签证申请表',
        visaTypes: JAPAN_VISA_TYPES,
        publishedAt: '2026-08-09',
      }),
      configuredTemplate({
        id: 'cloud-japan-05449e664bc624a6',
        country: 'Japan',
        versionDir: '签证表-手绘框',
        visaTypes: JAPAN_VISA_TYPES,
        publishedAt: '2026-08-09',
      }),
    ],
  },
  {
    id: 'spain',
    name: '西班牙',
    cloudDirectory: 'Spain',
    iso2: 'es',
    continent: '欧洲',
    hot: true,
    enabled: true,
    templates: [
      configuredTemplate({
        id: 'cloud-spain-26a09900d3ebf245',
        country: 'Spain',
        versionDir: '申根签证申请表（90天以内）',
        publishedAt: '2026-09-03',
      }),
      configuredTemplate({
        id: 'cloud-spain-eaca473f11a6b8d3',
        country: 'Spain',
        versionDir: '国家签证申请表(90天以上)',
        publishedAt: '2026-09-03',
      }),
    ],
  },
  {
    id: 'switzerland',
    name: '瑞士',
    cloudDirectory: 'Switzerland',
    iso2: 'ch',
    continent: '欧洲',
    hot: true,
    enabled: true,
    templates: [
      configuredTemplate({
        id: 'cloud-switzerland-90a2c04e498b5c63',
        country: 'Switzerland',
        versionDir: '申根签证申请表（90天以内）',
        publishedAt: '2026-08-03',
      }),
      configuredTemplate({
        id: 'cloud-switzerland-ba42fe5e69b66aab',
        country: 'Switzerland',
        versionDir: '国家签证申请表(90天以上)',
        publishedAt: '2026-08-03',
      }),
    ],
  },
];

const LEGACY_TEMPLATE_ALIASES = {
  italy: 'cloud-italy-41b261e471b4df79',
  'it-schengen-tourism-shanghai-demo': 'cloud-italy-41b261e471b4df79',
  'jp-tourism-2026-01': 'cloud-japan-20d1ebfb26b32018',
};

function isEnabled(item) {
  return item && item.enabled !== false && (!item.status || item.status === 'active');
}

function getCountryConfig(countryId) {
  return countries.find((country) => country.id === countryId) || null;
}

function getCountryConfigByCloudDirectory(directory) {
  return countries.find((country) => country.cloudDirectory === directory) || null;
}

function resolveTemplateId(templateId) {
  return LEGACY_TEMPLATE_ALIASES[templateId] || templateId;
}

function getTemplateConfig(templateId) {
  const resolvedId = resolveTemplateId(templateId);
  let result = null;
  countries.some((country) => (
    country.templates.some((template) => {
      if (template.id === resolvedId) {
        result = { country, template };
        return true;
      }
      return false;
    })
  ));
  return result;
}

function getTemplateAsset(templateId, assetName) {
  const matched = getTemplateConfig(templateId);
  return matched && matched.template.assets
    ? matched.template.assets[assetName]
    : '';
}

function getTemplateSchema(templateId) {
  const schema = getTemplateAsset(templateId, 'acroformSchema');
  if (!schema) return null;
  if (typeof schema.load === 'function') return schema.load();
  return schema;
}

function loadTemplateSchema(templateId) {
  const schema = getTemplateSchema(templateId);
  if (!schema) return Promise.reject(new Error(`模板 ${templateId} 未配置 AcroForm JSON`));
  if (typeof schema === 'string') return downloadCloudJSON(schema);
  return Promise.resolve(schema);
}

function getPreviewImage(templateId, page) {
  const previewImages = getTemplateAsset(templateId, 'previewImages');
  if (!previewImages) return '';
  if (previewImages.pages && previewImages.pages[page]) return previewImages.pages[page];
  if (previewImages.pattern) return previewImages.pattern.replace('{page}', page);
  return '';
}

function getCountryFlag(country) {
  if (!country || country.flag === false) return '';
  return country.iso2 ? countryFlagFile(country.iso2) : '';
}

function validateCountryConfig(config = countries) {
  const errors = [];
  const countryIds = new Set();
  const directories = new Set();
  const templateIds = new Set();

  config.forEach((country, countryIndex) => {
    const label = country.id || `countries[${countryIndex}]`;
    if (!country.id || countryIds.has(country.id)) errors.push(`${label}: 国家 ID 缺失或重复`);
    countryIds.add(country.id);
    if (!country.name) errors.push(`${label}: 国家名称缺失`);
    if (!country.cloudDirectory || directories.has(country.cloudDirectory)) {
      errors.push(`${label}: 云目录缺失或重复`);
    }
    directories.add(country.cloudDirectory);
    if (continents.indexOf(country.continent) < 0) errors.push(`${label}: 所属洲配置无效`);
    if (!Array.isArray(country.templates)) errors.push(`${label}: templates 必须为数组`);
    if (isEnabled(country) && !(country.templates || []).some(isEnabled)) {
      errors.push(`${label}: 启用国家至少需要一个启用模板`);
    }

    (country.templates || []).forEach((template, templateIndex) => {
      const templateLabel = template.id || `${label}.templates[${templateIndex}]`;
      if (!template.id || templateIds.has(template.id)) errors.push(`${templateLabel}: 模板 ID 缺失或重复`);
      templateIds.add(template.id);
      if (template.country !== country.cloudDirectory) errors.push(`${templateLabel}: country 与国家云目录不一致`);
      if (!template.versionDir || !template.pdfFilename) errors.push(`${templateLabel}: 版本目录或 PDF 文件名缺失`);
      if (!template.district || !template.district.id || !template.district.name) errors.push(`${templateLabel}: 领区配置不完整`);
      const visaTypes = template.visaTypes || [template.visaType];
      if (visaTypes.some((item) => !item || !item.id || !item.name)) errors.push(`${templateLabel}: 签证类型配置不完整`);
      if (isEnabled(country) && isEnabled(template)) {
        const assets = template.assets || {};
        if (!assets.sourcePdf || !assets.editablePdf || !assets.editableFilename || !assets.acroformSchema) {
          errors.push(`${templateLabel}: 启用模板的 PDF/Schema 资源配置不完整`);
        }
        if (!assets.previewImages || !assets.previewImages.pattern) errors.push(`${templateLabel}: 启用模板的预览图配置缺失`);
      }
    });
  });

  return errors;
}

module.exports = {
  COUNTRY_CATALOG_VERSION,
  continents,
  countries,
  getCountryConfig,
  getCountryConfigByCloudDirectory,
  getCountryFlag,
  getPreviewImage,
  getTemplateAsset,
  getTemplateConfig,
  getTemplateSchema,
  isEnabled,
  loadTemplateSchema,
  resolveTemplateId,
  validateCountryConfig,
};
