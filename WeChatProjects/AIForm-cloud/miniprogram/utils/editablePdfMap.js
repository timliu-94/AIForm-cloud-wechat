const { countryFormFile } = require('./cloudAssets');

const editablePdfMap = {
  'it-schengen-tourism-shanghai-demo': {
    fileID: countryFormFile('Italy', '意大利-上海领区-短期签证申请表.pdf'),
    filename: '意大利-上海领区-短期签证申请表.pdf',
    fileType: 'pdf',
  },
};

function getEditablePdf(templateId) {
  return editablePdfMap[templateId] || null;
}

module.exports = {
  editablePdfMap,
  getEditablePdf,
};
