const {
  continents,
  visaCatalog,
  findCountry,
} = require('../../utils/visaData');

const HOT_FILTER = '热门';
const OFFICIAL_NOTICE_HIDDEN_KEY = 'official_notice_hidden';
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
    this.openPdfPreview();
  },

  startSmartFill() {
    const version = this.data.selectedVersion;
    if (!version) return;
    wx.navigateTo({
      url: `/pages/visa-form/index?templateId=${version.id}`,
    });
  },

  startSelectedMode() {
    this.startSmartFill();
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
