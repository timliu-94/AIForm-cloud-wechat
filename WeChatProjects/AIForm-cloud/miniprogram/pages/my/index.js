const { privacyPolicy } = require('../../config/firstLaunchNotice');

const APPLICATIONS_KEY = 'visa_applications';
const OPEN_CUSTOMER_SERVICE_KEY = 'open_customer_service_from_home';
const TAB_BAR_PAGES = [
  '/pages/home/index',
  '/pages/applications/index',
  '/pages/my/index',
];

Page({
  data: {
    applicationCount: 0,
    showCustomerService: false,
    showPrivacy: false,
    sessionFrom: JSON.stringify({ source: 'my-customer-service' }),
    privacyPolicy,
  },

  onShow() {
    const shouldOpenCustomerService = wx.getStorageSync(OPEN_CUSTOMER_SERVICE_KEY);
    if (shouldOpenCustomerService) {
      wx.removeStorageSync(OPEN_CUSTOMER_SERVICE_KEY);
    }
    this.setData({
      applicationCount: (wx.getStorageSync(APPLICATIONS_KEY) || []).length,
      showCustomerService: Boolean(shouldOpenCustomerService) || this.data.showCustomerService,
      showPrivacy: shouldOpenCustomerService ? false : this.data.showPrivacy,
    });
    if (shouldOpenCustomerService) {
      wx.nextTick(() => {
        wx.pageScrollTo({
          selector: '.customer-service-panel',
          duration: 250,
        });
      });
    }
  },

  onEleClick(e) {
    const { type } = e.currentTarget.dataset;

    if (type === 'customerService') {
      this.setData({
        showCustomerService: !this.data.showCustomerService,
        showPrivacy: false,
      });
      return;
    }

    if (type === 'privacy') {
      this.setData({
        showPrivacy: !this.data.showPrivacy,
        showCustomerService: false,
      });
    }
  },

  handleContact(e) {
    const { path, query } = e.detail || {};
    if (!path) {
      return;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const queryString = typeof query === 'string'
      ? query.replace(/^\?/, '')
      : Object.keys(query || {})
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
        .join('&');
    const url = queryString ? `${normalizedPath}?${queryString}` : normalizedPath;

    if (TAB_BAR_PAGES.includes(normalizedPath)) {
      wx.switchTab({ url: normalizedPath });
      return;
    }

    wx.navigateTo({ url });
  },
});
