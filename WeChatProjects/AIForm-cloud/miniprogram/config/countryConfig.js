const {
  countryFlagFile,
  countryFormAsset,
  countryFormFile,
  countryFormSchemaAsset,
  downloadCloudJSON,
} = require('../utils/cloudAssets');
const { findCachedCountryFormVersion } = require('../utils/countryFormCatalog');

const ITALY_COUNTRY_DIR = 'Italy';
const ITALY_VERSION_DIR = '上海_申根签证申请表（90天以内）';
const ITALY_PDF_FILENAME = '上海_申根签证申请表（90天以内）.pdf';
const ITALY_SCHEMA_FILENAME = '上海_申根签证申请表（90天以内）.parsed.simple.json';

// 历史遗留的模板 ID（早期记录里 templateId 存成了国家名），统一映射到当前的示范模板，
// 避免旧「我的表格」记录在分享填写 / 导出时因找不到模板而报「未配置 AcroForm JSON」。
const LEGACY_TEMPLATE_ALIASES = {
  italy: 'it-schengen-tourism-shanghai-demo',
};

const continents = ['欧洲', '亚洲', '北美洲', '南美洲', '非洲', '大洋洲'];

const countries = [
  {
    id: 'italy',
    name: '意大利',
    iso2: 'it',
    continent: '欧洲',
    hot: true,
    cloudCatalog: {
      country: 'Italy',
      visaTypeId: 'tourism',
      districtId: 'shanghai',
    },
    templates: [
      {
        id: 'it-schengen-tourism-shanghai-demo',
        country: ITALY_COUNTRY_DIR,
        versionDir: ITALY_VERSION_DIR,
        pdfFilename: ITALY_PDF_FILENAME,
        visaType: {
          id: 'tourism',
          name: '短期旅游',
        },
        district: {
          id: 'shanghai',
          name: '上海领区',
        },
        name: '申根短期签证申请表',
        version: '示范版',
        publishedAt: '2026-06-27',
        scope: '以上海领区示例 PDF 和 AcroForm 标注演示',
        status: 'active',
        assets: {
          sourcePdf: countryFormAsset(ITALY_COUNTRY_DIR, ITALY_VERSION_DIR, 'commonforms', ITALY_PDF_FILENAME),
          editablePdf: countryFormAsset(ITALY_COUNTRY_DIR, ITALY_VERSION_DIR, 'commonforms', ITALY_PDF_FILENAME),
          editableFilename: ITALY_PDF_FILENAME,
          acroformSchema: countryFormAsset(
            ITALY_COUNTRY_DIR,
            ITALY_VERSION_DIR,
            'outputs',
            ITALY_SCHEMA_FILENAME,
          ),
          previewImages: {
            pattern: countryFormAsset(ITALY_COUNTRY_DIR, ITALY_VERSION_DIR, 'preview', 'page-{page}.png'),
          },
        },
      },
    ],
  },
  {
    id: 'france',
    name: '法国',
    iso2: 'fr',
    continent: '欧洲',
    hot: true,
    templates: [
      {
        id: 'fr-schengen-tourism-2026-01',
        visaType: {
          id: 'tourism',
          name: '短期旅游',
        },
        district: {
          id: 'shanghai',
          name: '上海领区',
        },
        name: '申根短期签证申请表',
        version: '2026.01',
        publishedAt: '2026-01-10',
        scope: '上海、江苏、浙江、安徽',
        status: 'active',
        assets: {
          sourcePdf: countryFormFile('France', 'france_schengen_2026.pdf'),
        },
      },
      {
        id: 'fr-schengen-tourism-2025-12',
        visaType: {
          id: 'tourism',
          name: '短期旅游',
        },
        district: {
          id: 'beijing',
          name: '北京领区',
        },
        name: '申根短期签证申请表',
        version: '2025.12',
        publishedAt: '2025-12-18',
        scope: '北京、天津、河北、山东、山西、内蒙古',
        status: 'active',
        assets: {
          sourcePdf: countryFormFile('France', 'france_schengen_2025.pdf'),
        },
      },
      {
        id: 'fr-business-2026-01',
        visaType: {
          id: 'business',
          name: '商务',
        },
        district: {
          id: 'shanghai',
          name: '上海领区',
        },
        name: '商务访问申请表',
        version: '2026.01',
        publishedAt: '2026-01-10',
        scope: '上海、江苏、浙江、安徽',
        status: 'active',
        assets: {
          sourcePdf: countryFormFile('France', 'france_business_2026.pdf'),
        },
      },
    ],
  },
  {
    id: 'germany',
    name: '德国',
    iso2: 'de',
    continent: '欧洲',
    hot: true,
    applicationMode: 'official_web',
    searchAliases: ['Germany', '德意志'],
    templates: [
      {
        id: 'de-schengen-tourism-2026-02',
        visaType: {
          id: 'tourism',
          name: '短期旅游',
        },
        district: {
          id: 'shanghai',
          name: '上海领区',
        },
        name: '申根短期签证申请表',
        version: '2026.02',
        publishedAt: '2026-02-04',
        scope: '上海、江苏、浙江、安徽',
        status: 'active',
        assets: {
          sourcePdf: countryFormFile('Germany', 'germany_schengen_2026.pdf'),
        },
      },
    ],
  },
  {
    id: 'japan',
    name: '日本',
    iso2: 'jp',
    continent: '亚洲',
    hot: true,
    cloudCatalog: {
      country: 'Japan',
      visaTypeIds: ['short-term', 'long-term'],
      districtId: 'shanghai',
    },
    templates: [
      {
        id: 'jp-tourism-2026-01',
        visaTypes: [
          {
            id: 'short-term',
            name: '短期签证',
          },
          {
            id: 'long-term',
            name: '长期签证',
          },
        ],
        district: {
          id: 'shanghai',
          name: '上海领区',
        },
        name: '日本签证申请表',
        version: '2026.01',
        publishedAt: '2026-01-01',
        scope: '上海、江苏、浙江、安徽、江西',
        status: 'active',
        assets: {
          sourcePdf: countryFormFile('Japan', 'japan_tourism_2026.pdf'),
        },
      },
    ],
  },
  {
    id: 'south-korea',
    name: '韩国',
    iso2: 'kr',
    continent: '亚洲',
    hot: true,
    applicationMode: 'official_web',
    searchAliases: ['Korea', 'South Korea', '南韩'],
    templates: [],
  },
  {
    id: 'usa',
    name: '美国',
    iso2: 'us',
    continent: '北美洲',
    hot: false,
    templates: [
      {
        id: 'us-ds160-demo',
        visaType: {
          id: 'business-tourism',
          name: '商务/旅游',
        },
        district: {
          id: 'china',
          name: '中国大陆地区',
        },
        name: 'DS-160 信息采集表',
        version: '2026.01',
        publishedAt: '2026-01-15',
        scope: '中国大陆地区填写参考',
        status: 'active',
        assets: {
          sourcePdf: countryFormFile('USA', 'us_ds160_demo.pdf'),
        },
      },
    ],
  },
];

