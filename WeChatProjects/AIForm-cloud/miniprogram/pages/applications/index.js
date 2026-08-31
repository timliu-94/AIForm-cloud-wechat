const APPLICATIONS_KEY = 'visa_applications';
const { buildCopyApplicationTitle, normalizeTitle } = require('../../utils/applicationTitle');
const { findTemplate, visaCatalog } = require('../../utils/visaData');
const { loadForm } = require('../../utils/italyForm');
const { exportApplicationPdf, getPdfExportErrorMessage, getPdfExportErrorTitle } = require('../../utils/pdfExport');
const { hideExportProgress, showExportProgress } = require('../../utils/exportProgress');
const { createInvite } = require('../../utils/invite');
const {
  applySelectionPreference,
  buildReusableBlockOptions,
  buildSelectionScope,
  isJapanForm,
  saveSelectionPreference,
} = require('../../utils/reusableFieldSelection');
const { shareFillNotice } = require('../../config/shareFillNotice');
const { companionCreateNotice } = require('../../config/companionCreateNotice');

const SHARE_FILL_COVER = '/static/share-fill-cover.jpg';
const COMPANION_SELECTION_TIP = '系统默认带入行程、住宿等共用信息；姓名、证件号码、国籍等个人信息默认不带入。';
const INVITE_SELECTION_TIP = '行程、住宿等共用信息默认选中；姓名、证件号码、国籍等个人信息默认不选。';
const JAPAN_SELECTION_TIP = '日本签证默认选择居住身份、酒店名称、在日担保人、在日邀请人及“是否”项，其余默认不选。';

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
      formVersionTitle: template
        ? template.version.name
        : ((item.templateVersion && item.templateVersion.name) || item.formVersionTitle || item.visaType || ''),
      displayUpdatedAt: formatUpdatedAt(item.updatedAt),
    };
  });
}

