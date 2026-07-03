import useToastBehavior from '~/behaviors/useToast';

const APPLICATIONS_KEY = 'visa_applications';

Page({
  behaviors: [useToastBehavior],

  data: {
    applicationCount: 0,
    settingList: [
      { name: '申请记录', icon: 'file', type: 'applications', url: '/pages/applications/index' },
      { name: '继续填写', icon: 'edit', type: 'fill', url: '/pages/visa-form/index?templateId=it-schengen-tourism-shanghai-demo' },
      { name: '清空本地草稿', icon: 'delete', type: 'clear', danger: true },
    ],
  },

  onShow() {
    this.setData({
      applicationCount: (wx.getStorageSync(APPLICATIONS_KEY) || []).length,
    });
  },

  onEleClick(e) {
    const { name, url, type } = e.currentTarget.dataset.data;
    if (url) {
      if (url.indexOf('/pages/applications/index') === 0) {
        wx.switchTab({ url });
        return;
      }
      wx.navigateTo({ url });
      return;
    }

    if (type === 'clear') {
      wx.showModal({
        title: '清空本地草稿',
        content: '这会删除本机保存的所有申请记录。',
        success: (res) => {
          if (!res.confirm) return;
          wx.removeStorageSync(APPLICATIONS_KEY);
          this.setData({ applicationCount: 0 });
          this.onShowToast('#t-toast', '已清空本地草稿');
        },
      });
      return;
    }

    this.onShowToast('#t-toast', name);
  },
});
