function confirmA3PrintOrder() {
  return new Promise((resolve) => {
    wx.showModal({
      title: 'A3 打印顺序',
      content: '是否把 PDF 调整成 A3 打印顺序？',
      confirmText: '是',
      cancelText: '否',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

function exportApplicationPdf(application, title) {
  if (!application) {
    return Promise.reject(new Error('Application is required'));
  }
  if (!wx.cloud) {
    return Promise.reject(new Error('Cloud is unavailable'));
  }

  return confirmA3PrintOrder().then((a3PrintOrder) => {
    wx.showLoading({
      title: '生成中',
      mask: true,
    });

    return wx.cloud.callFunction({
      name: 'picture_acroforms_merge_function',
      data: {
        type: 'fillPdfAcroForm',
        templateId: application.templateId || 'italy',
        templateAsset: application.templateVersion ? {
          country: application.templateVersion.country,
          versionDir: application.templateVersion.versionDir,
          pdfFilename: application.templateVersion.pdfFilename,
        } : null,
        title,
        values: application.values || {},
        options: {
          flatten: false,
          updateAppearances: false,
          a3PrintOrder,
        },
      },
    });
  }).then((res) => {
    const result = res.result || {};
    if (!result.success || !result.fileID) {
      console.error('Generate PDF failed:', result);
      const err = new Error(result.errMsg || 'Generate PDF failed');
      err.stage = 'generate';
      err.result = result;
      throw err;
    }
    console.log('Generate PDF result:', {
      fileID: result.fileID,
      filledCount: (result.filledFields || []).length,
      missingCount: (result.missingFields || []).length,
      failedCount: (result.failedFields || []).length,
      unsupportedCount: (result.unsupportedFields || []).length,
      sampleMissingFields: (result.missingFields || []).slice(0, 20),
      sampleFailedFields: (result.failedFields || []).slice(0, 10),
      sampleUnsupportedFields: (result.unsupportedFields || []).slice(0, 20),
    });
    wx.showLoading({
      title: '下载中',
      mask: true,
    });
    return wx.cloud.downloadFile({ fileID: result.fileID }).then((downloadRes) => (
      new Promise((resolve, reject) => {
        wx.openDocument({
          filePath: downloadRes.tempFilePath,
          fileType: 'pdf',
          showMenu: true,
          success: () => resolve(result),
          fail: (err) => {
            err.stage = 'openDocument';
            reject(err);
          },
        });
      })
    )).catch((err) => {
      if (!err.stage) err.stage = 'download';
      throw err;
    });
  }).then((result) => {
    wx.hideLoading();
    return result;
  }).catch((err) => {
    wx.hideLoading();
    throw err;
  });
}

function getPdfExportErrorTitle(err) {
  const message = String((err && (err.errMsg || err.message)) || err || '');
  if (message.indexOf('FUNCTION_NOT_FOUND') >= 0 || message.indexOf('-501000') >= 0) {
    return '请先部署云函数';
  }
  return '导出失败';
}

function getPdfExportErrorMessage(err) {
  const result = err && err.result;
  if (result) {
    const parts = [
      result.errMsg,
      `filled=${(result.filledFields || []).length}`,
      `missing=${(result.missingFields || []).length}`,
      `failed=${(result.failedFields || []).length}`,
    ].filter(Boolean);
    const firstFailed = result.failedFields && result.failedFields[0];
    if (firstFailed) parts.push(`${firstFailed.field}: ${firstFailed.message}`);
    return parts.join('\n');
  }

  const message = String((err && (err.errMsg || err.message)) || err || '未知错误');
  if (message.indexOf('FUNCTION_NOT_FOUND') >= 0 || message.indexOf('-501000') >= 0) {
    return '云端没有找到 picture_acroforms_merge_function。请确认已上传部署云函数，并且手机预览使用的是同一个云环境。';
  }
  const stage = err && err.stage ? `阶段：${err.stage}\n` : '';
  return `${stage}${message}`;
}

module.exports = {
  exportApplicationPdf,
  getPdfExportErrorMessage,
  getPdfExportErrorTitle,
};
