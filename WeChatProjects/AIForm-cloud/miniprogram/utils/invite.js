const CLOUD_FUNCTION = 'picture_acroforms_merge_function';

function isFunctionNotFound(err) {
  const message = String((err && (err.errMsg || err.message)) || err || '');
  return message.indexOf('FUNCTION_NOT_FOUND') >= 0 || message.indexOf('-501000') >= 0;
}

function wrapFunctionError(err) {
  if (isFunctionNotFound(err)) {
    const wrapped = new Error('云端没有找到 picture_acroforms_merge_function。请确认已上传部署云函数，并且使用的是同一个云环境。');
    wrapped.code = 'FUNCTION_NOT_FOUND';
    return wrapped;
  }
  return err instanceof Error ? err : new Error(String((err && (err.errMsg || err.message)) || err || '未知错误'));
}

// 创建邀请单：把邀请人选择分享的字段值写入云端，返回 inviteId。
function createInvite({ templateId, templateVersion, mode, values }) {
  if (!wx.cloud) return Promise.reject(new Error('当前微信基础库不支持云能力'));
  return wx.cloud.callFunction({
    name: CLOUD_FUNCTION,
    data: {
      type: 'createInvite',
      templateId,
      templateVersion: templateVersion || null,
      mode: mode === 'blank' ? 'blank' : 'content',
      values: values || {},
    },
  }).then((res) => {
    const result = (res && res.result) || {};
    if (!result.success || !result.inviteId) {
      throw new Error(result.errMsg || '创建邀请失败');
    }
    return result.inviteId;
  }).catch((err) => {
    throw wrapFunctionError(err);
  });
}

// 按 inviteId 读取邀请单。
function fetchInvite(inviteId) {
  if (!inviteId) return Promise.reject(new Error('inviteId is required'));
  if (!wx.cloud) return Promise.reject(new Error('当前微信基础库不支持云能力'));
  return wx.cloud.callFunction({
    name: CLOUD_FUNCTION,
    data: {
      type: 'getInvite',
      inviteId,
    },
  }).then((res) => {
    const result = (res && res.result) || {};
    if (!result.success || !result.invite) {
      const err = new Error(result.errMsg || '邀请不存在或已过期');
      err.code = result.errCode || 'INVITE_NOT_FOUND';
      throw err;
    }
    return result.invite;
  }).catch((err) => {
    throw wrapFunctionError(err);
  });
}

module.exports = {
  createInvite,
  fetchInvite,
};
