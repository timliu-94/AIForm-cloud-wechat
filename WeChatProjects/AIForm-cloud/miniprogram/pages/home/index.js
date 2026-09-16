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
const NEXT_STEP_SCROLL_DURATION = 300;
const SCHENGEN_COUNTRY_IDS = new Set(['iceland', 'italy', 'spain', 'switzerland']);
const JAPAN_SHORT_STAY_HELP = '日本短期签证适用于旅游、短期商务、探亲访友等停留不超过90天的行程，原则上不得从事有报酬的活动。赴日工作、留学或停留超过90天，应选择相应的长期签证类型。具体申请类别请以日本驻华使领馆的最新要求为准。';
const SCHENGEN_SHORT_STAY_HELP = '短期申根签证适用于旅游、探亲访友、商务访问等短期行程，通常允许在任意连续180天内累计停留不超过90天。学习、工作或停留超过90天，一般需要申请相应的长期签证。具体适用类型和停留期限请以目的地国家领事机构的最新要求为准。';
const GENERIC_SHORT_STAY_HELP = '短期签证通常适用于旅游、探亲访友、商务访问等短期行程。不同国家对停留期限和可从事活动的规定有所不同，请先选择目的地，并以该国驻华使领馆发布的最新要求为准。';
const FORM_VERSION_HELP = '部分国家在中国大陆设有多个领事机构，不同领区适用的申请表版本可能有所不同。请根据该国的申请要求以及您常住地所属的领区，选择对应版本。若页面仅提供一个版本，表示当前无需按领区区分，直接选择该版本即可。';
const FORM_VERSION_NOTE = '领区划分和申请要求可能调整，提交材料前请以相关使领馆发布的最新信息为准。';

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
    stepHelpVisible: false,
    stepHelpTitle: '',
    stepHelpContent: '',
    stepHelpNote: '',
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
    }, () => {
      if (country) this.scrollToStep('#visa-type-step');
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
    }, () => this.scrollToStep('#form-version-step'));
  },

  scrollToStep(selector) {
    if (typeof wx === 'undefined' || typeof wx.pageScrollTo !== 'function') return;
    wx.nextTick(() => {
      wx.pageScrollTo({
        selector,
        duration: NEXT_STEP_SCROLL_DURATION,
      });
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

  openStepHelp(e) {
    const step = e.currentTarget.dataset.step;
    if (step === 'form-version') {
      this.setData({
        stepHelpVisible: true,
        stepHelpTitle: '如何选择申请表版本？',
        stepHelpContent: FORM_VERSION_HELP,
        stepHelpNote: FORM_VERSION_NOTE,
      });
      return;
    }
    const countryId = this.data.selectedCountryId;
    const content = countryId === 'japan'
      ? JAPAN_SHORT_STAY_HELP
      : (SCHENGEN_COUNTRY_IDS.has(countryId)
        ? SCHENGEN_SHORT_STAY_HELP
        : GENERIC_SHORT_STAY_HELP);
    this.setData({
      stepHelpVisible: true,
      stepHelpTitle: '什么是短期签证？',
      stepHelpContent: content,
      stepHelpNote: '',
    });
  },

  closeStepHelp() {
    this.setData({ stepHelpVisible: false });
  },

  preventBubble() {},

  preventTouchMove() {},

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
