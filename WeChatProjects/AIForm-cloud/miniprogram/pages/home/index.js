const {
  continents,
  visaCatalog,
  replaceCountryCloudVersions,
} = require('../../utils/visaData');
const {
  loadCloudCountryFormVersions,
  openCloudPdf,
} = require('../../utils/countryFormCatalog');
const { getHomeShareMessage } = require('../../utils/share');

const HOT_FILTER = '热门';

function countryHasPdfVersion(country) {
  return Boolean(country && (country.visaTypes || []).some((visaType) => (
    (visaType.districts || []).some((district) => (
      (district.versions || []).some((version) => (
        Boolean(version && (version.sourcePdf || version.pdfFilename))
      ))
    ))
  )));
}

function getAvailableContinents(catalog) {
  return continents.filter((continent) => (
    (catalog || []).some((country) => (
      country.continent === continent && countryHasPdfVersion(country)
    ))
  ));
}

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

function countryMatchesQuery(country, query) {
  if (!query) return true;
  return [country.name, country.id, country.iso2, ...(country.searchAliases || [])]
    .some((term) => String(term || '').toLowerCase().includes(query));
}

Page({
  data: {
    continents: getAvailableContinents(visaCatalog),
    destinationFilters: [HOT_FILTER, ...getAvailableContinents(visaCatalog)],
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
    searchGuideCountryName: '',
  },

  onLoad() {
    this.runtimeVisaCatalog = visaCatalog;
    this.refreshCountries();
  },

  refreshCloudVersions(countryId) {
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      return Promise.resolve(false);
    }
    const country = (this.runtimeVisaCatalog || []).find((item) => item.id === countryId);
    if (!country) return Promise.resolve(false);
    const requestId = (this._countryVersionRequestId || 0) + 1;
    this._countryVersionRequestId = requestId;
    wx.showLoading({ title: '版本加载中', mask: false });
    return loadCloudCountryFormVersions(country.cloudDirectory).then((versions) => {
      replaceCountryCloudVersions(country.id, versions);
      this.runtimeVisaCatalog = visaCatalog;
      this.refreshCountries();
      if (this.data.selectedCountryId !== country.id || this._countryVersionRequestId !== requestId) {
        return false;
      }
      const selectedCountry = decorateCountry(
        visaCatalog.find((item) => item.id === country.id),
      );
      this.setData(getCountrySelection(selectedCountry));
      return true;
    }).catch((err) => {
      console.warn(`Load ${country.cloudDirectory} cloud versions failed, using local config`, err);
      if (this.data.selectedCountryId === country.id && this._countryVersionRequestId === requestId) {
        wx.showToast({ title: '云端版本读取失败，已使用本地配置', icon: 'none' });
      }
      return false;
    }).then((result) => {
      if (this._countryVersionRequestId === requestId) wx.hideLoading();
      return result;
    });
  },

  onShareAppMessage() {
    return getHomeShareMessage();
  },

  onSearch(e) {
    this.setData({
      query: e.detail.value || '',
      ...getCountrySelection(null),
    });
    this.refreshCountries();
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
      searchGuideCountryName: '',
    });
    this.refreshCountries();
  },

  selectCountry(e) {
    const source = this.runtimeVisaCatalog || [];
    const country = decorateCountry(source.find((item) => item.id === e.currentTarget.dataset.id));
    this.setData({
      ...getCountrySelection(country),
    });
    if (country) this.refreshCloudVersions(country.id);
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
    const rawQuery = this.data.query.trim();
    const query = rawQuery.toLowerCase();
    const {selectedContinent} = this.data;
    const source = this.runtimeVisaCatalog || [];
    const availableContinents = getAvailableContinents(source);
    const countries = source.filter((country) => {
      if (!countryHasPdfVersion(country)) return false;
      if (query) return countryMatchesQuery(country, query);
      const hitContinent = selectedContinent === HOT_FILTER
        ? country.hot
        : country.continent === selectedContinent;
      return hitContinent;
    }).map(decorateCountry);
    this.setData({
      continents: availableContinents,
      destinationFilters: [HOT_FILTER, ...availableContinents],
      countries,
      searchGuideCountryName: query && !countries.length ? rawQuery : '',
    });
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
