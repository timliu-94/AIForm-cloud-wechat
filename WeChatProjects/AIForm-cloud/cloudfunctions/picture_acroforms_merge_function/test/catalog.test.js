const assert = require('assert');
const {
  parseCountryDirectories,
  parseCountryFormObjects,
} = require('../catalog/countryFormCatalog');

function testCountryDirectoryParsing() {
  assert.deepStrictEqual(parseCountryDirectories([
    { Prefix: 'country_forms/Spain/' },
    { Prefix: 'country_forms/Italy/' },
    { Prefix: 'country_forms/Spain/' },
    { Prefix: 'country_flag/' },
    { Prefix: 'country_forms/Japan/nested/' },
  ]), ['Italy', 'Spain']);
}

function testUnlistedCountryVersionParsing() {
  const versionDir = '上海_申根签证申请表（90天以内）';
  const pdfName = `${versionDir}.pdf`;
  const root = `country_forms/Spain/${versionDir}/`;
  const versions = parseCountryFormObjects('Spain', [
    { Key: `${root}commonforms/${pdfName}`, LastModified: '2026-08-30T03:00:00.000Z' },
    { Key: `${root}outputs/${versionDir}.parsed.simple.json` },
    { Key: `${root}preview/page-1.png` },
    { Key: `${root}preview/page-2.png` },
  ]);

  assert.strictEqual(versions.length, 1);
  assert.strictEqual(versions[0].country, 'Spain');
  assert.strictEqual(versions[0].availableForFill, true);
  assert.deepStrictEqual(versions[0].previewPages, [1, 2]);
  assert.ok(versions[0].sourcePdf.includes(`/country_forms/Spain/${versionDir}/commonforms/${pdfName}`));
}

testCountryDirectoryParsing();
testUnlistedCountryVersionParsing();
console.log('country form catalog tests passed');
