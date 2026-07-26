const { firstLaunchNotice } = require('../../config/firstLaunchNotice');

Component({
  options: {
    styleIsolation: 'shared',
  },
  properties: {
    // 是否自动根据本地存储判断首启（默认 true）。父页面也可通过 visible 直接控制。
    auto: {
      type: Boolean,
      value: true,
    },
  },
  data: {
    firstLaunchNotice,
    visible: false,
  },
  lifetimes: {
    attached() {
      // auto 模式（如首页）：仅在未确认过时弹出；
      // 受控模式（auto=false，由父页面用 wx:if 控制挂载）：挂载即显示。
      const visible = this.data.auto
        ? !wx.getStorageSync(firstLaunchNotice.storageKey)
        : true;
      this.setData({ visible });
    },
  },
  methods: {
    noop() {},
    acknowledge() {
      wx.setStorageSync(firstLaunchNotice.storageKey, true);
      this.setData({ visible: false });
      this.triggerEvent('acknowledge');
    },
  },
});
