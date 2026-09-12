const assert = require('assert');

let pageDefinition = null;
global.Page = (definition) => {
  pageDefinition = definition;
};

require('../../../miniprogram/pages/home/index');

assert.ok(pageDefinition);
assert.strictEqual(pageDefinition.loadCountryFormCatalog, undefined);

const page = {
  ...pageDefinition,
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(next) {
    this.data = { ...this.data, ...next };
  },
};

page.onLoad();
assert.strictEqual(page.runtimeVisaCatalog.length, 5);
assert.strictEqual(page.data.countries.length, 5);
assert.ok(page.data.countries.every((country) => country.visaTypes.length > 0));
assert.deepStrictEqual(page.data.continents, ['欧洲', '亚洲']);
assert.deepStrictEqual(page.data.destinationFilters, ['热门', '欧洲', '亚洲']);
['iceland', 'italy', 'spain', 'switzerland'].forEach((countryId) => {
  const country = page.data.countries.find((item) => item.id === countryId);
  assert.ok(country, `${countryId} should appear on home page`);
  assert.deepStrictEqual(
    [...new Set(country.visaTypes.map((visaType) => visaType.name))],
    ['短期签证'],
  );
});

page.runtimeVisaCatalog = [
  ...page.runtimeVisaCatalog,
  {
    id: 'canada',
    name: '加拿大',
    continent: '北美洲',
    hot: false,
    visaTypes: [{ id: 'application', name: '签证申请表', districts: [] }],
  },
];
page.refreshCountries();
assert.ok(!page.data.continents.includes('北美洲'));
assert.ok(!page.data.countries.some((country) => country.id === 'canada'));

console.log('home config catalog tests passed');
