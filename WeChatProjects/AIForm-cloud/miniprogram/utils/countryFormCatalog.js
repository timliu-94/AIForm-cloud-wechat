const CACHE_PREFIX = 'country_form_catalog_v1:';
const CACHE_TTL = 10 * 60 * 1000;
const CATALOG_COUNTRIES = ['Italy', 'Japan'];
const memoryVersions = {};

function cacheKey(country) {
  return `${CACHE_PREFIX}${country}`;
}

function readCache(country, allowExpired) {
  if (memoryVersions[country]) return memoryVersions[country];
  const cached = wx.getStorageSync(cacheKey(country));
  if (!cached || !Array.isArray(cached.versions)) return null;
  if (!allowExpired && cached.expiresAt < Date.now()) return null;
  memoryVersions[country] = cached.versions;
  return cached.versions;
}

function writeCache(country, versions) {
  memoryVersions[country] = versions;
  wx.setStorageSync(cacheKey(country), {
    expiresAt: Date.now() + CACHE_TTL,
    versions,
  });
}

function normalizeVersion(version) {
  return {
    ...version,
    name: version.name || version.pdfFilename || version.versionDir,
    version: version.version || version.versionDir,
    publishedAt: version.publishedAt || '',
    scope: version.scope || '云存储版本',
    status: version.status || 'active',
    dynamic: true,
    assets: {
      sourcePdf: version.sourcePdf,
      editablePdf: version.editablePdf || version.sourcePdf,
      editableFilename: version.editableFilename || version.pdfFilename,
      acroformSchema: version.acroformSchema || '',
      previewImages: {
        pattern: version.previewPattern || '',
        pages: version.previewPages || [],
      },
    },
  };
}

function listCountryFormVersions(country, options = {}) {
  if (!options.force) {
    const cached = readCache(country, false);
    if (cached) return Promise.resolve(cached);
  }
  if (!wx.cloud) return Promise.reject(new Error('当前微信基础库不支持云能力'));

  return wx.cloud.callFunction({
    name: 'picture_acroforms_merge_function',
    data: {
      type: 'listCountryFormVersions',
      country,
    },
  }).then((res) => {
    if (!res || res.result === undefined || res.result === null) {
      const err = new Error('云函数未返回目录接口结果，请重新部署 picture_acroforms_merge_function');
      err.code = 'CATALOG_API_NOT_DEPLOYED';
      throw err;
    }
    const result = res.result;
    if (result.apiVersion !== 'country-form-catalog-v1') {
      const err = new Error(result.errMsg || '云函数目录接口版本不匹配，请重新部署 picture_acroforms_merge_function');
      err.code = result.errCode || 'CATALOG_API_VERSION_MISMATCH';
      throw err;
    }
    if (!result.success || !Array.isArray(result.versions)) {
      throw new Error(result.errMsg || '云端申请表目录读取失败');
    }
    const versions = result.versions.map(normalizeVersion);
    writeCache(country, versions);
    return versions;
  }).catch((err) => {
    const stale = readCache(country, true);
    if (stale) return stale;
    throw err;
  });
}

function findCachedCountryFormVersion(templateId) {
  const countries = Object.keys(memoryVersions);
  for (let i = 0; i < countries.length; i += 1) {
    const found = (memoryVersions[countries[i]] || []).find((item) => item.id === templateId);
    if (found) return found;
  }
  for (let i = 0; i < CATALOG_COUNTRIES.length; i += 1) {
    const versions = readCache(CATALOG_COUNTRIES[i], true) || [];
    const found = versions.find((item) => item.id === templateId);
    if (found) return found;
  }
  return null;
}

function openCloudPdf(fileID) {
  if (!fileID) return Promise.reject(new Error('该版本未配置 PDF 云路径'));
  wx.showLoading({ title: 'PDF 加载中', mask: true });
  return wx.cloud.downloadFile({ fileID })
    .then((res) => new Promise((resolve, reject) => {
      wx.openDocument({
        filePath: res.tempFilePath,
        fileType: 'pdf',
        showMenu: true,
        success: resolve,
        fail: reject,
      });
    }))
    .then((result) => {
      wx.hideLoading();
      return result;
    })
    .catch((err) => {
      wx.hideLoading();
      throw err;
    });
}

module.exports = {
  findCachedCountryFormVersion,
  listCountryFormVersions,
  openCloudPdf,
};
