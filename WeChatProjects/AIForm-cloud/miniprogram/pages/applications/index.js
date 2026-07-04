const APPLICATIONS_KEY = 'visa_applications';
const TRIP_FIELDS = ['arrival_date', 'departure_date', 'hotel_address', 'expense_self'];
const { buildCompanionApplicationTitle, normalizeTitle } = require('../../utils/applicationTitle');
const { findTemplate, visaCatalog } = require('../../utils/visaData');

function padTime(value) {
  return String(value).padStart(2, '0');
}

function isSameDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '未知时间';

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;

  if (isSameDate(date, now)) return `今天 ${time}`;
  if (isSameDate(date, yesterday)) return `昨天 ${time}`;
  const dateText = [
    date.getFullYear(),
    padTime(date.getMonth() + 1),
    padTime(date.getDate()),
  ].join('-');
  return `${dateText} ${time}`;
}

function decorateApplications(applications) {
  return (applications || []).map((item) => {
    const template = findTemplate(item.templateId);
    const country = template
      ? template.country
      : visaCatalog.find((catalogItem) => catalogItem.name === item.country);
    return {
      ...item,
      countryFlag: country ? country.flag : '',
      countryFlagLabel: (country ? country.name : item.country || '').slice(0, 1),
      formVersionTitle: template ? template.version.name : (item.formVersionTitle || item.visaType || ''),
      displayUpdatedAt: formatUpdatedAt(item.updatedAt),
    };
  });
}

function toStoredApplications(applications) {
  return (applications || []).map((item) => {
    const {
      countryFlag,
      countryFlagLabel,
      formVersionTitle,
      displayUpdatedAt,
      selected,
      ...application
    } = item;
    return application;
  });
}

Page({
  data: {
    applications: [],
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
  },

  onShow() {
    this.loadApplications();
  },

  loadApplications() {
    this.setApplications(wx.getStorageSync(APPLICATIONS_KEY) || []);
  },

  editApplication(e) {
    const item = this.data.applications[Number(e.currentTarget.dataset.index)];
    wx.navigateTo({
      url: `/pages/visa-form/index?templateId=${item.templateId}&applicationId=${item.id}`,
    });
  },

  previewApplication(e) {
    const item = this.data.applications[Number(e.currentTarget.dataset.index)];
    wx.navigateTo({
      url: `/pages/preview/index?applicationId=${item.id}`,
    });
  },

  copyForCompanion(e) {
    const source = this.data.applications[Number(e.currentTarget.dataset.index)];
    const now = new Date().toISOString();
    const values = {};
    TRIP_FIELDS.forEach((field) => {
      values[field] = source.values[field] || '';
    });
    const copy = {
      ...source,
      id: `app_${Date.now()}`,
      title: buildCompanionApplicationTitle(source.title, this.data.applications),
      status: 'draft',
      values,
      createdAt: now,
      updatedAt: now,
    };
    const storedApplications = toStoredApplications([copy, ...this.data.applications]);
    wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
    this.setApplications(storedApplications);
    wx.showToast({ title: '已为同行人创建', icon: 'success' });
  },

  renameApplication(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.applications[index];
    wx.showModal({
      title: '修改标题',
      editable: true,
      placeholderText: '请输入表格标题',
      content: item.title || '',
      success: (res) => {
        if (!res.confirm) return;
        const title = normalizeTitle(res.content);
        if (!title) {
          wx.showToast({ title: '标题不能为空', icon: 'none' });
          return;
        }
        const applications = this.data.applications.slice();
        applications[index] = {
          ...applications[index],
          title,
          updatedAt: new Date().toISOString(),
        };
        const storedApplications = toStoredApplications(applications);
        wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
        this.setApplications(storedApplications);
        wx.showToast({ title: '标题已更新', icon: 'success' });
      },
    });
  },

  exportApplication(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.applications[index];
    wx.showModal({
      title: '导出 PDF',
      editable: true,
      placeholderText: '请输入表格标题',
      content: normalizeTitle(item.title),
      success: (res) => {
        if (!res.confirm) return;
        const title = normalizeTitle(res.content);
        if (!title) {
          wx.showToast({ title: '标题不能为空', icon: 'none' });
          return;
        }
        const applications = this.data.applications.slice();
        applications[index] = {
          ...applications[index],
          title,
          updatedAt: new Date().toISOString(),
        };
        const storedApplications = toStoredApplications(applications);
        wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
        this.setApplications(storedApplications);
        wx.showModal({
          title: '导出 PDF',
          content: '示范版仅演示预览。正式环境将把已填写的值写回 PDF 表格并生成可下载文件。下载后请自行核对，并按领事馆或官方签证中心要求完成打印、签字、预约或递交。',
          showCancel: false,
        });
      },
    });
  },

  deleteApplication(e) {
    const index = Number(e.currentTarget.dataset.index);
    wx.showModal({
      title: '删除表格',
      content: '删除后不会影响已保存的人员卡和旅程卡。',
      success: (res) => {
        if (!res.confirm) return;
        const applications = this.data.applications.slice();
        applications.splice(index, 1);
        const storedApplications = toStoredApplications(applications);
        wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
        this.setApplications(storedApplications);
      },
    });
  },

  setApplications(applications) {
    const decoratedApplications = decorateApplications(applications);
    const existingIds = decoratedApplications.map((item) => item.id);
    const selectedIds = this.data.selectedIds.filter((id) => existingIds.includes(id));
    const selectedSet = new Set(selectedIds);
    this.setData({
      applications: decoratedApplications.map((item) => ({
        ...item,
        selected: selectedSet.has(item.id),
      })),
      selectedIds,
      selectedCount: selectedIds.length,
      allSelected: decoratedApplications.length > 0 && selectedIds.length === decoratedApplications.length,
    });
  },

  toggleSelectApplication(e) {
    const { id } = e.currentTarget.dataset;
    const selectedIds = this.data.selectedIds.includes(id)
      ? this.data.selectedIds.filter((itemId) => itemId !== id)
      : [...this.data.selectedIds, id];
    this.updateSelection(selectedIds);
  },

  toggleSelectAll() {
    const selectedIds = this.data.allSelected ? [] : this.data.applications.map((item) => item.id);
    this.updateSelection(selectedIds);
  },

  updateSelection(selectedIds) {
    const selectedSet = new Set(selectedIds);
    this.setData({
      applications: this.data.applications.map((item) => ({
        ...item,
        selected: selectedSet.has(item.id),
      })),
      selectedIds,
      selectedCount: selectedIds.length,
      allSelected: this.data.applications.length > 0 && selectedIds.length === this.data.applications.length,
    });
  },

  deleteSelectedApplications() {
    const selectedCount = this.data.selectedIds.length;
    if (!selectedCount) return;
    wx.showModal({
      title: '删除表格',
      content: `确定删除选中的 ${selectedCount} 份表格吗？删除后不可恢复。`,
      success: (res) => {
        if (!res.confirm) return;
        const selectedSet = new Set(this.data.selectedIds);
        const applications = this.data.applications.filter((item) => !selectedSet.has(item.id));
        const storedApplications = toStoredApplications(applications);
        wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
        this.setData({ selectedIds: [] }, () => this.setApplications(storedApplications));
        wx.showToast({ title: `已删除 ${selectedCount} 份`, icon: 'success' });
      },
    });
  },
});
