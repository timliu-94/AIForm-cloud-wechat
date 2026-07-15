const {
  continents,
  visaCatalog,
} = require('../../utils/visaData');
const { firstLaunchNotice } = require('../../config/firstLaunchNotice');
const { listCountryFormVersions, openCloudPdf } = require('../../utils/countryFormCatalog');

const HOT_FILTER = '热门';
const OPEN_FEEDBACK_KEY = 'open_feedback_from_home_empty_country';

function getVisaTypeIcon(typeId) {
  if (typeId.includes('business')) return 'work';
  if (typeId.includes('student')) return 'education';
  return 'flight-takeoff';
}

function decorateCountry(country) {
  if (!country) return null;
  return {
    ...country,
    flagLabel: country.name.slice(0, 1),
    visaTypes: country.visaTypes.map((type) => ({
      ...type,
      icon: getVisaTypeIcon(type.id),
    })),
  };
}

function getCountrySelection(country) {
  return {
    selectedCountry: country || null,
    selectedCountryId: country ? country.id : '',
    selectedVisaType: null,
    selectedVisaTypeId: '',
    selectedDistrict: null,
    selectedVersion: null,
    selectedVersionId: '',
  };
}

function replaceItalyVersions(catalog, cloudVersions) {
  if (!cloudVersions.length) return catalog;
  return catalog.map((country) => {
    if (country.id !== 'italy') return country;
    return {
      ...country,
      visaTypes: country.visaTypes.map((visaType) => ({
        ...visaType,
        districts: visaType.districts.map((district) => (
          visaType.id === 'tourism' && district.id === 'shanghai'
            ? { ...district, versions: cloudVersions }
            : district
        )),
      })),
    };
  });
}

Page({
  data: {
    continents,
    destinationFilters: [HOT_FILTER, ...continents],
    hotFilter: HOT_FILTER,
    query: '',
    selectedContinent: HOT_FILTER,
    countries: [],
    selectedCountry: null,
    selectedCountryId: '',
    selectedVisaType: null,
    selectedVisaTypeId: '',
    selectedDistrict: null,
    selectedVersion: null,
    selectedVersionId: '',
    firstLaunchNotice,
    showFirstLaunchNotice: false,
    catalogLoading: false,
    catalogError: '',
  },

  onLoad() {
    this.runtimeVisaCatalog = visaCatalog;
    this.refreshCountries();
    this.loadCountryFormCatalog();
    this.setData({
      showFirstLaunchNotice: !wx.getStorageSync(firstLaunchNotice.storageKey),
    });
  },

  onPullDownRefresh() {
    this.loadCountryFormCatalog({ force: true }).then(() => wx.stopPullDownRefresh());
  },

  loadCountryFormCatalog(options = {}) {
    this.setData({ catalogLoading: true, catalogError: '' });
    return listCountryFormVersions('Italy', options)
      .then((versions) => {
        this.runtimeVisaCatalog = replaceItalyVersions(visaCatalog, versions);
        this.refreshCountries();
        this.setData({ catalogLoading: false });
      })
      .catch((err) => {
        console.error('Load country form catalog failed:', err);
        this.setData({
          catalogLoading: false,
          catalogError: err.message || String(err),
        });
      });
  },

  noop() {},

  acknowledgeFirstLaunchNotice() {
    wx.setStorageSync(firstLaunchNotice.storageKey, true);
    this.setData({ showFirstLaunchNotice: false });
  },

  onSearch(e) {
    this.setData({ query: e.detail.value || '' });
    this.refreshCountries();
  },

  openFeedback() {
    wx.setStorageSync(OPEN_FEEDBACK_KEY, true);
    wx.switchTab({
      url: '/pages/my/index',
    });
  },

  selectContinent(e) {
    this.setData({
      query: '',
      selectedContinent: e.currentTarget.dataset.name,
      selectedCountry: null,
      selectedCountryId: '',
      selectedVisaType: null,
      selectedVisaTypeId: '',
      selectedDistrict: null,
      selectedVersion: null,
      selectedVersionId: '',
    });
    this.refreshCountries();
  },

  selectCountry(e) {
    const source = this.runtimeVisaCatalog || visaCatalog;
    const country = decorateCountry(source.find((item) => item.id === e.currentTarget.dataset.id));
    this.setData({
      ...getCountrySelection(country),
    });
  },

  selectVisaType(e) {
    const selectedVisaType = this.data.selectedCountry.visaTypes.find(
      (item) => item.id === e.currentTarget.dataset.id,
    );
    const selectedDistrict = selectedVisaType.districts[0];
    this.setData({
      selectedVisaType,
      selectedVisaTypeId: selectedVisaType.id,
      selectedDistrict,
      selectedVersion: null,
      selectedVersionId: '',
    });
  },

  selectVersion(e) {
    const selectedVersion = this.data.selectedDistrict.versions.find(
      (item) => item.id === e.currentTarget.dataset.id,
    );
    this.setData({
      selectedVersion,
      selectedVersionId: selectedVersion.id,
    });
  },

  previewVersion(e) {
    const version = this.data.selectedDistrict.versions.find(
      (item) => item.id === e.currentTarget.dataset.id,
    );
    this.setData({
      selectedVersion: version,
      selectedVersionId: version.id,
    });
    this.openPdfPreview(version);
  },

  startSmartFill() {
    if (!this.data.selectedCountry) {
      wx.showToast({ title: '请先完成第一步：选择目的地', icon: 'none' });
      return;
    }
    if (!this.data.selectedVisaType) {
      wx.showToast({ title: '请先完成第二步：选择签证类型', icon: 'none' });
      return;
    }
    const version = this.data.selectedVersion;
    if (!version) {
      wx.showToast({ title: '请先完成第三步：确认申请表', icon: 'none' });
      return;
    }
    if (version.availableForFill === false) {
      wx.showToast({ title: '该申请表填写资源不完整，请选择其他申请表', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/visa-form/index?templateId=${version.id}`,
    });
  },

  startSelectedMode() {
    this.startSmartFill();
  },

  refreshCountries() {
    const query = this.data.query.trim().toLowerCase();
    const {selectedContinent} = this.data;
    const countries = (this.runtimeVisaCatalog || visaCatalog).filter((country) => {
      const hitQuery = !query || country.name.toLowerCase().includes(query);
      const hitContinent = selectedContinent === HOT_FILTER
        ? country.hot
        : country.continent === selectedContinent;
      return hitQuery && hitContinent;
    }).map(decorateCountry);
    this.setData({ countries });
  },

  openPdfPreview(version) {
    const selectedVersion = version || this.data.selectedVersion;
    if (!selectedVersion) return;
    openCloudPdf(selectedVersion.sourcePdf)
      .catch((err) => {
        console.error('Open cloud PDF failed:', err);
        wx.showModal({
          title: 'PDF 打开失败',
          content: err.errMsg || err.message || String(err),
          showCancel: false,
        });
      });
  },
});
