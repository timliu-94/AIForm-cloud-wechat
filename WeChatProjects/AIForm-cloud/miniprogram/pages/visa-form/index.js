const { buildForm, COUNTRY_NAME } = require('../../utils/italyForm');
const { buildDefaultApplicationTitle, normalizeTitle } = require('../../utils/applicationTitle');
const { resolvePreviewImages } = require('../../utils/cloudAssets');

const APPLICATIONS_KEY = 'visa_applications';
const PREVIEW_PANE_RPX = 760; // 顶部 PDF 预览区高度

// 日期统一以「日-月-年」(DD-MM-YYYY) 作为存储与展示格式，
// 但微信 date 选择器只认 YYYY-MM-DD，需在两种格式间转换。
function toDisplayDate(pickerValue) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pickerValue || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : pickerValue || '';
}

function toPickerDate(displayValue) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(displayValue || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : displayValue || '';
}

Page({
  data: {
    title: '',
    country: '',
    pages: [],
    pageTabs: [],
    activePage: 1,
    activeLeaves: [],
    activeFormLeaves: [],
    previewImage: '',
    previewFields: [],
    values: {},
    datePickerValues: {},
    phoneInputValues: {},
    filledCount: 0,
    totalCount: 0,
    activeFieldName: '',
    activeFieldLabel: '',
    previewScrollTop: 0,
    formScrollIntoView: '',
    applicationId: '',
    draftTitle: '',
    splitHeight: 0,
    hasNextPage: false,
  },

  onLoad(options) {
    const form = buildForm();
    const values = {};
    form.fields.forEach((field) => {
      values[field.name] = field.kind === 'checkbox' ? false : '';
    });

    let draftTitle = buildDefaultApplicationTitle(COUNTRY_NAME);
    const applicationId = options.applicationId || '';
    if (applicationId) {
      const record = this.getApplications().find((item) => item.id === applicationId);
      if (record) {
        draftTitle = record.title || draftTitle;
        Object.assign(values, record.values || {});
      }
    }

    // 预览区几何换算需要的像素尺寸（用窗口宽度，按 A4 比例算出整页图高度）。
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpxToPx = info.windowWidth / 750;
    this.canvasWidthPx = info.windowWidth;
    this.imageHeightPx = this.canvasWidthPx * (form.pages[0].height / form.pages[0].width);
    this.paneHeightPx = PREVIEW_PANE_RPX * rpxToPx;

    this.form = form;
    // 全量字段索引（含手写字段），仅用于预览红框定位/联动；进度统计、初值
    // 仍走 form.fields（只含线上录入字段），互不影响。
    this.allFields = [];
    form.pages.forEach((page) => page.leaves.forEach((leaf) => {
      if (leaf.skipFill) return;
      leaf.fields.forEach((field) => this.allFields.push(field));
    }));
    resolvePreviewImages(form.pages)
      .then((pages) => {
        const firstPage = pages[0];
        this.setData({
          title: form.title,
          country: form.country,
          pages,
          pageTabs: form.pageTabs,
          activePage: firstPage.page,
          activeLeaves: firstPage.leaves,
          activeFormLeaves: this.filterFormLeaves(firstPage.leaves),
          previewImage: firstPage.previewImage,
          previewFields: this.buildPreviewFields(firstPage.leaves, values, ''),
          values,
          datePickerValues: this.buildDatePickerValues(values),
          phoneInputValues: this.buildPhoneInputValues(values),
          totalCount: form.fields.length,
          applicationId,
          draftTitle,
          hasNextPage: pages.length > 1,
        });
        this.refreshProgress(values);
      })
      .catch(() => {
        wx.showToast({ title: '预览图加载失败', icon: 'none' });
      });
  },

  onPreviewImageError() {
    console.error('PDF preview image load failed:', this.data.previewImage);
    wx.showToast({ title: '预览图加载失败', icon: 'none' });
  },

  onPreviewImageLoad() {
    console.log('PDF preview image loaded:', this.data.previewImage);
  },

  filterFormLeaves(leaves) {
    return leaves.filter((leaf) => !leaf.skipFill);
  },

  buildPreviewFields(leaves, values, activeName) {
    const out = [];
    leaves.forEach((leaf) => {
      if (leaf.skipFill) return;
      leaf.fields.forEach((field) => {
        const isCheckbox = field.kind === 'checkbox';
        // 需要手写字段：用户不在线录入，但保留红框并参与预览联动。
        if (!leaf.needInput) {
          out.push({
            name: field.name,
            leafId: field.leafId,
            label: field.label,
            isCheckbox: false,
            manual: true,
            skipFill: leaf.skipFill,
            isHandwriting: leaf.isHandwriting,
            active: field.name === activeName,
            display: leaf.manualText,
            filled: false,
            style: field.previewStyle,
          });
          return;
        }
        const raw = values[field.name];
        let display = raw || '';
        if (isCheckbox) display = raw === true ? '✓' : '';
        out.push({
          name: field.name,
          leafId: field.leafId,
          label: field.label,
          isCheckbox,
          manual: false,
          active: field.name === activeName,
          display,
          filled: isCheckbox ? raw === true : !!(raw && String(raw).length),
          style: field.previewStyle,
        });
      });
    });
    return out;
  },

  switchPage(e) {
    const page = Number(e.currentTarget.dataset.page);
    if (page === this.data.activePage) return;
    this.goToPage(page);
  },

  // 跳到下一页（表单底部「下一页」按钮）。
  goNextPage() {
    const idx = this.data.pages.findIndex((p) => p.page === this.data.activePage);
    const next = this.data.pages[idx + 1];
    if (next) this.goToPage(next.page);
  },

  // 切换到指定页，并把底部表单滚动到该页第一个需要填写的文字块顶端。
  goToPage(page) {
    const target = this.data.pages.find((p) => p.page === page);
    if (!target) return;
    // 优先定位到首个需线上录入的叶子节点；若整页只有手写块，则退回到首个手写块，
    // 使其红框照常高亮联动。
    const firstLeaf = target.leaves.find((leaf) => leaf.needInput && leaf.fields && leaf.fields.length)
      || target.leaves.find((leaf) => leaf.isHandwriting && leaf.fields && leaf.fields.length)
      || target.leaves.find((leaf) => !leaf.skipFill && leaf.fields && leaf.fields.length);
    const firstField = firstLeaf ? firstLeaf.fields[0] : null;
    this.setData({
      activePage: page,
      activeLeaves: target.leaves,
      activeFormLeaves: this.filterFormLeaves(target.leaves),
      previewImage: target.previewImage,
      previewFields: this.buildPreviewFields(target.leaves, this.data.values, firstField ? firstField.name : ''),
      activeFieldName: firstField ? firstField.name : '',
      activeFieldLabel: firstField ? firstField.label : '',
      previewScrollTop: 0,
      formScrollIntoView: '',
      hasNextPage: this.hasNextPage(page),
    });
    // 待新页叶子节点渲染后再设置 scroll-into-view，确保触发滚动到首个填写块顶端。
    if (firstLeaf) {
      wx.nextTick(() => this.setData({ formScrollIntoView: firstLeaf.leafId }));
    }
    this.queryLeafOffsets();
  },

  hasNextPage(page) {
    const idx = this.data.pages.findIndex((p) => p.page === page);
    return idx >= 0 && idx < this.data.pages.length - 1;
  },

  // —— 表单录入 ——
  onFieldFocus(e) {
    this.setActiveField(e.currentTarget.dataset.name, true);
  },

  onTextInput(e) {
    this.setFieldValue(e.currentTarget.dataset.name, e.detail.value);
  },

  onDateChange(e) {
    const { name } = e.currentTarget.dataset;
    this.setData({ [`datePickerValues.${name}`]: e.detail.value });
    this.setFieldValue(name, toDisplayDate(e.detail.value));
  },

  // 为日期字段构建选择器所需的 YYYY-MM-DD 值（存储值是 DD-MM-YYYY）。
  buildDatePickerValues(values) {
    const map = {};
    this.form.fields.forEach((field) => {
      if (field.component === 'date') map[field.name] = toPickerDate(values[field.name]);
    });
    return map;
  },

  // 电话/手机字段：存储值含前导 +（+(区号)(号码)），输入框只展示去掉 + 的部分。
  buildPhoneInputValues(values) {
    const map = {};
    this.form.fields.forEach((field) => {
      if (field.component === 'phone') map[field.name] = String(values[field.name] || '').replace(/^\++/, '');
    });
    return map;
  },

  // 电话/手机输入：+ 号自动带上，仅把用户填的区号与号码拼到 + 之后存储。
  onPhoneInput(e) {
    const { name } = e.currentTarget.dataset;
    const raw = (e.detail.value || '').replace(/^\++/, '');
    this.setData({ [`phoneInputValues.${name}`]: raw });
    this.setFieldValue(name, raw ? `+${raw}` : '');
  },

  onCheckboxTap(e) {
    const { name } = e.currentTarget.dataset;
    this.setFieldValue(name, !this.data.values[name]);
    this.setActiveField(name, true);
  },

  backToHome() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/index' });
  },

  setFieldValue(name, value) {
    const values = { ...this.data.values, [name]: value };
    this.setData({
      [`values.${name}`]: value,
      previewFields: this.buildPreviewFields(this.data.activeLeaves, values, name),
    });
    this.refreshProgress(values);
  },

  refreshProgress(values) {
    let filled = 0;
    this.form.fields.forEach((field) => {
      const v = values[field.name];
      if (field.kind === 'checkbox' ? v === true : !!(v && String(v).length)) filled += 1;
    });
    this.setData({ filledCount: filled });
  },

  // —— 联动 ——
  // 点击顶部预览框 → 滚动到对应表单文字块。
  tapPreviewBox(e) {
    const { name, leaf } = e.currentTarget.dataset;
    this.setActiveField(name, false);
    this.setData({ formScrollIntoView: leaf });
  },

  // 表单滚动 → 高亮所在文字块，并把预览滚到对应位置（节流）。
  onFormScroll(e) {
    const now = Date.now();
    if (this._scrollGate && now - this._scrollGate < 120) return;
    this._scrollGate = now;
    const offsets = this._leafOffsets;
    if (!offsets || !offsets.length) return;
    const top = e.detail.scrollTop + 40;
    let current = offsets[0];
    for (let i = 0; i < offsets.length; i += 1) {
      if (offsets[i].top <= top) current = offsets[i];
      else break;
    }
    const leaf = this.data.activeLeaves.find((l) => l.leafId === current.leafId);
    const field = leaf && leaf.fields[0];
    if (field && field.name !== this.data.activeFieldName) {
      this.setActiveField(field.name, false);
    }
  },

  // 高亮某字段：更新红框 + 把顶部预览滚动到该字段处。
  setActiveField(name, fromForm) {
    const field = this.findField(name);
    if (!field) return;
    const center = (field.pCenterY / 100) * this.imageHeightPx;
    const maxTop = Math.max(0, this.imageHeightPx - this.paneHeightPx);
    const scrollTop = Math.min(maxTop, Math.max(0, center - this.paneHeightPx / 2));
    const patch = {
      activeFieldName: name,
      activeFieldLabel: field.label,
      previewScrollTop: scrollTop,
      previewFields: this.buildPreviewFields(this.data.activeLeaves, this.data.values, name),
    };
    if (this.data.activePage !== field.page) {
      const target = this.data.pages.find((p) => p.page === field.page);
      patch.activePage = field.page;
      patch.activeLeaves = target.leaves;
      patch.activeFormLeaves = this.filterFormLeaves(target.leaves);
      patch.previewImage = target.previewImage;
    }
    this.setData(patch);
  },

  findField(name) {
    // 用全量索引：现场手写字段不在 form.fields 中，但其红框仍需参与预览定位/联动。
    return this.allFields.find((f) => f.name === name);
  },

  queryLeafOffsets() {
    wx.nextTick(() => {
      const q = wx.createSelectorQuery().in(this);
      q.select('.form-list').boundingClientRect();
      q.select('.form-list').scrollOffset();
      q.selectAll('.leaf-card').boundingClientRect();
      q.exec((res) => {
        const listRect = res[0];
        const scroll = res[1];
        const cards = res[2] || [];
        if (!listRect || !scroll) return;
        this._leafOffsets = cards.map((rect) => ({
          leafId: rect.id,
          top: rect.top - listRect.top + scroll.scrollTop,
        }));
      });
    });
  },

  // —— 保存 / 预览 ——
  saveDraft() {
    this.confirmTitle((title) => {
      this.persistDraft(title);
      wx.showToast({ title: '草稿已保存', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/applications/index' });
      }, 500);
    });
  },

  goPreview() {
    // 预览不再要求填写标题，沿用当前草稿标题（或默认），由导出环节再让用户填写。
    const title = normalizeTitle(this.data.draftTitle) || buildDefaultApplicationTitle(COUNTRY_NAME);
    const id = this.persistDraft(title);
    wx.navigateTo({ url: `/pages/preview/index?applicationId=${id}` });
  },

  confirmTitle(onConfirm) {
    const fallback = buildDefaultApplicationTitle(COUNTRY_NAME);
    wx.showModal({
      title: '保存申请',
      editable: true,
      placeholderText: '请输入申请标题',
      content: normalizeTitle(this.data.draftTitle) || fallback,
      success: (res) => {
        if (!res.confirm) return;
        const title = normalizeTitle(res.content);
        if (!title) {
          wx.showToast({ title: '标题不能为空', icon: 'none' });
          return;
        }
        onConfirm(title);
      },
    });
  },

  persistDraft(title) {
    const id = this.data.applicationId || `app_${Date.now()}`;
    const applications = this.getApplications();
    const index = applications.findIndex((item) => item.id === id);
    const now = new Date().toISOString();
    const record = {
      id,
      templateId: this.form.templateId,
      title,
      country: this.form.country,
      visaType: '申根短期签证',
      status: 'draft',
      values: { ...this.data.values },
      updatedAt: now,
      createdAt: index >= 0 ? applications[index].createdAt : now,
    };
    if (index >= 0) applications[index] = record;
    else applications.unshift(record);
    wx.setStorageSync(APPLICATIONS_KEY, applications);
    this.setData({ applicationId: id, draftTitle: title });
    return id;
  },

  getApplications() {
    return wx.getStorageSync(APPLICATIONS_KEY) || [];
  },

  onReady() {
    // .split 紧跟在自定义导航之后，用它的顶部位置反推剩余视口高度，让分屏铺满。
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    wx.createSelectorQuery()
      .in(this)
      .select('.split')
      .boundingClientRect((rect) => {
        const top = rect ? rect.top : 0;
        this.setData({ splitHeight: info.windowHeight - top }, () => {
          this.queryLeafOffsets();
        });
      })
      .exec();
  },
});
