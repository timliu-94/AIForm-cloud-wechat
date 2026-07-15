const {
  countryFlagFile,
  countryFormAsset,
  countryFormFile,
  downloadCloudJSON,
} = require('../utils/cloudAssets');
const { findCachedCountryFormVersion } = require('../utils/countryFormCatalog');

const ITALY_COUNTRY_DIR = 'Italy';
const ITALY_VERSION_DIR = '上海_申根签证申请表（90天以内）';
const ITALY_PDF_FILENAME = '上海_申根签证申请表（90天以内）.pdf';
const ITALY_SCHEMA_FILENAME = '上海_申根签证申请表（90天以内）.parsed.simple.json';

const continents = ['欧洲', '亚洲', '北美洲', '南美洲', '非洲', '大洋洲'];

const countries = [
  {
    id: 'italy',
    name: '意大利',
    iso2: 'it',
    continent: '欧洲',
    hot: true,
    templates: [
      {
        id: 'it-schengen-tourism-shanghai-demo',
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
    templates: [
      {
        id: 'jp-tourism-2026-01',
        visaType: {
          id: 'tourism',
          name: '短期旅游',
        },
        district: {
          id: 'shanghai',
          name: '上海领区',
        },
        name: '短期停留签证申请表',
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

function getTemplateConfig(templateId) {
  let result = null;
  countries.some((country) => (
    country.templates.some((template) => {
      if (template.id === templateId) {
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
  if (matched && matched.template.assets) return matched.template.assets[assetName];
  const dynamic = findCachedCountryFormVersion(templateId);
  if (!dynamic) return '';
  if (dynamic.assets && dynamic.assets[assetName]) return dynamic.assets[assetName];
  return dynamic[assetName] || '';
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
  getCountryFlag,
  getPreviewImage,
  getTemplateAsset,
  getTemplateConfig,
  getTemplateSchema,
  loadTemplateSchema,
};
