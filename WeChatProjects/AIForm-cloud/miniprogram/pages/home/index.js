const {
  continents,
  visaCatalog,
  findCountry,
} = require('../../utils/visaData');
const { getEditablePdf } = require('../../utils/editablePdfMap');

const HOT_FILTER = '热门';
const OFFICIAL_NOTICE_HIDDEN_KEY = 'official_notice_hidden';

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

function getDefaultSelection(country) {
  const selectedVisaType = country && country.visaTypes[0];
  const selectedDistrict = selectedVisaType && selectedVisaType.districts[0];
  const selectedVersion = selectedDistrict && selectedDistrict.versions[0];
  return {
    selectedCountry: country || null,
    selectedCountryId: country ? country.id : '',
    selectedVisaType: selectedVisaType || null,
    selectedVisaTypeId: selectedVisaType ? selectedVisaType.id : '',
    selectedDistrict: selectedDistrict || null,
    selectedVersion: selectedVersion || null,
    selectedVersionId: selectedVersion ? selectedVersion.id : '',
    selectedFillMode: selectedVersion ? 'smart' : '',
  };
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
    selectedFillMode: '',
    showOfficialNotice: false,
    dontRemindOfficialNotice: false,
  },

  onLoad() {
    this.refreshCountries({ autoSelect: true });
    this.setData({
      showOfficialNotice: !wx.getStorageSync(OFFICIAL_NOTICE_HIDDEN_KEY),
    });
  },

  noop() {},

  toggleOfficialNoticeDontRemind() {
    this.setData({
      dontRemindOfficialNotice: !this.data.dontRemindOfficialNotice,
    });
  },

  acknowledgeOfficialNotice() {
    if (this.data.dontRemindOfficialNotice) {
      wx.setStorageSync(OFFICIAL_NOTICE_HIDDEN_KEY, true);
    }
    this.setData({ showOfficialNotice: false });
  },

  onSearch(e) {
    this.setData({ query: e.detail.value || '' });
    this.refreshCountries();
  },

  selectContinent(e) {
    this.setData({
      selectedContinent: e.currentTarget.dataset.name,
      selectedCountry: null,
      selectedCountryId: '',
      selectedVisaType: null,
      selectedVisaTypeId: '',
      selectedDistrict: null,
      selectedVersion: null,
      selectedVersionId: '',
      selectedFillMode: '',
    });
    this.refreshCountries({ autoSelect: true });
  },

  selectCountry(e) {
    const country = decorateCountry(findCountry(e.currentTarget.dataset.id));
    this.setData({
      ...getDefaultSelection(country),
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
      selectedVersion: selectedDistrict.versions[0] || null,
      selectedVersionId: selectedDistrict.versions[0] ? selectedDistrict.versions[0].id : '',
      selectedFillMode: selectedDistrict.versions[0] ? 'smart' : '',
    });
  },

  selectVersion(e) {
    const selectedVersion = this.data.selectedDistrict.versions.find(
      (item) => item.id === e.currentTarget.dataset.id,
    );
    this.setData({
      selectedVersion,
      selectedVersionId: selectedVersion.id,
      selectedFillMode: 'smart',
    });
  },

  previewVersion(e) {
    const version = this.data.selectedDistrict.versions.find(
      (item) => item.id === e.currentTarget.dataset.id,
    );
    this.setData({
      selectedVersion: version,
      selectedVersionId: version.id,
      selectedFillMode: 'smart',
    });
    this.openPdfPreview();
  },

  startSmartFill() {
    const version = this.data.selectedVersion;
    if (!version) return;
    this.setData({ selectedFillMode: 'smart' });
    wx.navigateTo({
      url: `/pages/visa-form/index?templateId=${version.id}`,
    });
  },

  selectFillMode(e) {
    this.setData({
      selectedFillMode: e.currentTarget.dataset.mode,
    });
  },

  startSelectedMode() {
    if (this.data.selectedFillMode === 'pdf') {
      this.downloadPdf();
      return;
    }
    this.startSmartFill();
  },

  downloadPdf() {
    const version = this.data.selectedVersion;
    if (!version) return;

    const pdf = getEditablePdf(version.id);
    if (!pdf) {
      wx.showToast({
        title: '暂无可下载PDF',
        icon: 'none',
      });
      return;
    }

    if (!wx.cloud) {
      wx.showToast({
        title: '云下载不可用',
        icon: 'none',
      });
      return;
    }

    this.setData({ selectedFillMode: 'pdf' });

    wx.showLoading({
      title: '下载中',
      mask: true,
    });

    wx.cloud.downloadFile({
      fileID: pdf.fileID,
      success: (res) => {
        wx.hideLoading();
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType: pdf.fileType || 'pdf',
          showMenu: true,
          fail: (err) => {
            console.error('Open editable PDF failed:', err);
            wx.showToast({
              title: '打开PDF失败',
              icon: 'none',
            });
          },
        });
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('Download editable PDF failed:', err);
        wx.showToast({
          title: '下载失败',
          icon: 'none',
        });
      },
    });
  },

  refreshCountries(options = {}) {
    const query = this.data.query.trim().toLowerCase();
    const {selectedContinent} = this.data;
    const countries = visaCatalog.filter((country) => {
      const hitQuery = !query || country.name.toLowerCase().includes(query);
      const hitContinent = selectedContinent === HOT_FILTER
        ? country.hot
        : country.continent === selectedContinent;
      return hitQuery && hitContinent;
    }).map(decorateCountry);
    const nextData = { countries };
    if (options.autoSelect) {
      Object.assign(nextData, getDefaultSelection(countries[0]));
    }
    this.setData({
      ...nextData,
    });
  },

  openPdfPreview() {
    if (!this.data.selectedVersion) return;
    wx.navigateTo({
      url: `/pages/preview/index?templateId=${this.data.selectedVersion.id}&templatePreview=1`,
    });
  },
});
