const { getTemplateAsset } = require('../config/countryConfig');

const ITALY_TEMPLATE_ID = 'it-schengen-tourism-shanghai-demo';

const editablePdfMap = {
  [ITALY_TEMPLATE_ID]: {
    fileID: getTemplateAsset(ITALY_TEMPLATE_ID, 'editablePdf'),
    filename: getTemplateAsset(ITALY_TEMPLATE_ID, 'editableFilename'),
    fileType: 'pdf',
  },
};

function getEditablePdf(templateId) {
  if (templateId === 'italy') return editablePdfMap[ITALY_TEMPLATE_ID];
  return editablePdfMap[templateId] || null;
}

module.exports = {
  editablePdfMap,
  getEditablePdf,
};
