const CLOUD_FILE_ROOT = 'cloud://cloudbase-d6gt24wo5bc8f4e49.636c-cloudbase-d6gt24wo5bc8f4e49-1449758889';
const resolvedURLCache = {};

function countryFormFile(country, filename) {
  return `${CLOUD_FILE_ROOT}/country_forms/${country}/${filename}`;
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
  countryFormFile,
  getTempFileURLs,
  isCloudFileID,
  resolvePreviewImages,
};
