import useToastBehavior from '~/behaviors/useToast';

const APPLICATIONS_KEY = 'visa_applications';
const FEEDBACK_KEY = 'user_feedback';
const CONTACT_QQ_GROUP = '待补充';
const CONTACT_EMAIL = '待补充';

Page({
  behaviors: [useToastBehavior],

  data: {
    applicationCount: 0,
    showFeedback: false,
    showFeedbackSuccess: false,
    showContact: false,
    feedbackTypes: ['问题反馈', '建议', '其他'],
    feedbackTypeIndex: 0,
    feedbackDescription: '',
    contactInfo: {
      qqGroup: CONTACT_QQ_GROUP,
      email: CONTACT_EMAIL,
    },
    settingList: [
      { name: '表格记录', icon: 'file', type: 'applications', url: '/pages/applications/index' },
      { name: '继续填写', icon: 'edit', type: 'fill', url: '/pages/visa-form/index?templateId=it-schengen-tourism-shanghai-demo' },
      { name: '问题反馈', icon: 'chat', type: 'feedback', note: '提交问题、建议或其他反馈' },
      { name: '联系我们', icon: 'mail', type: 'contact', note: '查看 QQ 群和邮箱' },
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

    if (type === 'feedback') {
      this.setData({
        showFeedback: !this.data.showFeedback,
        showContact: false,
      });
      return;
    }

    if (type === 'contact') {
      this.setData({
        showContact: !this.data.showContact,
        showFeedback: false,
      });
      return;
    }

    this.onShowToast('#t-toast', name);
  },

  onFeedbackTypeChange(e) {
    this.setData({ feedbackTypeIndex: Number(e.detail.value) || 0 });
  },

  onFeedbackInput(e) {
    this.setData({ feedbackDescription: e.detail.value });
  },

  submitFeedback() {
    const description = this.data.feedbackDescription.trim();
    if (!description) {
      this.onShowToast('#t-toast', '请填写详细描述');
      return;
    }
    const feedback = {
      id: `feedback_${Date.now()}`,
      type: this.data.feedbackTypes[this.data.feedbackTypeIndex],
      description,
      createdAt: new Date().toISOString(),
    };
    const list = wx.getStorageSync(FEEDBACK_KEY) || [];
    wx.setStorageSync(FEEDBACK_KEY, [feedback, ...list]);
    this.setData({
      feedbackTypeIndex: 0,
      feedbackDescription: '',
      showFeedback: false,
      showFeedbackSuccess: true,
    });
  },

  cancelFeedback() {
    this.setData({
      feedbackTypeIndex: 0,
      feedbackDescription: '',
      showFeedback: false,
    });
  },

  closeFeedbackSuccess() {
    this.setData({ showFeedbackSuccess: false });
  },

  noop() {},

  copyContact(e) {
    const { value } = e.currentTarget.dataset;
    if (!value || value === '待补充') {
      this.onShowToast('#t-toast', '联系方式待补充');
      return;
    }
    wx.setClipboardData({
      data: value,
      success: () => this.onShowToast('#t-toast', '已复制'),
    });
  },
});
