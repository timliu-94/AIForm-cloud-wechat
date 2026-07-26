const { loadForm, COUNTRY_NAME } = require('../../utils/italyForm');
const { buildDefaultApplicationTitle, normalizeTitle } = require('../../utils/applicationTitle');
const { resolvePreviewImages } = require('../../utils/cloudAssets');
const { fetchInvite } = require('../../utils/invite');
const { firstLaunchNotice } = require('../../config/firstLaunchNotice');

const APPLICATIONS_KEY = 'visa_applications';
const PREVIEW_PANE_RPX = 760; // 顶部预览区高度
const PREVIEW_MIN_SCALE = 1;
const DATE_START_YEAR = 1900;
const DATE_END_YEAR = 2100;

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function buildRange(start, end, pad) {
  const out = [];
  for (let i = start; i <= end; i += 1) out.push(pad ? padDatePart(i) : String(i));
  return out;
}

const MONTH_OPTIONS = buildRange(1, 12, true);
const YEAR_OPTIONS = buildRange(DATE_START_YEAR, DATE_END_YEAR, false);

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function buildDayOptions(year, month) {
  return buildRange(1, daysInMonth(year, month), true);
}

// 日期统一以「日-月-年」(DD-MM-YYYY) 作为存储与展示格式。
function normalizeDisplayDate(value) {
  const raw = value || '';
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  return m ? raw : '';
}

function datePartsFromDisplay(value) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(normalizeDisplayDate(value));
  if (m) return { day: m[1], month: m[2], year: m[3] };
  const now = new Date();
  return {
    day: padDatePart(now.getDate()),
    month: padDatePart(now.getMonth() + 1),
    year: String(now.getFullYear()),
  };
}

function buildDateColumns(year, month) {
  return [buildDayOptions(year, month), MONTH_OPTIONS, YEAR_OPTIONS];
}

function buildDateDisplayColumns(ranges) {
  return [
    (ranges[0] || []).map((day) => `${day}日`),
    (ranges[1] || []).map((month) => `${month}月`),
    (ranges[2] || []).map((year) => `${year}年`),
  ];
}

function datePickerStateFromDisplay(value) {
  const parts = datePartsFromDisplay(value);
  if (YEAR_OPTIONS.indexOf(parts.year) < 0) parts.year = String(new Date().getFullYear());
  const ranges = buildDateColumns(parts.year, parts.month);
  const dayIndex = Math.max(0, ranges[0].indexOf(parts.day));
  const monthIndex = Math.max(0, MONTH_OPTIONS.indexOf(parts.month));
  const yearIndex = Math.max(0, YEAR_OPTIONS.indexOf(parts.year));
  return {
    ranges,
    value: [dayIndex, monthIndex, yearIndex],
  };
}

