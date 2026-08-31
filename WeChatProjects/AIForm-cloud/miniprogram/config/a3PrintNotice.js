// A3 打印提示按「云目录国家 + PDF 版本目录」配置。
// 意大利全部 PDF 版本在导出前均需询问；未命中的国家或版本默认不显示弹窗。
const A3_PRINT_NOTICE_CONFIG = {
  defaultEnabled: false,
  rules: [
    {
      country: 'Italy',
      pdfVersion: '*',
      enabled: true,
    },
    {
      country: 'Japan',
      pdfVersion: '*',
      enabled: false,
    },
  ],
};

function matchesRule(rule, country, pdfVersion) {
  return rule.country === country
    && (rule.pdfVersion === '*' || rule.pdfVersion === pdfVersion);
}

function shouldShowA3PrintNotice(templateVersion) {
  const version = templateVersion || {};
  const country = version.country || '';
  const filename = version.pdfFilename || version.editableFilename || '';
  const pdfVersion = version.versionDir || version.version || filename.replace(/\.pdf$/i, '');
  const rule = A3_PRINT_NOTICE_CONFIG.rules.find((item) => (
    matchesRule(item, country, pdfVersion)
  ));
  return rule ? rule.enabled === true : A3_PRINT_NOTICE_CONFIG.defaultEnabled;
}

module.exports = {
  A3_PRINT_NOTICE_CONFIG,
  shouldShowA3PrintNotice,
};
