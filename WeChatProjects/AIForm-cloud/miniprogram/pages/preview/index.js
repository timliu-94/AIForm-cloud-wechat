const { buildForm, buildPreviewPages, COUNTRY_NAME } = require('../../utils/italyForm');
const { findTemplate } = require('../../utils/visaData');
const { buildDefaultApplicationTitle, normalizeTitle } = require('../../utils/applicationTitle');
const { resolvePreviewImages } = require('../../utils/cloudAssets');
const { exportApplicationPdf, getPdfExportErrorMessage, getPdfExportErrorTitle } = require('../../utils/pdfExport');

const APPLICATIONS_KEY = 'visa_applications';

Page({
  data: {
    application: null,
    pages: [],
    pageIndex: 0,
    currentPage: null,
    showLabels: false,
    pendingCount: 0,
    isTemplatePreview: false,
  },

  onLoad(options) {
    const { applicationId, templateId } = options;
    if (!applicationId && templateId) {
      this.loadTemplatePreview(templateId);
      return;
    }

    const applications = wx.getStorageSync(APPLICATIONS_KEY) || [];
    const application = applications.find((item) => item.id === applicationId);
    if (!application) {
      wx.showToast({ title: '表格不存在', icon: 'none' });
      return;
    }

    const form = buildForm();
    const values = application.values || {};
    const pages = buildPreviewPages(form, values);
    const pendingCount = pages.reduce(
      (n, page) => n + page.overlays.filter((o) => !o.filled && !o.manual).length,
      0,
    );

    resolvePreviewImages(pages)
      .then((resolvedPages) => {
        this.setData({
          application,
          pages: resolvedPages,
          pageIndex: 0,
          currentPage: resolvedPages[0] || null,
          pendingCount,
          isTemplatePreview: false,
        });
      })
      .catch(() => {
        wx.showToast({ title: '预览图加载失败', icon: 'none' });
      });
  },

  onPreviewImageError() {
    console.error('PDF preview image load failed:', this.data.currentPage && this.data.currentPage.previewImage);
    wx.showToast({ title: '预览图加载失败', icon: 'none' });
  },

  onPreviewImageLoad() {
    console.log('PDF preview image loaded:', this.data.currentPage && this.data.currentPage.previewImage);
  },

  loadTemplatePreview(templateId) {
    const form = buildForm();
    const template = findTemplate(templateId);
    const pages = form.pages.map((page) => ({
      page: page.page,
      previewImage: page.previewImage,
      overlays: [],
    }));
    const application = {
      title: template ? template.version.name : form.title,
      country: template ? template.country.name : form.country,
      visaType: template ? template.visaType.name : '原始表格',
    };

    resolvePreviewImages(pages)
      .then((resolvedPages) => {
        this.setData({
          application,
          pages: resolvedPages,
          pageIndex: 0,
          currentPage: resolvedPages[0] || null,
          pendingCount: 0,
          isTemplatePreview: true,
        });
      })
      .catch((err) => {
        console.error('Resolve preview images failed:', err);
        wx.showToast({ title: '预览图加载失败', icon: 'none' });
      });
  },

  switchPage(e) {
    const pageIndex = Number(e.currentTarget.dataset.index);
    this.setData({ pageIndex, currentPage: this.data.pages[pageIndex] });
  },

  prevPage() {
    if (this.data.pageIndex <= 0) return;
    const pageIndex = this.data.pageIndex - 1;
    this.setData({ pageIndex, currentPage: this.data.pages[pageIndex] });
  },

  nextPage() {
    if (this.data.pageIndex >= this.data.pages.length - 1) return;
    const pageIndex = this.data.pageIndex + 1;
    this.setData({ pageIndex, currentPage: this.data.pages[pageIndex] });
  },

  toggleLabels() {
    this.setData({ showLabels: !this.data.showLabels });
  },

  previewImage() {
    const urls = this.data.pages.map((page) => page.previewImage);
    wx.previewImage({ current: urls[this.data.pageIndex], urls });
  },

  editForm() {
    if (this.data.isTemplatePreview) return;
    if (!this.data.application) return;
    wx.navigateTo({
      url: `/pages/visa-form/index?applicationId=${this.data.application.id}`,
    });
  },

  backToHome() {
    wx.switchTab({
      url: '/pages/home/index',
    });
  },

  exportPdf() {
    if (this.data.isTemplatePreview) return;
    const { application } = this.data;
    if (!application) return;
    const fallback = buildDefaultApplicationTitle(COUNTRY_NAME);
    // 标题在导出环节填写（预览时不再弹框）。
    wx.showModal({
      title: '导出 PDF',
      editable: true,
      placeholderText: '请输入表格标题',
      content: normalizeTitle(application.title) || fallback,
      success: (res) => {
        if (!res.confirm) return;
        const title = normalizeTitle(res.content);
        if (!title) {
          wx.showToast({ title: '标题不能为空', icon: 'none' });
          return;
        }
        this.saveTitle(title);
        exportApplicationPdf({ ...application, title }, title).catch((err) => {
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

  saveTitle(title) {
    const application = { ...this.data.application, title };
    const applications = wx.getStorageSync(APPLICATIONS_KEY) || [];
    const index = applications.findIndex((item) => item.id === application.id);
    if (index >= 0) {
      applications[index] = { ...applications[index], title };
      wx.setStorageSync(APPLICATIONS_KEY, applications);
    }
    this.setData({ application });
  },
});
