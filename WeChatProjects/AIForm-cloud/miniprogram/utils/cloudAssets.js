const CLOUD_FILE_ROOT = 'cloud://cloudbase-d6gt24wo5bc8f4e49.636c-cloudbase-d6gt24wo5bc8f4e49-1449758889';
const resolvedURLCache = {};
const jsonCache = {};
const jsonRequestCache = {};
const DOWNLOAD_RETRY_DELAYS = [400, 1000];

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

// 依据版本目录约定推导 AcroForm schema 的云路径：
//   country_forms/<country>/<versionDir>/outputs/<pdfBaseName>.parsed.simple.json
// 与云函数 catalog/countryFormCatalog.js 的命名保持一致，用于版本对象缺失
// acroformSchema 字段时的兜底（不同版本文件夹即不同表格版本）。
function countryFormSchemaAsset(country, versionDir, pdfFilename) {
  if (!country || !versionDir || !pdfFilename) return '';
  const baseName = String(pdfFilename).replace(/\.pdf$/i, '');
  if (!baseName) return '';
  return countryFormAsset(country, versionDir, 'outputs', `${baseName}.parsed.simple.json`);
}

function isCloudFileID(fileID) {
  return typeof fileID === 'string' && fileID.indexOf('cloud://') === 0;
}

function getErrorMessage(err) {
  return String((err && (err.errMsg || err.message)) || err || '');
}

function isTransientDownloadError(err) {
  return /(ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|timeout|超时|连接.*(?:中断|重置|失败))/i
    .test(getErrorMessage(err));
}

// downloadFile 回调成功后，其返回的 http://tmp/... 临时文件可能已被微信清理，
// 导致紧随其后的 readFile 报 “not found”。这类读取失败靠重新下载（拿到新的
// 临时文件）即可恢复，因此与网络错误一样按可重试处理。
function isMissingTempFileError(err) {
  return /readFile:fail[\s\S]*not found|access:fail|文件不存在|no such file/i
    .test(getErrorMessage(err));
}

function isRetryableJSONError(err) {
  return isTransientDownloadError(err) || isMissingTempFileError(err);
}

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function downloadCloudFile(fileID, attempt = 0) {
  if (!isCloudFileID(fileID)) {
    return Promise.reject(new Error(`无效的云端 File ID: ${fileID || '(empty)'}`));
  }
  if (!wx.cloud) return Promise.reject(new Error('当前微信基础库不支持云能力'));

  return wx.cloud.downloadFile({ fileID }).catch((err) => {
    const retryDelay = DOWNLOAD_RETRY_DELAYS[attempt];
    if (retryDelay === undefined || !isTransientDownloadError(err)) throw err;
    console.warn('Cloud file download interrupted, retrying:', {
      attempt: attempt + 2,
      fileID,
      errMsg: getErrorMessage(err),
    });
    return wait(retryDelay).then(() => downloadCloudFile(fileID, attempt + 1));
  });
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

// 下载并读取云端 JSON。downloadFile 与 readFile 作为一个整体重试：任一环节
// 命中可重试错误（网络中断、临时文件丢失）时都重新下载，拿到新的临时文件再读。
function downloadAndReadJSON(fileID, attempt = 0) {
  return downloadCloudFile(fileID)
    .then((res) => {
      if (!res.tempFilePath) throw new Error('云端 JSON 下载结果缺少临时文件路径');
      return readJSONFile(res.tempFilePath);
    })
    .catch((err) => {
      const retryDelay = DOWNLOAD_RETRY_DELAYS[attempt];
      if (retryDelay === undefined || !isRetryableJSONError(err)) throw err;
      console.warn('Cloud JSON download/read failed, retrying:', {
        attempt: attempt + 2,
        fileID,
        errMsg: getErrorMessage(err),
      });
      return wait(retryDelay).then(() => downloadAndReadJSON(fileID, attempt + 1));
    });
}

function downloadCloudJSON(fileID) {
  if (!isCloudFileID(fileID)) {
    return Promise.reject(new Error(`无效的云端 JSON File ID: ${fileID || '(empty)'}`));
  }
  if (jsonCache[fileID]) return Promise.resolve(jsonCache[fileID]);
  if (jsonRequestCache[fileID]) return jsonRequestCache[fileID];
  if (!wx.cloud) return Promise.reject(new Error('当前微信基础库不支持云能力'));

  const request = downloadAndReadJSON(fileID)
    .then((data) => {
      jsonCache[fileID] = data;
      delete jsonRequestCache[fileID];
      return data;
    })
    .catch((err) => {
      delete jsonRequestCache[fileID];
      if (isRetryableJSONError(err)) {
        const wrapped = new Error('云端表单资源下载连接中断，请检查网络后重试');
        wrapped.code = 'CLOUD_DOWNLOAD_INTERRUPTED';
        wrapped.originalError = err;
        throw wrapped;
      }
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
  countryFormSchemaAsset,
  downloadCloudFile,
  downloadCloudJSON,
  getTempFileURLs,
  isCloudFileID,
  resolvePreviewImages,
};
