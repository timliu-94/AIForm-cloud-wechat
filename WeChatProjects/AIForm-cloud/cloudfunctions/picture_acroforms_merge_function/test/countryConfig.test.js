const assert = require('assert');
const crypto = require('crypto');
const {
  COUNTRY_CATALOG_VERSION,
  countries,
  getTemplateConfig,
  validateCountryConfig,
} = require('../../../miniprogram/config/countryConfig');
const {
  findTemplate,
  visaCatalog,
} = require('../../../miniprogram/utils/visaData');

assert.deepStrictEqual(validateCountryConfig(), []);
assert.match(COUNTRY_CATALOG_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
assert.strictEqual(countries.length, 5);
assert.strictEqual(visaCatalog.length, 5);

const templates = countries.flatMap((country) => country.templates);
assert.strictEqual(templates.length, 15);
assert.strictEqual(new Set(templates.map((template) => template.id)).size, templates.length);

templates.forEach((template) => {
  const digest = crypto
    .createHash('sha1')
    .update(`${template.country}/${template.versionDir}/${template.pdfFilename}`)
    .digest('hex')
    .slice(0, 16);
  assert.strictEqual(template.id, `cloud-${template.country.toLowerCase()}-${digest}`);
  assert.ok(template.assets.sourcePdf.includes(
    `/country_forms/${template.country}/${template.versionDir}/commonforms/${template.pdfFilename}`,
  ));
  assert.ok(template.assets.acroformSchema.endsWith('.parsed.simple.json'));
  assert.ok(findTemplate(template.id), `${template.id} should be discoverable from config`);
});

assert.strictEqual(
  getTemplateConfig('it-schengen-tourism-shanghai-demo').template.id,
  'cloud-italy-41b261e471b4df79',
);
assert.strictEqual(
  getTemplateConfig('jp-tourism-2026-01').template.id,
  'cloud-japan-20d1ebfb26b32018',
);

console.log('country config tests passed');