function displayDateFromPickerState(ranges, value) {
  if (!ranges || !value) return '';
  const day = ranges[0][value[0]];
  const month = ranges[1][value[1]];
  const year = ranges[2][value[2]];
  return day && month && year ? `${day}-${month}-${year}` : '';
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
    datePickerRanges: {},
    datePickerDisplayRanges: {},
    phoneInputValues: {},
    filledCount: 0,
    totalCount: 0,
    activeFieldName: '',
    activeFieldLabel: '',
    previewCanvasWidth: 0,
    previewCanvasHeight: 0,
    previewScale: PREVIEW_MIN_SCALE,
    previewX: 0,
    previewY: 0,
    formScrollIntoView: '',
    applicationId: '',
    draftTitle: '',
    splitHeight: 0,
    hasNextPage: false,
    showFirstLaunchNotice: false,
  },

  onLoad(options) {
    this._pageActive = true;
    // 被邀请人经分享链接直达填写页：首次访问需先完成隐私条款确认。
    if (options.inviteId && !wx.getStorageSync(firstLaunchNotice.storageKey)) {
      this.setData({ showFirstLaunchNotice: true });
    }
    wx.showLoading({ title: '表单加载中', mask: true });
    this.resolveLoadContext(options)
      .then(({ templateId, templateVersion }) => (
        this._pageActive ? loadForm(templateId, templateVersion) : null
      ))
      .then((form) => (this._pageActive && form ? this.initializeForm(options, form) : null))
      .catch((err) => {
        if (!this._pageActive) return;
        console.error('Load form resources failed:', err);
        wx.showModal({
          title: '表单资源加载失败',
          content: err.message || String(err),
          showCancel: false,
        });
      })
      .then(
        () => wx.hideLoading(),
        () => wx.hideLoading(),
      );
  },

  // 解析本次加载所需的模板与预填值：邀请链接从云端邀请单取，否则走本地记录。
  resolveLoadContext(options) {
    if (options.inviteId) {
      return fetchInvite(options.inviteId).then((invite) => {
        this._inviteValues = (invite && invite.values) || {};
        return {
          templateId: invite.templateId,
          templateVersion: invite.templateVersion || null,
        };
      });
    }
    this._inviteValues = null;
    const record = options.applicationId
      ? this.getApplications().find((item) => item.id === options.applicationId)
      : null;
    return Promise.resolve({
      templateId: options.templateId || (record && record.templateId) || undefined,
      templateVersion: record && record.templateVersion,
    });
  },

  onFirstLaunchAcknowledge() {
    this.setData({ showFirstLaunchNotice: false });
  },

  onUnload() {
    this._pageActive = false;
  },

  initializeForm(options, form) {
    const values = {};
    form.fields.forEach((field) => {
      values[field.name] = field.kind === 'checkbox' ? false : '';
    });

    let draftTitle = buildDefaultApplicationTitle(COUNTRY_NAME);
    const applicationId = options.applicationId || '';
    if (this._inviteValues) {
      // 邀请填写：用邀请人分享的字段值预填，被邀请人保存时生成自己的本地副本。
      Object.assign(values, this._inviteValues);
    } else if (applicationId) {
      const record = this.getApplications().find((item) => item.id === applicationId);
      if (record) {
        draftTitle = record.title || draftTitle;
        Object.assign(values, record.values || {});
      }
    }
    this.normalizeDateValues(form, values);

    // 预览区几何换算需要的像素尺寸（用窗口宽度，按 A4 比例算出整页图高度）。
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpxToPx = info.windowWidth / 750;
    this.canvasWidthPx = info.windowWidth;
    this.imageHeightPx = this.canvasWidthPx * (form.pages[0].height / form.pages[0].width);
    this.paneHeightPx = PREVIEW_PANE_RPX * rpxToPx;
    this._previewScale = PREVIEW_MIN_SCALE;

    this.form = form;
    // 全量字段索引（含手写字段），仅用于预览红框定位/联动；进度统计、初值
    // 仍走 form.fields（只含线上录入字段），互不影响。
    this.allFields = [];
    form.pages.forEach((page) => page.leaves.forEach((leaf) => {
      if (leaf.skipFill) return;
      leaf.fields.forEach((field) => this.allFields.push(field));
    }));
    return resolvePreviewImages(form.pages)
      .then((pages) => {
        if (!this._pageActive) return;
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
          previewCanvasWidth: this.canvasWidthPx,
          previewCanvasHeight: this.imageHeightPx,
          values,
          ...this.buildDatePickerData(values),
          phoneInputValues: this.buildPhoneInputValues(values),
          totalCount: form.fields.length,
          applicationId,
          draftTitle,
          hasNextPage: pages.length > 1,
        });
        this.refreshProgress(values);
      });
  },

  onPreviewImageError() {
    console.error('Preview image load failed:', this.data.previewImage);
    wx.showToast({ title: '预览图加载失败', icon: 'none' });
  },

  onPreviewImageLoad() {
    console.log('Preview image loaded:', this.data.previewImage);
  },

  onPreviewMove(e) {
    const { x = 0, y = 0 } = e.detail || {};
    this.setData({ previewX: x, previewY: y });
  },

  onPreviewScale(e) {
    const scale = e.detail && e.detail.scale ? e.detail.scale : PREVIEW_MIN_SCALE;
    this._previewScale = scale;
    if (Math.abs(scale - this.data.previewScale) > 0.01) {
      this.setData({ previewScale: scale });
    }
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
      previewScale: PREVIEW_MIN_SCALE,
      previewX: 0,
      previewY: 0,
      formScrollIntoView: '',
      hasNextPage: this.hasNextPage(page),
    });
    this._previewScale = PREVIEW_MIN_SCALE;
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
    const value = e.detail.value;
    const ranges = this.data.datePickerRanges[name];
    const displayDate = displayDateFromPickerState(ranges, value);
    if (!displayDate) return;
    this.setData({ [`datePickerValues.${name}`]: value });
    this.setFieldValue(name, displayDate);
  },

  onDateColumnChange(e) {
    const { name } = e.currentTarget.dataset;
    const { column, value } = e.detail;
    const currentValue = (this.data.datePickerValues[name] || [0, 0, 0]).slice();
    currentValue[column] = value;

    const currentRanges = this.data.datePickerRanges[name] || buildDateColumns(String(new Date().getFullYear()), '01');
    const month = currentRanges[1][currentValue[1]];
    const year = currentRanges[2][currentValue[2]];
    const nextRanges = buildDateColumns(year, month);
    if (currentValue[0] >= nextRanges[0].length) currentValue[0] = nextRanges[0].length - 1;

    this.setData({
      [`datePickerValues.${name}`]: currentValue,
      [`datePickerRanges.${name}`]: nextRanges,
      [`datePickerDisplayRanges.${name}`]: buildDateDisplayColumns(nextRanges),
    });
  },

  normalizeDateValues(form, values) {
    form.fields.forEach((field) => {
      if (field.component === 'date') values[field.name] = normalizeDisplayDate(values[field.name]);
    });
  },

  buildDatePickerData(values) {
    const datePickerValues = {};
    const datePickerRanges = {};
    const datePickerDisplayRanges = {};
    this.form.fields.forEach((field) => {
      if (field.component === 'date') {
        const state = datePickerStateFromDisplay(values[field.name]);
        datePickerValues[field.name] = state.value;
        datePickerRanges[field.name] = state.ranges;
        datePickerDisplayRanges[field.name] = buildDateDisplayColumns(state.ranges);
      }
    });
    return { datePickerValues, datePickerRanges, datePickerDisplayRanges };
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

  // 表单滚动 → 高亮所在文字块，并把预览移动到对应位置（节流）。
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

  // 高亮某字段：更新红框 + 把顶部预览移动到该字段处。
  setActiveField(name, fromForm) {
    const field = this.findField(name);
    if (!field) return;
    const center = (field.pCenterY / 100) * this.imageHeightPx;
    const scale = this._previewScale || this.data.previewScale || PREVIEW_MIN_SCALE;
    const minY = Math.min(0, this.paneHeightPx - this.imageHeightPx * scale);
    const previewY = Math.min(0, Math.max(minY, this.paneHeightPx / 2 - center * scale));
    const patch = {
      activeFieldName: name,
      activeFieldLabel: field.label,
      previewY,
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
      title: '保存表格',
      editable: true,
      placeholderText: '请输入表格标题',
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
      templateVersion: this.form.templateVersion,
      title,
      country: this.form.country,
      visaType: '申根短期申请表',
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
