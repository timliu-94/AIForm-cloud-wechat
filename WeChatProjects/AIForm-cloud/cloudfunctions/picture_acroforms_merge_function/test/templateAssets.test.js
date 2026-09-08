const assert = require('assert');
const {
  CONFIGURED_COUNTRIES,
  getDynamicPdfTemplate,
} = require('../pdf/templateAssets');
const {
  countries,
  isEnabled,
} = require('../../../miniprogram/config/countryConfig');

const configuredDirectories = countries.filter(isEnabled).map((country) => country.cloudDirectory);
assert.deepStrictEqual(Array.from(CONFIGURED_COUNTRIES).sort(), configuredDirectories.sort());

configuredDirectories.forEach((country) => {
  const template = getDynamicPdfTemplate({
    country,
    versionDir: 'version',
    pdfFilename: 'form.pdf',
  });
  assert.ok(template, `${country} should be allowed`);
  assert.ok(template.fileID.includes(`/country_forms/${country}/version/commonforms/form.pdf`));
});

assert.strictEqual(getDynamicPdfTemplate({
  country: 'France',
  versionDir: 'version',
  pdfFilename: 'form.pdf',
}), null);
assert.strictEqual(getDynamicPdfTemplate({
  country: 'Italy',
  versionDir: '../private',
  pdfFilename: 'form.pdf',
}), null);

console.log('template asset allowlist tests passed');
