const CLOUD_FILE_ROOT = 'cloud://cloudbase-d6gt24wo5bc8f4e49.636c-cloudbase-d6gt24wo5bc8f4e49-1449758889';

function countryFormFile(country, filename) {
  return `${CLOUD_FILE_ROOT}/country_forms/${country}/${filename}`;
}

const pdfTemplates = {
  italy: {
    fileID: countryFormFile('Italy', '意大利-上海领区-短期签证申请表.pdf'),
    filename: '意大利-上海领区-短期签证申请表.pdf',
    fieldMap: {},
  },
  'it-schengen-tourism-shanghai-demo': {
    fileID: countryFormFile('Italy', '意大利-上海领区-短期签证申请表.pdf'),
    filename: '意大利-上海领区-短期签证申请表.pdf',
    fieldMap: {},
  },
};

function getPdfTemplate(templateId) {
  return pdfTemplates[templateId] || null;
}

module.exports = {
  getPdfTemplate,
  pdfTemplates,
};
