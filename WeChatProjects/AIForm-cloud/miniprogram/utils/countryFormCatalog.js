const CLOUD_FUNCTION = 'picture_acroforms_merge_function';

// 国家是发布白名单，具体表单版本以云存储目录为准。
function loadCloudCountryFormVersions(country) {
  if (!country) return Promise.reject(new Error('缺少国家云目录'));
  if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('当前环境不支持云函数'));
  }
  return wx.cloud.callFunction({
    name: CLOUD_FUNCTION,
    data: { type: 'listCountryFormVersions', country },
  }).then((response) => {
    const result = response && response.result;
    if (!result || result.success !== true || !Array.isArray(result.versions)) {
      throw new Error((result && result.errMsg) || `读取 ${country} 云存储版本失败`);
    }
    return result.versions;
  });
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
  loadCloudCountryFormVersions,
  openCloudPdf,
};
