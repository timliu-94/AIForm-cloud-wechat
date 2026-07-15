const CLOUD_FILE_ROOT = 'cloud://cloudbase-d6gt24wo5bc8f4e49.636c-cloudbase-d6gt24wo5bc8f4e49-1449758889';
const ITALY_TEMPLATE_ID = 'it-schengen-tourism-shanghai-demo';
const ITALY_COUNTRY_DIR = 'Italy';
const ITALY_VERSION_DIR = '上海_申根签证申请表（90天以内）';
const ITALY_PDF_FILENAME = '上海_申根签证申请表（90天以内）.pdf';

function countryFormAsset(country, versionDir, assetDir, filename) {
  return `${CLOUD_FILE_ROOT}/country_forms/${country}/${versionDir}/${assetDir}/${filename}`;
}

const italyPdfFileID = countryFormAsset(
  ITALY_COUNTRY_DIR,
  ITALY_VERSION_DIR,
  'commonforms',
  ITALY_PDF_FILENAME,
);

const pdfTemplates = {
  italy: {
    fileID: italyPdfFileID,
    filename: ITALY_PDF_FILENAME,
    fieldMap: {},
  },
  [ITALY_TEMPLATE_ID]: {
    fileID: italyPdfFileID,
    filename: ITALY_PDF_FILENAME,
    fieldMap: {},
  },
};

function getDynamicPdfTemplate(asset) {
  if (!asset) return null;
  const { country, versionDir, pdfFilename } = asset;
  if (country !== 'Italy') return null;
  if (!versionDir || versionDir === '.' || versionDir === '..' || /[\\/]/.test(versionDir)) return null;
  if (!pdfFilename || /[\\/]/.test(pdfFilename) || !/\.pdf$/i.test(pdfFilename)) return null;
  return {
    fileID: countryFormAsset(country, versionDir, 'commonforms', pdfFilename),
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