function filterApplicationsByTitle(applications, keyword) {
  const searchText = normalizeTitle(keyword).toLowerCase();
  if (!searchText) return applications;
  return applications.filter((item) => normalizeTitle(item.title).toLowerCase().includes(searchText));
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

function getApplicationFieldValue(application, block, fieldId) {
  const values = (application && application.values) || {};
  if (Object.prototype.hasOwnProperty.call(values, fieldId)) return values[fieldId];
  const acroformName = block.acroformNames && block.acroformNames[fieldId];
  return acroformName ? values[acroformName] : undefined;
}

Page({
  data: {
    allApplications: [],
    applications: [],
    searchKeyword: '',
    totalCount: 0,
    filteredCount: 0,
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
    companionDialogVisible: false,
    companionSourceId: '',
    companionSourceTitle: '',
    companionSelectionScope: '',
    companionSelectionTip: COMPANION_SELECTION_TIP,
    companionFields: [],
    companionSelectedCount: 0,
    companionAllSelected: false,
    companionCreateNotice,
    companionNoticeVisible: false,
    companionDontRemind: false,
    pendingCompanionIndex: -1,
    inviteDialogVisible: false,
    inviteSourceId: '',
    inviteSourceTitle: '',
    inviteSelectionScope: '',
    inviteSelectionTip: INVITE_SELECTION_TIP,
    inviteMode: '',
    inviteFields: [],
    inviteSelectedCount: 0,
    inviteAllSelected: false,
    inviteCreating: false,
    shareFillNotice,
    shareFillNoticeVisible: false,
    shareFillDontRemind: false,
    pendingShareIndex: -1,
    exportProgressVisible: false,
    exportProgressStage: 'generating',
    exportProgress: 8,
    exportProgressStyle: 'width: 8%;',
  },

  onShow() {
    this.loadApplications();
  },

  onUnload() {
    hideExportProgress(this);
  },

  loadApplications() {
    this.setApplications(wx.getStorageSync(APPLICATIONS_KEY) || []);
  },

  editApplication(e) {
    const item = this.data.applications[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    wx.navigateTo({
      url: `/pages/visa-form/index?templateId=${item.templateId}&applicationId=${item.id}`,
    });
  },

  previewApplication(e) {
    const item = this.data.applications[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    wx.navigateTo({
      url: `/pages/preview/index?applicationId=${item.id}`,
    });
  },

  copyForCompanion(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.applications[index]) return;
    // 首次使用「为同行人创建」先弹出功能说明，用户勾选「不再提示」后不再弹出。
    if (!wx.getStorageSync(companionCreateNotice.storageKey)) {
      this.setData({
        companionNoticeVisible: true,
        companionDontRemind: false,
        pendingCompanionIndex: index,
      });
      return;
    }
    this.openCompanionDialog(index);
  },

  // 取消：仅关闭说明弹窗，不进入复制设置。
  cancelCompanionNotice() {
    this.setData({ companionNoticeVisible: false, pendingCompanionIndex: -1 });
  },

  toggleCompanionRemind() {
    this.setData({ companionDontRemind: !this.data.companionDontRemind });
  },

  // 确认：勾选「不再提示」则记住，随后进入复制设置。
  confirmCompanionNotice() {
    if (this.data.companionDontRemind) wx.setStorageSync(companionCreateNotice.storageKey, true);
    const index = this.data.pendingCompanionIndex;
    this.setData({ companionNoticeVisible: false, pendingCompanionIndex: -1 });
    if (index >= 0) this.openCompanionDialog(index);
  },

  openCompanionDialog(index) {
    const source = this.data.applications[index];
    if (!source) return;
    wx.showLoading({ title: '表单加载中', mask: true });
    loadForm(source.templateId, source.templateVersion)
      .then((form) => {
        const companionSelectionScope = buildSelectionScope(form);
        const companionFields = applySelectionPreference(
          buildReusableBlockOptions(form),
          'companion',
          companionSelectionScope,
        );
        if (!companionFields.length) {
          wx.showToast({ title: '暂无可复制文本块', icon: 'none' });
          return;
        }
        const companionSelectedCount = companionFields.filter((field) => field.selected).length;
        this.setData({
          companionDialogVisible: true,
          companionSourceId: source.id,
          companionSourceTitle: source.title || '',
          companionSelectionScope,
          companionSelectionTip: isJapanForm(form) ? JAPAN_SELECTION_TIP : COMPANION_SELECTION_TIP,
          companionFields,
          companionSelectedCount,
          companionAllSelected: companionSelectedCount === companionFields.length,
        });
      })
      .catch((err) => {
        console.error('Load companion form resources failed:', err);
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

  closeCompanionDialog() {
    this.setData({
      companionDialogVisible: false,
      companionSourceId: '',
      companionSourceTitle: '',
      companionSelectionScope: '',
      companionFields: [],
      companionSelectedCount: 0,
      companionAllSelected: false,
    });
  },

  stopCompanionDialogTap() {},

  toggleCompanionField(e) {
    const { name } = e.currentTarget.dataset;
    const companionFields = this.data.companionFields.map((field) => (
      field.name === name ? { ...field, selected: !field.selected } : field
    ));
    this.updateCompanionSelection(companionFields);
  },

  toggleCompanionAll() {
    const selected = !this.data.companionAllSelected;
    const companionFields = this.data.companionFields.map((field) => ({ ...field, selected }));
    this.updateCompanionSelection(companionFields);
  },

  updateCompanionSelection(companionFields) {
    const companionSelectedCount = companionFields.filter((field) => field.selected).length;
    this.setData({
      companionFields,
      companionSelectedCount,
      companionAllSelected: companionFields.length > 0 && companionSelectedCount === companionFields.length,
    });
    saveSelectionPreference(companionFields, 'companion', this.data.companionSelectionScope);
  },

  createCompanionApplication() {
    const source = this.data.allApplications.find((item) => item.id === this.data.companionSourceId);
    if (!source) {
      this.closeCompanionDialog();
      return;
    }
    const selectedBlocks = this.data.companionFields.filter((field) => field.selected);
    if (!selectedBlocks.length) {
      wx.showToast({ title: '请至少选择一项', icon: 'none' });
      return;
    }
    const now = new Date().toISOString();
    const values = {};
    selectedBlocks.forEach((block) => {
      (block.fieldNames || []).forEach((fieldName) => {
        values[fieldName] = getApplicationFieldValue(source, block, fieldName);
      });
    });
    const copy = {
      ...source,
      id: `app_${Date.now()}`,
      title: buildCopyApplicationTitle(source.title, this.data.allApplications),
      status: 'draft',
      values,
      createdAt: now,
      updatedAt: now,
    };
    const storedApplications = toStoredApplications([copy, ...this.data.allApplications]);
    wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
    this.closeCompanionDialog();
    this.setApplications(storedApplications);
    wx.showToast({ title: '已创建副本', icon: 'success' });
  },

  openShareFill(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.applications[index]) return;
    // 首次使用「分享填写」先弹出功能说明，用户勾选「不再提示」后不再弹出。
    if (!wx.getStorageSync(shareFillNotice.storageKey)) {
      this.setData({
        shareFillNoticeVisible: true,
        shareFillDontRemind: false,
        pendingShareIndex: index,
      });
      return;
    }
    this.openInviteDialog(index);
  },

  // 取消：仅关闭说明弹窗，不进入分享设置。
  cancelShareFillNotice() {
    this.setData({ shareFillNoticeVisible: false, pendingShareIndex: -1 });
  },

  toggleShareFillRemind() {
    this.setData({ shareFillDontRemind: !this.data.shareFillDontRemind });
  },

  // 确认：勾选「不再提示」则记住，随后进入分享设置。
  confirmShareFillNotice() {
    if (this.data.shareFillDontRemind) wx.setStorageSync(shareFillNotice.storageKey, true);
    const index = this.data.pendingShareIndex;
    this.setData({ shareFillNoticeVisible: false, pendingShareIndex: -1 });
    if (index >= 0) this.openInviteDialog(index);
  },

  openInviteDialog(index) {
    const source = this.data.applications[index];
    if (!source) return;
    wx.showLoading({ title: '表单加载中', mask: true });
    loadForm(source.templateId, source.templateVersion)
      .then((form) => {
        const inviteSelectionScope = buildSelectionScope(form);
        const inviteFields = applySelectionPreference(
          buildReusableBlockOptions(form),
          'invite',
          inviteSelectionScope,
        );
        const inviteSelectedCount = inviteFields.filter((field) => field.selected).length;
        this.setData({
          inviteDialogVisible: true,
          inviteSourceId: source.id,
          inviteSourceTitle: source.title || '',
          inviteSelectionScope,
          inviteSelectionTip: isJapanForm(form) ? JAPAN_SELECTION_TIP : INVITE_SELECTION_TIP,
          inviteMode: '',
          inviteFields,
          inviteSelectedCount,
          inviteAllSelected: inviteFields.length > 0 && inviteSelectedCount === inviteFields.length,
          inviteCreating: false,
        });
      })
      .catch((err) => {
        console.error('Load invite form resources failed:', err);
        const retryable = err && err.code === 'CLOUD_DOWNLOAD_INTERRUPTED';
        wx.showModal({
          title: '表单资源加载失败',
          content: err.message || String(err),
          showCancel: false,
          confirmText: retryable ? '重试' : '知道了',
          success: (res) => {
            if (retryable && res.confirm) this.openInviteDialog(index);
          },
        });
      })
      .then(
        () => wx.hideLoading(),
        () => wx.hideLoading(),
      );
  },

  closeInviteDialog() {
    this.setData({
      inviteDialogVisible: false,
      inviteSourceId: '',
      inviteSourceTitle: '',
      inviteSelectionScope: '',
      inviteMode: '',
      inviteFields: [],
      inviteSelectedCount: 0,
      inviteAllSelected: false,
      inviteCreating: false,
    });
  },

  selectInviteMode(e) {
    const { mode } = e.currentTarget.dataset;
    const inviteMode = mode === 'blank' ? 'blank' : 'content';
    if (inviteMode === this.data.inviteMode) return;
    this.setData({
      inviteMode,
      inviteCreating: false,
    });
  },

  toggleInviteField(e) {
    const { name } = e.currentTarget.dataset;
    const inviteFields = this.data.inviteFields.map((field) => (
      field.name === name ? { ...field, selected: !field.selected } : field
    ));
    this.updateInviteSelection(inviteFields);
  },

  toggleInviteAll() {
    const selected = !this.data.inviteAllSelected;
    const inviteFields = this.data.inviteFields.map((field) => ({ ...field, selected }));
    this.updateInviteSelection(inviteFields);
  },

  updateInviteSelection(inviteFields) {
    const inviteSelectedCount = inviteFields.filter((field) => field.selected).length;
    this.setData({
      inviteFields,
      inviteSelectedCount,
      inviteAllSelected: inviteFields.length > 0 && inviteSelectedCount === inviteFields.length,
      inviteCreating: false,
    });
    saveSelectionPreference(inviteFields, 'invite', this.data.inviteSelectionScope);
  },

  buildInvitePayload() {
    const source = this.data.allApplications.find((item) => item.id === this.data.inviteSourceId);
    if (!source) return null;
    if (this.data.inviteMode !== 'blank' && this.data.inviteMode !== 'content') return null;
    const mode = this.data.inviteMode === 'blank' ? 'blank' : 'content';
    const values = {};
    if (mode === 'content') {
      const selectedBlocks = this.data.inviteFields.filter((field) => field.selected);
      if (!selectedBlocks.length) return null;
      selectedBlocks.forEach((block) => {
        (block.fieldNames || []).forEach((fieldName) => {
          const value = getApplicationFieldValue(source, block, fieldName);
          if (value !== undefined) values[fieldName] = value;
        });
      });
    }
    return {
      source,
      mode,
      values,
    };
  },

  createInviteShareConfig(payload) {
    const title = payload.source.title
      ? `请帮我填写：${payload.source.title}`
      : '请帮我填写签证申请表';
    this.setData({ inviteCreating: true });
    return createInvite({
      templateId: payload.source.templateId,
      templateVersion: payload.source.templateVersion,
      mode: payload.mode,
      values: payload.values,
    })
      .then((inviteId) => {
        this.closeInviteDialog();
        return {
          title,
          path: `/pages/visa-form/index?inviteId=${inviteId}`,
          imageUrl: SHARE_FILL_COVER,
        };
      })
      .catch((err) => {
        console.error('Create invite failed:', err);
        this.setData({ inviteCreating: false });
        wx.showModal({
          title: err.code === 'FUNCTION_NOT_FOUND' ? '请先部署云函数' : '生成分享失败',
          content: err.message || String(err),
          showCancel: false,
        });
        throw err;
      });
  },

  onShareAppMessage(options = {}) {
    const isInviteShare = options.from === 'button'
      && options.target
      && options.target.dataset.shareType === 'invite';
    if (isInviteShare) {
      const payload = this.buildInvitePayload();
      if (!payload) {
        wx.showToast({ title: '请先完成分享配置', icon: 'none' });
        return {
          title: '签证申请表辅助填写',
          path: '/pages/home/index',
          imageUrl: SHARE_FILL_COVER,
        };
      }
      const title = payload.source.title
        ? `请帮我填写：${payload.source.title}`
        : '请帮我填写签证申请表';
      return {
        title,
        path: '/pages/home/index',
        imageUrl: SHARE_FILL_COVER,
        promise: this.createInviteShareConfig(payload),
      };
    }
    return {
      title: '签证申请表辅助填写',
      path: '/pages/home/index',
      imageUrl: SHARE_FILL_COVER,
    };
  },

  renameApplication(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.applications[index];
    if (!item) return;
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
        const applications = this.data.allApplications.map((application) => application.id === item.id ? {
          ...application,
          title,
          updatedAt: new Date().toISOString(),
        } : application);
        const storedApplications = toStoredApplications(applications);
        wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
        this.setApplications(storedApplications);
        wx.showToast({ title: '标题已更新', icon: 'success' });
      },
    });
  },

  exportApplication(e) {
    if (this.data.exportProgressVisible) return;
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.applications[index];
    if (!item) return;
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
        const applications = this.data.allApplications.map((application) => application.id === item.id ? {
          ...application,
          title,
          updatedAt: new Date().toISOString(),
        } : application);
        const storedApplications = toStoredApplications(applications);
        wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
        this.setApplications(storedApplications);
        const exportItem = applications.find((application) => application.id === item.id);
        exportApplicationPdf(exportItem, title, {
          onStage: (stage) => showExportProgress(this, stage),
        })
          .then(() => hideExportProgress(this))
          .catch((err) => {
            hideExportProgress(this);
            console.error('Export PDF failed:', err);
            wx.showModal({
              title: getPdfExportErrorTitle(err),
              content: getPdfExportErrorMessage(err),
              showCancel: false,
            });
          });
      },
    });
  },

  deleteApplication(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.applications[index];
    if (!item) return;
    wx.showModal({
      title: '删除表格',
      content: '删除后不会影响已保存的人员卡和旅程卡。',
      success: (res) => {
        if (!res.confirm) return;
        const applications = this.data.allApplications.filter((application) => application.id !== item.id);
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
    this.applyApplications(decoratedApplications, selectedIds, this.data.searchKeyword);
  },

  applyApplications(allApplications, selectedIds, searchKeyword) {
    const selectedSet = new Set(selectedIds);
    const applications = filterApplicationsByTitle(allApplications, searchKeyword);
    this.setData({
      allApplications: allApplications.map((item) => ({
        ...item,
        selected: selectedSet.has(item.id),
      })),
      applications: applications.map((item) => ({
        ...item,
        selected: selectedSet.has(item.id),
      })),
      searchKeyword,
      totalCount: allApplications.length,
      filteredCount: applications.length,
      selectedIds,
      selectedCount: selectedIds.length,
      allSelected: applications.length > 0 && applications.every((item) => selectedSet.has(item.id)),
    });
  },

  onSearchInput(e) {
    this.applyApplications(this.data.allApplications, this.data.selectedIds, e.detail.value || '');
  },

  clearSearch() {
    this.applyApplications(this.data.allApplications, this.data.selectedIds, '');
  },

  preventTouchMove() {},

  toggleSelectApplication(e) {
    const { id } = e.currentTarget.dataset;
    const selectedIds = this.data.selectedIds.includes(id)
      ? this.data.selectedIds.filter((itemId) => itemId !== id)
      : [...this.data.selectedIds, id];
    this.updateSelection(selectedIds);
  },

  toggleSelectAll() {
    const visibleIds = this.data.applications.map((item) => item.id);
    const visibleSet = new Set(visibleIds);
    const selectedIds = this.data.allSelected
      ? this.data.selectedIds.filter((id) => !visibleSet.has(id))
      : Array.from(new Set([...this.data.selectedIds, ...visibleIds]));
    this.updateSelection(selectedIds);
  },

  updateSelection(selectedIds) {
    this.applyApplications(this.data.allApplications, selectedIds, this.data.searchKeyword);
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
        const applications = this.data.allApplications.filter((item) => !selectedSet.has(item.id));
        const storedApplications = toStoredApplications(applications);
        wx.setStorageSync(APPLICATIONS_KEY, storedApplications);
        this.setData({ selectedIds: [] }, () => this.setApplications(storedApplications));
        wx.showToast({ title: `已删除 ${selectedCount} 份`, icon: 'success' });
      },
    });
  },
});
