const CLOUD_FILE_ROOT = 'cloud://cloudbase-d6gt24wo5bc8f4e49.636c-cloudbase-d6gt24wo5bc8f4e49-1449758889';
const resolvedURLCache = {};
const jsonCache = {};
const jsonRequestCache = {};

function normalizeCloudPath(path) {
  return String(path || '').replace(/^\/+|\/+$/g, '');
}

function cloudFile(path) {
  return `${CLOUD_FILE_ROOT}/${normalizeCloudPath(path)}`;
}

function countryFlagFile(iso2) {
  return cloudFile(`country_flag/${String(iso2 || '').toLowerCase()}.png`);
}

function countryFormFile(country, filename) {
  return cloudFile(`country_forms/${country}/${filename}`);
}

function countryFormAsset(country, versionDir, assetDir, filename) {
  return cloudFile([
    'country_forms',
    country,
    versionDir,
    assetDir,
    filename,
  ].map(normalizeCloudPath).filter(Boolean).join('/'));
}

function isCloudFileID(fileID) {
  return typeof fileID === 'string' && fileID.indexOf('cloud://') === 0;
}

function getTempFileURLs(fileList) {
  const list = fileList || [];
  const cloudFiles = list.filter(isCloudFileID);
  if (!cloudFiles.length) {
    return Promise.resolve(list);
  }
  if (!wx.cloud) {
    return Promise.resolve(list.map((fileID) => (isCloudFileID(fileID) ? '' : fileID)));
  }

  const pendingCloudFiles = cloudFiles.filter((fileID) => !resolvedURLCache[fileID]);
  if (!pendingCloudFiles.length) {
    return Promise.resolve(list.map((fileID) => (isCloudFileID(fileID) ? resolvedURLCache[fileID] : fileID)));
  }

  return wx.cloud.getTempFileURL({ fileList: pendingCloudFiles }).then((res) => {
    const urlMap = {};
    (res.fileList || []).forEach((item) => {
      if (item.status === 0 && item.tempFileURL) {
        urlMap[item.fileID] = item.tempFileURL;
      } else {
        console.error('Get temp file URL failed:', item);
        urlMap[item.fileID] = '';
      }
      resolvedURLCache[item.fileID] = urlMap[item.fileID];
    });
    return list.map((fileID) => (isCloudFileID(fileID) ? (resolvedURLCache[fileID] || '') : fileID));
  });
}

function readJSONFile(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'utf8',
      success: (res) => {
        try {
          resolve(JSON.parse(res.data));
        } catch (err) {
          reject(new Error(`云端 JSON 解析失败: ${err.message || err}`));
        }
      },
      fail: (err) => reject(new Error(`云端 JSON 读取失败: ${err.errMsg || err}`)),
    });
  });
}

function downloadCloudJSON(fileID) {
  if (!isCloudFileID(fileID)) {
    return Promise.reject(new Error(`无效的云端 JSON File ID: ${fileID || '(empty)'}`));
  }
  if (jsonCache[fileID]) return Promise.resolve(jsonCache[fileID]);
  if (jsonRequestCache[fileID]) return jsonRequestCache[fileID];
  if (!wx.cloud) return Promise.reject(new Error('当前微信基础库不支持云能力'));

  const request = wx.cloud.downloadFile({ fileID })
    .then((res) => {
      if (!res.tempFilePath) throw new Error('云端 JSON 下载结果缺少临时文件路径');
      return readJSONFile(res.tempFilePath);
    })
    .then((data) => {
      jsonCache[fileID] = data;
      delete jsonRequestCache[fileID];
      return data;
    })
    .catch((err) => {
      delete jsonRequestCache[fileID];
      throw err;
    });
  jsonRequestCache[fileID] = request;
  return request;
}

function resolvePreviewImages(pages) {
  const list = pages || [];
  return getTempFileURLs(list.map((page) => page.previewImage)).then((urls) => (
    list.map((page, index) => ({
      ...page,
      previewImage: urls[index],
      cloudPreviewImage: page.previewImage,
    }))
  ));
}

module.exports = {
  CLOUD_FILE_ROOT,
  cloudFile,
  countryFlagFile,
  countryFormAsset,
  countryFormFile,
  downloadCloudJSON,
  getTempFileURLs,
  isCloudFileID,
  resolvePreviewImages,
};
