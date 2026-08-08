const { buildPagePreviewFields, loadForm, COUNTRY_NAME } = require('../../utils/italyForm');
const { buildDefaultApplicationTitle, normalizeTitle } = require('../../utils/applicationTitle');
const { resolvePreviewImages } = require('../../utils/cloudAssets');
const { fetchInvite } = require('../../utils/invite');
const { firstLaunchNotice } = require('../../config/firstLaunchNotice');

const APPLICATIONS_KEY = 'visa_applications';
const PREVIEW_PANE_RPX = 760; // 顶部预览区高度
const PREVIEW_MIN_SCALE = 1;
const PREVIEW_PADDING_RPX = 24;
const PREVIEW_DOUBLE_TAP_SCALE = 2;
const PREVIEW_DOUBLE_TAP_MS = 320;
const PREVIEW_DOUBLE_TAP_DISTANCE_RPX = 64;
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

// 新数据以隐藏唯一 ID 存储；旧草稿仍可能以 PDF 原始 name 存储。
// 重名字段首次读取旧草稿时会共用旧值，之后保存即转为各自的唯一 ID。
function applyStoredValues(fields, target, stored) {
  const source = stored || {};
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field.id)) {
      target[field.id] = source[field.id];
    } else if (Object.prototype.hasOwnProperty.call(source, field.name)) {
      target[field.id] = source[field.name];
    }
  });
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
    formReady: false,
  },

  onLoad(options = {}) {
    this._pageActive = true;
    this._loadOptions = options;
    // 被邀请人经分享链接直达填写页：首次访问需先完成隐私条款确认。
    if (options.inviteId && !wx.getStorageSync(firstLaunchNotice.storageKey)) {
      this.setData({ showFirstLaunchNotice: true });
      return;
    }
    this.startFormLoad(options);
  },

  startFormLoad(options) {
    if (this._formLoadStarted || !this._pageActive) return;
    this._formLoadStarted = true;
    wx.showLoading({ title: '表单加载中', mask: true });
    this.resolveLoadContext(options)
      .then(({ templateId, templateVersion }) => (
        this._pageActive ? loadForm(templateId, templateVersion) : null
      ))
      .then((form) => (this._pageActive && form ? this.initializeForm(options, form) : null))
      .then(() => {
        if (this._pageActive && this.form) this.setData({ formReady: true });
      })
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
    this.setData({ showFirstLaunchNotice: false }, () => {
      this.startFormLoad(this._loadOptions || {});
    });
  },

  onUnload() {
    this._pageActive = false;
    this._loadOptions = null;
    if (this._previewScaleTimer) clearTimeout(this._previewScaleTimer);
  },

  initializeForm(options, form) {
    const values = {};
    form.fields.forEach((field) => {
      values[field.id] = field.kind === 'checkbox' ? false : '';
    });

    let draftTitle = buildDefaultApplicationTitle(form.country || COUNTRY_NAME);
    const applicationId = options.applicationId || '';
    if (this._inviteValues) {
      // 邀请填写：用邀请人分享的字段值预填，被邀请人保存时生成自己的本地副本。
      applyStoredValues(form.fields, values, this._inviteValues);
    } else if (applicationId) {
      const record = this.getApplications().find((item) => item.id === applicationId);
      if (record) {
        draftTitle = record.title || draftTitle;
        applyStoredValues(form.fields, values, record.values);
      }
    }
    this.normalizeDateValues(form, values);

    // 预览区默认按 contain 方式展示整页，放大后再由用户拖拽查看细节。
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpxToPx = info.windowWidth / 750;
    this.previewAreaWidthPx = info.windowWidth;
    this.paneHeightPx = PREVIEW_PANE_RPX * rpxToPx;
    this.previewPaddingPx = PREVIEW_PADDING_RPX * rpxToPx;
    this.previewDoubleTapDistancePx = PREVIEW_DOUBLE_TAP_DISTANCE_RPX * rpxToPx;
    this._previewScale = PREVIEW_MIN_SCALE;

    this.form = form;
    // 全量字段索引（含手写字段），仅用于预览位置定位/联动；进度统计、初值
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
        const geometry = this.getPreviewGeometry(firstPage);
        this.setData({
          title: form.title,
          country: form.country,
          pages,
          pageTabs: form.pageTabs,
          activePage: firstPage.page,
          activeLeaves: firstPage.leaves,
          activeFormLeaves: this.filterFormLeaves(firstPage.leaves),
          previewImage: firstPage.previewImage,
          previewFields: this.buildPreviewFields(
            firstPage.leaves,
            values,
            '',
            firstPage.width,
            geometry.width,
          ),
          previewCanvasWidth: geometry.width,
          previewCanvasHeight: geometry.height,
          previewX: geometry.x,
          previewY: geometry.y,
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

  getPreviewGeometry(page) {
    const pageWidth = Number(page && page.width) || 595;
    const pageHeight = Number(page && page.height) || 842;
    const availableWidth = Math.max(1, this.previewAreaWidthPx - this.previewPaddingPx * 2);
    const availableHeight = Math.max(1, this.paneHeightPx - this.previewPaddingPx * 2);
    const fitScale = Math.min(availableWidth / pageWidth, availableHeight / pageHeight);
    const width = pageWidth * fitScale;
    const height = pageHeight * fitScale;
    return {
      width,
      height,
      x: (this.previewAreaWidthPx - width) / 2,
      y: (this.paneHeightPx - height) / 2,
    };
  },

  onPreviewMove(e) {
    const { x = 0, y = 0, source = '' } = e.detail || {};
    // setData 触发的聚焦动画也会持续派发 change。此时若把动画中间值写回，
    // 会打断下一次受控位移；只记录用户拖拽/惯性产生的位置。
    if (!source) return;
    this.setData({ previewX: x, previewY: y });
  },

  onPreviewScale(e) {
    const scale = e.detail && e.detail.scale ? e.detail.scale : PREVIEW_MIN_SCALE;
    this._previewScale = scale;
    // 双指缩放期间不逐帧 setData，避免受控属性反复渲染拖慢手势；
    // 手指停止后再同步一次最终比例，供双击切换继续使用。
    if (this._previewScaleTimer) clearTimeout(this._previewScaleTimer);
    this._previewScaleTimer = setTimeout(() => {
      this._previewScaleTimer = null;
      if (!this._pageActive) return;
      if (Math.abs(scale - this.data.previewScale) > 0.01) {
        this.setData({ previewScale: scale });
      }
    }, 120);
  },

  onPreviewTap(e) {
    const touch = (e.changedTouches && e.changedTouches[0]) || {};
    const point = {
      time: Date.now(),
      x: Number(touch.clientX) || 0,
      y: Number(touch.clientY) || 0,
    };
    const previous = this._lastPreviewTap;
    this._lastPreviewTap = point;
    if (!previous || point.time - previous.time > PREVIEW_DOUBLE_TAP_MS) return;

    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (distance > this.previewDoubleTapDistancePx) return;

    this._lastPreviewTap = null;
    if (this._previewScaleTimer) {
      clearTimeout(this._previewScaleTimer);
      this._previewScaleTimer = null;
    }
    const isZoomed = (this._previewScale || this.data.previewScale) > PREVIEW_MIN_SCALE + 0.05;
    const scale = isZoomed ? PREVIEW_MIN_SCALE : PREVIEW_DOUBLE_TAP_SCALE;
    const width = this.data.previewCanvasWidth;
    const height = this.data.previewCanvasHeight;
    this._previewScale = scale;
    this.setData({
      previewScale: scale,
      previewX: (this.previewAreaWidthPx - width * scale) / 2,
      previewY: (this.paneHeightPx - height * scale) / 2,
    });
  },

  filterFormLeaves(leaves) {
    return leaves.filter((leaf) => !leaf.skipFill);
  },

  buildPreviewFields(leaves, values, activeName, pageWidth, renderedWidth) {
    return buildPagePreviewFields({ width: pageWidth, leaves }, values, {
      activeName,
      renderedWidth,
      unit: 'px',
    });
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
    if (this._previewScaleTimer) {
      clearTimeout(this._previewScaleTimer);
      this._previewScaleTimer = null;
    }
    const geometry = this.getPreviewGeometry(target);
    // 优先定位到首个需线上录入的叶子节点；若整页只有手写块，则退回到首个手写块，
    // 使其位置提示照常参与联动。
    const firstLeaf = target.leaves.find((leaf) => leaf.needInput && leaf.inputFields && leaf.inputFields.length)
      || target.leaves.find((leaf) => leaf.hasHandwritingFields && leaf.fields && leaf.fields.length)
      || target.leaves.find((leaf) => !leaf.skipFill && leaf.fields && leaf.fields.length);
    const firstField = firstLeaf
      ? ((firstLeaf.inputFields && firstLeaf.inputFields[0]) || firstLeaf.fields[0])
      : null;
    this.setData({
      activePage: page,
      activeLeaves: target.leaves,
      activeFormLeaves: this.filterFormLeaves(target.leaves),
      previewImage: target.previewImage,
      previewFields: this.buildPreviewFields(
        target.leaves,
        this.data.values,
        firstField ? firstField.id : '',
        target.width,
        geometry.width,
      ),
      activeFieldName: firstField ? firstField.id : '',
      activeFieldLabel: firstField ? firstField.label : '',
      previewCanvasWidth: geometry.width,
      previewCanvasHeight: geometry.height,
      previewScale: PREVIEW_MIN_SCALE,
      previewX: geometry.x,
      previewY: geometry.y,
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

  // 软键盘弹出会带动 scroll-view 滚动。记住正在编辑的字段，
  // 避免 onFormScroll 把它误重置为当前文字块的第一个字段。
  onKeyboardFieldFocus(e) {
    const { name } = e.currentTarget.dataset;
    this._focusedFieldName = name;
    this.setActiveField(name, true);
  },

  onKeyboardFieldBlur(e) {
    const { name } = e.currentTarget.dataset;
    if (this._focusedFieldName === name) this._focusedFieldName = '';
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
      if (field.component === 'date') values[field.id] = normalizeDisplayDate(values[field.id]);
    });
  },

  buildDatePickerData(values) {
    const datePickerValues = {};
    const datePickerRanges = {};
    const datePickerDisplayRanges = {};
    this.form.fields.forEach((field) => {
      if (field.component === 'date') {
        const state = datePickerStateFromDisplay(values[field.id]);
        datePickerValues[field.id] = state.value;
        datePickerRanges[field.id] = state.ranges;
        datePickerDisplayRanges[field.id] = buildDateDisplayColumns(state.ranges);
      }
    });
    return { datePickerValues, datePickerRanges, datePickerDisplayRanges };
  },

  // 电话/手机字段：存储值含前导 +（+(区号)(号码)），输入框只展示去掉 + 的部分。
  buildPhoneInputValues(values) {
    const map = {};
    this.form.fields.forEach((field) => {
      if (field.component === 'phone') map[field.id] = String(values[field.id] || '').replace(/^\++/, '');
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
    const checked = this.data.values[name] !== true;
    const previewActiveName = checked
      ? name
      : (this.data.activeFieldName === name ? '' : this.data.activeFieldName);
    this.setFieldValue(name, checked, previewActiveName);
    if (checked) {
      this.setActiveField(name, true);
    } else if (this.data.activeFieldName === name) {
      this.setData({ activeFieldName: '', activeFieldLabel: '' });
    }
  },

  backToHome() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/index' });
  },

  setFieldValue(name, value, previewActiveName = name) {
    const values = { ...this.data.values, [name]: value };
    const activePage = this.data.pages.find((page) => page.page === this.data.activePage);
    this.setData({
      [`values.${name}`]: value,
      previewFields: this.buildPreviewFields(
        this.data.activeLeaves,
        values,
        previewActiveName,
        activePage && activePage.width,
        this.data.previewCanvasWidth,
      ),
    });
    this.refreshProgress(values);
  },

  refreshProgress(values) {
    let filled = 0;
    this.form.fields.forEach((field) => {
      const v = values[field.id];
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
    // 输入框聚焦时的滚动通常由软键盘或微信容器触发，
    // 不应覆盖用户刚选中的精确字段。
    if (this._focusedFieldName) return;
    const offsets = this._leafOffsets;
    if (!offsets || !offsets.length) return;
    const top = e.detail.scrollTop + 40;
    let current = offsets[0];
    for (let i = 0; i < offsets.length; i += 1) {
      if (offsets[i].top <= top) current = offsets[i];
      else break;
    }
    const leaf = this.data.activeLeaves.find((l) => l.leafId === current.leafId);
    // 同一文字块可包含多个字段（如日本担保人的姓名、电话）。
    // 只要当前字段仍在这个块内，就保留它，不回退到 fields[0]。
    const activeFieldStillVisible = leaf && leaf.fields.some(
      (field) => field.id === this.data.activeFieldName,
    );
    if (activeFieldStillVisible) return;
    const field = leaf && ((leaf.inputFields && leaf.inputFields[0]) || leaf.fields[0]);
    if (field && field.id !== this.data.activeFieldName) {
      this.setActiveField(field.id, false);
    }
  },

  // 高亮对应字段；预览位置完全交给用户通过拖拽、双指或双击控制。
  setActiveField(name, fromForm) {
    const field = this.findField(name);
    if (!field) return;
    const target = this.data.activePage === field.page
      ? null
      : this.data.pages.find((p) => p.page === field.page);
    const activePage = target || this.data.pages.find((p) => p.page === this.data.activePage);
    const activeLeaves = activePage ? activePage.leaves : this.data.activeLeaves;
    const geometry = target ? this.getPreviewGeometry(target) : null;
    const patch = {
      activeFieldName: name,
      activeFieldLabel: field.label,
      previewFields: this.buildPreviewFields(
        activeLeaves,
        this.data.values,
        name,
        activePage && activePage.width,
        geometry ? geometry.width : this.data.previewCanvasWidth,
      ),
    };
    if (target) {
      patch.activePage = field.page;
      patch.activeLeaves = target.leaves;
      patch.activeFormLeaves = this.filterFormLeaves(target.leaves);
      patch.previewImage = target.previewImage;
      patch.hasNextPage = this.hasNextPage(field.page);
      patch.previewCanvasWidth = geometry.width;
      patch.previewCanvasHeight = geometry.height;
      patch.previewScale = PREVIEW_MIN_SCALE;
      patch.previewX = geometry.x;
      patch.previewY = geometry.y;
      this._previewScale = PREVIEW_MIN_SCALE;
    }
    this.setData(patch);
  },

  findField(name) {
    // 用全量索引：现场手写字段不在 form.fields 中，但仍需参与预览定位/联动。
    return this.allFields.find((f) => f.id === name);
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
    const countryName = (this.form && this.form.country) || COUNTRY_NAME;
    const title = normalizeTitle(this.data.draftTitle) || buildDefaultApplicationTitle(countryName);
    const id = this.persistDraft(title);
    wx.navigateTo({ url: `/pages/preview/index?applicationId=${id}` });
  },

  confirmTitle(onConfirm) {
    const fallback = buildDefaultApplicationTitle((this.form && this.form.country) || COUNTRY_NAME);
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
    // 仅保存可在线录入的字段，避免旧草稿中的值被带入已改为手写的 AcroForm。
    const values = {};
    const acroformFieldMap = {};
    this.form.fields.forEach((field) => {
      values[field.id] = this.data.values[field.id];
      acroformFieldMap[field.id] = field.name;
    });
    const record = {
      id,
      templateId: this.form.templateId,
      templateVersion: this.form.templateVersion,
      title,
      country: this.form.country,
      visaType: this.form.title || '签证申请表',
      status: 'draft',
      values,
      acroformFieldMap,
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
