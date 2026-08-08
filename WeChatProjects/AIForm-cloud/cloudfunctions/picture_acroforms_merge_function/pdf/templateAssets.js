const CLOUD_FILE_ROOT = 'cloud://cloudbase-d6gt24wo5bc8f4e49.636c-cloudbase-d6gt24wo5bc8f4e49-1449758889';
const ITALY_TEMPLATE_ID = 'it-schengen-tourism-shanghai-demo';
const ITALY_COUNTRY_DIR = 'Italy';
const ITALY_VERSION_DIR = '上海_申根签证申请表（90天以内）';
const ITALY_PDF_FILENAME = '上海_申根签证申请表（90天以内）.pdf';
const DYNAMIC_COUNTRIES = new Set(['Italy', 'Japan']);

function countryFormAsset(country, versionDir, assetDir, filename) {
  return `${CLOUD_FILE_ROOT}/country_forms/${country}/${versionDir}/${assetDir}/${filename}`;
}

const italyPdfFileID = countryFormAsset(
  ITALY_COUNTRY_DIR,
  ITALY_VERSION_DIR,
  'commonforms',
  ITALY_PDF_FILENAME,
);
const italySchemaFileID = countryFormAsset(
  ITALY_COUNTRY_DIR,
  ITALY_VERSION_DIR,
  'outputs',
  `${ITALY_PDF_FILENAME.replace(/\.pdf$/i, '')}.parsed.simple.json`,
);

const pdfTemplates = {
  italy: {
    fileID: italyPdfFileID,
    schemaFileID: italySchemaFileID,
    filename: ITALY_PDF_FILENAME,
    fieldMap: {},
  },
  [ITALY_TEMPLATE_ID]: {
    fileID: italyPdfFileID,
    schemaFileID: italySchemaFileID,
    filename: ITALY_PDF_FILENAME,
    fieldMap: {},
  },
};

function getDynamicPdfTemplate(asset) {
  if (!asset) return null;
  const { country, versionDir, pdfFilename } = asset;
  if (!DYNAMIC_COUNTRIES.has(country)) return null;
  if (!versionDir || versionDir === '.' || versionDir === '..' || /[\\/]/.test(versionDir)) return null;
  if (!pdfFilename || /[\\/]/.test(pdfFilename) || !/\.pdf$/i.test(pdfFilename)) return null;
  return {
    fileID: countryFormAsset(country, versionDir, 'commonforms', pdfFilename),
    schemaFileID: countryFormAsset(
      country,
      versionDir,
      'outputs',
      `${pdfFilename.replace(/\.pdf$/i, '')}.parsed.simple.json`,
    ),
    filename: pdfFilename,
    fieldMap: {},
  };
}

function getPdfTemplate(templateId, dynamicAsset) {
  return pdfTemplates[templateId] || getDynamicPdfTemplate(dynamicAsset);
}

module.exports = {
  getPdfTemplate,
  getDynamicPdfTemplate,
  pdfTemplates,
};
