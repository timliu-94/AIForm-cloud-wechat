const CACHE_PREFIX = 'country_form_catalog_v1:';
const COUNTRIES_CACHE_KEY = 'country_form_countries_v1';
const CACHE_TTL = 10 * 60 * 1000;
const CATALOG_COUNTRIES = ['Italy', 'Japan'];
const memoryVersions = {};
let memoryCountries = null;

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

function readCountriesCache(allowExpired) {
  const cached = memoryCountries || wx.getStorageSync(COUNTRIES_CACHE_KEY);
  if (!cached || !Array.isArray(cached.countries)) return null;
  if (!allowExpired && cached.expiresAt < Date.now()) return null;
  memoryCountries = cached;
  return cached.countries;
}

function writeCountriesCache(countries) {
  memoryCountries = {
    expiresAt: Date.now() + CACHE_TTL,
    countries,
  };
  wx.setStorageSync(COUNTRIES_CACHE_KEY, memoryCountries);
}

function isCountriesAPIUnavailable(err) {
  const message = String((err && (err.errMsg || err.message)) || err || '');
  return err && err.code === 'COUNTRIES_API_VERSION_MISMATCH'
    && /Unsupported function type:\s*listCountryFormCountries/i.test(message);
}

function listCountryFormCountries(options = {}) {
  if (!options.force) {
    const cached = readCountriesCache(false);
    if (cached) return Promise.resolve(cached);
  }
  if (!wx.cloud) return Promise.reject(new Error('当前微信基础库不支持云能力'));

  return wx.cloud.callFunction({
    name: 'picture_acroforms_merge_function',
    data: {
      type: 'listCountryFormCountries',
    },
  }).then((res) => {
    if (!res || res.result === undefined || res.result === null) {
      const err = new Error('云函数未返回国家目录接口结果，请重新部署 picture_acroforms_merge_function');
      err.code = 'COUNTRIES_API_NOT_DEPLOYED';
      throw err;
    }
    const result = res.result;
    if (result.apiVersion !== 'country-form-countries-v1') {
      const err = new Error(result.errMsg || '云函数国家目录接口版本不匹配，请重新部署 picture_acroforms_merge_function');
      err.code = result.errCode || 'COUNTRIES_API_VERSION_MISMATCH';
      throw err;
    }
    if (!result.success || !Array.isArray(result.countries)) {
      throw new Error(result.errMsg || '云端国家目录读取失败');
    }
    const countries = result.countries.filter((country) => typeof country === 'string' && country);
    writeCountriesCache(countries);
    return countries;
  }).catch((err) => {
    const stale = readCountriesCache(true);
    if (stale) return stale;
    // 兼容尚未部署国家目录接口的旧版云函数。这里只返回旧接口明确支持的国家，
    // 不写入缓存；云函数更新后，下次进入首页会立即重新尝试动态目录接口。
    if (isCountriesAPIUnavailable(err)) {
      console.warn('Country directory API is not deployed; using legacy catalog countries.');
      return CATALOG_COUNTRIES.slice();
    }
    throw err;
  });
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
  const cachedCountryDirectories = readCountriesCache(true) || [];
  const catalogCountries = Array.from(new Set(CATALOG_COUNTRIES.concat(cachedCountryDirectories)));
  for (let i = 0; i < catalogCountries.length; i += 1) {
    const versions = readCache(catalogCountries[i], true) || [];
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
  listCountryFormCountries,
  listCountryFormVersions,
  openCloudPdf,
};
