const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');

const CLOUD_FILE_ROOT = 'cloud://cloudbase-d6gt24wo5bc8f4e49.636c-cloudbase-d6gt24wo5bc8f4e49-1449758889';
const CLOUD_BUCKET = CLOUD_FILE_ROOT.slice('cloud://'.length).split('.')[1];
const SUPPORTED_COUNTRIES = new Set(['Italy', 'Japan']);

function cloudFile(key) {
  return `${CLOUD_FILE_ROOT}/${String(key || '').replace(/^\/+/, '')}`;
}

function stableTemplateId(country, versionDir, pdfFilename) {
  const digest = crypto
    .createHash('sha1')
    .update(`${country}/${versionDir}/${pdfFilename}`)
    .digest('hex')
    .slice(0, 16);
  return `cloud-${country.toLowerCase()}-${digest}`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getObjectKey(item) {
  return typeof item === 'string' ? item : item && item.Key;
}

function parseCountryFormObjects(country, contents) {
  const root = `country_forms/${country}/`;
  const groups = {};

  asArray(contents).forEach((item) => {
    const key = getObjectKey(item);
    if (!key || key.indexOf(root) !== 0) return;
    const rest = key.slice(root.length);
    const firstSlash = rest.indexOf('/');
    if (firstSlash <= 0) return;
    const versionDir = rest.slice(0, firstSlash);
    if (!groups[versionDir]) groups[versionDir] = [];
    groups[versionDir].push(typeof item === 'string' ? { Key: item } : item);
  });

  const versions = [];
  Object.keys(groups).sort().forEach((versionDir) => {
    const objects = groups[versionDir];
    const versionRoot = `${root}${versionDir}/`;
    const pdfs = objects.filter((item) => {
      const key = getObjectKey(item) || '';
      return key.indexOf(`${versionRoot}commonforms/`) === 0 && /\.pdf$/i.test(key);
    });
    const schemas = objects.filter((item) => {
      const key = getObjectKey(item) || '';
      return key.indexOf(`${versionRoot}outputs/`) === 0 && /\.parsed\.simple\.json$/i.test(key);
    });
    const previews = objects.map((item) => {
      const key = getObjectKey(item) || '';
      const match = new RegExp(`^${versionRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}preview/page-(\\d+)\\.png$`, 'i').exec(key);
      return match ? { page: Number(match[1]), key } : null;
    }).filter(Boolean).sort((left, right) => left.page - right.page);

    pdfs.forEach((pdf) => {
      const pdfKey = getObjectKey(pdf);
      const pdfFilename = pdfKey.slice(pdfKey.lastIndexOf('/') + 1);
      const pdfBaseName = pdfFilename.replace(/\.pdf$/i, '');
      const expectedSchemaKey = `${versionRoot}outputs/${pdfBaseName}.parsed.simple.json`;
      const schema = schemas.find((item) => getObjectKey(item) === expectedSchemaKey) || schemas[0];
      versions.push({
        id: stableTemplateId(country, versionDir, pdfFilename),
        country,
        versionDir,
        pdfFilename,
        name: pdfBaseName,
        version: versionDir,
        publishedAt: pdf.LastModified ? String(pdf.LastModified).slice(0, 10) : '',
        scope: '云存储版本',
        status: 'active',
        sourcePdf: cloudFile(pdfKey),
        editablePdf: cloudFile(pdfKey),
        editableFilename: pdfFilename,
        acroformSchema: schema ? cloudFile(getObjectKey(schema)) : '',
        previewPattern: cloudFile(`${versionRoot}preview/page-{page}.png`),
        previewPages: previews.map((item) => item.page),
        availableForFill: !!schema && previews.length > 0,
      });
    });
  });

  return versions.sort((left, right) => {
    const dateOrder = String(right.publishedAt).localeCompare(String(left.publishedAt));
    return dateOrder || left.versionDir.localeCompare(right.versionDir, 'zh-CN');
  });
}

function createCosClient() {
  const SecretId = process.env.TENCENTCLOUD_SECRETID;
  const SecretKey = process.env.TENCENTCLOUD_SECRETKEY;
  const SecurityToken = process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_TOKEN;
  if (!SecretId || !SecretKey) {
    throw new Error('云函数运行环境缺少腾讯云临时访问凭证');
  }
  return new COS({ SecretId, SecretKey, SecurityToken });
}

async function listObjectsByPrefix(prefix) {
  const Region = process.env.TENCENTCLOUD_REGION;
  if (!Region) throw new Error('云函数运行环境缺少 TENCENTCLOUD_REGION');
  const cos = createCosClient();
  const contents = [];
  let marker = '';
  let pageCount = 0;

  do {
    const data = await cos.getBucket({
      Bucket: CLOUD_BUCKET,
      Region,
      Prefix: prefix,
      Marker: marker,
      MaxKeys: 1000,
    });
    contents.push(...asArray(data.Contents));
    marker = (data.IsTruncated === true || data.IsTruncated === 'true') ? (data.NextMarker || '') : '';
    pageCount += 1;
    if (pageCount > 100) throw new Error('云存储目录对象超过扫描上限');
  } while (marker);

  return contents;
}

async function listCountryFormVersions(event) {
  const country = String(event.country || 'Italy');
  if (!SUPPORTED_COUNTRIES.has(country)) {
    return { success: false, errMsg: `Unsupported country: ${country}` };
  }
  const prefix = `country_forms/${country}/`;
  const contents = await listObjectsByPrefix(prefix);
  const versions = parseCountryFormObjects(country, contents);
  return {
    success: true,
    apiVersion: 'country-form-catalog-v1',
    country,
    versions,
    total: versions.length,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  CLOUD_BUCKET,
  listCountryFormVersions,
  parseCountryFormObjects,
  stableTemplateId,
};
