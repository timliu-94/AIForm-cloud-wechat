const {
  continents,
  visaCatalog,
} = require('../../utils/visaData');
const { listCountryFormVersions, openCloudPdf } = require('../../utils/countryFormCatalog');

const HOT_FILTER = '热门';
const OFFICIAL_WEB_MODE = 'official_web';

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

function replaceCountryVersions(catalog, catalogCountry, cloudVersions) {
  if (!cloudVersions.length) return catalog;
  const visaTypeIds = catalogCountry.cloudCatalog.visaTypeIds
    || [catalogCountry.cloudCatalog.visaTypeId];
  return catalog.map((country) => {
    if (country.id !== catalogCountry.id) return country;
    return {
      ...country,
      visaTypes: country.visaTypes.map((visaType) => ({
        ...visaType,
        districts: visaType.districts.map((district) => (
          visaTypeIds.indexOf(visaType.id) >= 0
            && district.id === catalogCountry.cloudCatalog.districtId
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
    searchGuideCountryName: '',
    catalogLoading: false,
    catalogError: '',
  },

  onLoad() {
    this.runtimeVisaCatalog = visaCatalog;
    this.refreshCountries();
    this.loadCountryFormCatalog();
  },

  onPullDownRefresh() {
    this.loadCountryFormCatalog({ force: true }).then(() => wx.stopPullDownRefresh());
  },

  loadCountryFormCatalog(options = {}) {
    this.setData({ catalogLoading: true, catalogError: '' });
    const catalogCountries = visaCatalog.filter((country) => country.cloudCatalog);
    const requests = catalogCountries.map((country) => (
      listCountryFormVersions(country.cloudCatalog.country, options)
        .then((versions) => ({ country, versions, error: null }))
        .catch((error) => ({ country, versions: [], error }))
    ));
    return Promise.all(requests)
      .then((results) => {
        this.runtimeVisaCatalog = results.reduce((catalog, result) => (
          replaceCountryVersions(catalog, result.country, result.versions)
        ), visaCatalog);
        this.refreshCountries();
        const failures = results.filter((result) => result.error);
        this.setData({
          catalogLoading: false,
          catalogError: failures.map((result) => (
            `${result.country.name}：${result.error.message || String(result.error)}`
          )).join('\n'),
        });
      })
      .catch((err) => {
        console.error('Load country form catalog failed:', err);
        this.setData({
          catalogLoading: false,
          catalogError: err.message || String(err),
        });
      });
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
    const rawQuery = this.data.query.trim();
    const query = rawQuery.toLowerCase();
    const {selectedContinent} = this.data;
    const source = this.runtimeVisaCatalog || visaCatalog;
    const selectableCountries = source.filter(
      (country) => country.applicationMode !== OFFICIAL_WEB_MODE,
    );
    const countries = selectableCountries.filter((country) => {
      if (query) return countryMatchesQuery(country, query);
      const hitContinent = selectedContinent === HOT_FILTER
        ? country.hot
        : country.continent === selectedContinent;
      return hitContinent;
    }).map(decorateCountry);
    const officialWebCountry = query && !countries.length
      ? source.find((country) => (
        country.applicationMode === OFFICIAL_WEB_MODE
        && countryMatchesQuery(country, query)
      ))
      : null;
    this.setData({
      countries,
      searchGuideCountryName: query && !countries.length
        ? ((officialWebCountry && officialWebCountry.name) || rawQuery)
        : '',
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