function getCountryConfig(countryId) {
  return countries.find((country) => country.id === countryId) || null;
}

function getCountryConfigByCloudDirectory(directory) {
  return countries.find((country) => (
    country.cloudCatalog && country.cloudCatalog.country === directory
  )) || null;
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

// 版本对象可能缺失 acroformSchema（例如仅存 PDF 元信息的旧缓存），此时按
// country_forms/<country>/<versionDir>/outputs/<pdf>.parsed.simple.json 约定兜底推导。
function dynamicAssetValue(dynamic, assetName) {
  const direct = (dynamic.assets && dynamic.assets[assetName]) || dynamic[assetName] || '';
  if (direct) return direct;
  if (assetName === 'acroformSchema') {
    return countryFormSchemaAsset(dynamic.country, dynamic.versionDir, dynamic.pdfFilename);
  }
  return '';
}

function getTemplateAsset(templateId, assetName) {
  const resolvedId = resolveTemplateId(templateId);
  const matched = getTemplateConfig(resolvedId);
  if (matched && matched.template.assets) return matched.template.assets[assetName];
  const dynamic = findCachedCountryFormVersion(resolvedId);
  if (!dynamic) return '';
  return dynamicAssetValue(dynamic, assetName);
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
  return country && country.iso2 ? countryFlagFile(country.iso2) : '';
}

module.exports = {
  continents,
  countries,
  getCountryConfig,
  getCountryConfigByCloudDirectory,
  getCountryFlag,
  getPreviewImage,
  getTemplateAsset,
  getTemplateConfig,
  getTemplateSchema,
  loadTemplateSchema,
};
