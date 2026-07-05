import useToastBehavior from '~/behaviors/useToast';

const APPLICATIONS_KEY = 'visa_applications';
const FEEDBACK_KEY = 'user_feedback';
const OPEN_FEEDBACK_KEY = 'open_feedback_from_home_empty_country';
const CONTACT_QQ_GROUP = '84173943';
const CONTACT_EMAIL = '84173942@qq.com';

Page({
  behaviors: [useToastBehavior],

  data: {
    applicationCount: 0,
    showFeedback: false,
    showFeedbackSuccess: false,
    showContact: false,
    showPrivacy: false,
    feedbackTypes: ['问题反馈', '建议', '其他'],
    feedbackTypeIndex: 0,
    feedbackDescription: '',
    contactInfo: {
      qqGroup: CONTACT_QQ_GROUP,
      email: CONTACT_EMAIL,
    },
    settingList: [
      { name: '隐私政策', icon: 'lock-on', type: 'privacy', note: '查看小程序隐私政策' },
      { name: '意见与建议', icon: 'chat', type: 'feedback', note: '提交问题、建议或其他反馈' },
      { name: '联系我们', icon: 'mail', type: 'contact', note: '查看 QQ 群和邮箱' },
    ],
  },

  onShow() {
    const shouldOpenFeedback = wx.getStorageSync(OPEN_FEEDBACK_KEY);
    if (shouldOpenFeedback) {
      wx.removeStorageSync(OPEN_FEEDBACK_KEY);
    }
    this.setData({
      applicationCount: (wx.getStorageSync(APPLICATIONS_KEY) || []).length,
      showFeedback: Boolean(shouldOpenFeedback) || this.data.showFeedback,
      showContact: shouldOpenFeedback ? false : this.data.showContact,
      showPrivacy: shouldOpenFeedback ? false : this.data.showPrivacy,
      feedbackTypeIndex: shouldOpenFeedback ? 0 : this.data.feedbackTypeIndex,
    });
    if (shouldOpenFeedback) {
      wx.nextTick(() => {
        wx.pageScrollTo({
          selector: '.feedback-panel',
          duration: 250,
        });
      });
    }
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
        showPrivacy: false,
      });
      return;
    }

    if (type === 'contact') {
      this.setData({
        showContact: !this.data.showContact,
        showFeedback: false,
        showPrivacy: false,
      });
      return;
    }

    if (type === 'privacy') {
      this.setData({
        showPrivacy: !this.data.showPrivacy,
        showFeedback: false,
        showContact: false,
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
      showPrivacy: false,
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
