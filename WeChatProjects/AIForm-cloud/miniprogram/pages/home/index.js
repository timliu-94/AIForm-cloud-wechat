const {
  continents,
  visaCatalog,
} = require('../../utils/visaData');
const {
  listCountryFormCountries,
  listCountryFormVersions,
  openCloudPdf,
} = require('../../utils/countryFormCatalog');

const HOT_FILTER = '热门';
const OTHER_CONTINENT = '其他';

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

function buildGenericCloudCountry(directory) {
  return {
    id: `cloud-country:${directory}`,
    name: directory,
    cloudDirectory: directory,
    iso2: '',
    continent: OTHER_CONTINENT,
    hot: true,
    applicationMode: 'form_assist',
    searchAliases: [directory],
    cloudCatalog: {
      country: directory,
      visaTypeId: 'application',
      districtId: 'default',
    },
    flag: '',
    visaTypes: [{
      id: 'application',
      name: '签证申请表',
      districts: [{
        id: 'default',
        name: '通用',
        versions: [],
      }],
    }],
  };
}

function buildCatalogFromCloudDirectories(catalog, cloudDirectories) {
  const configuredByDirectory = {};
  catalog.forEach((country) => {
    if (country.cloudDirectory) configuredByDirectory[country.cloudDirectory] = country;
  });
  return (cloudDirectories || []).map((directory) => {
    const configured = configuredByDirectory[directory];
    if (!configured) return buildGenericCloudCountry(directory);
    const generic = buildGenericCloudCountry(directory);
    return {
      ...generic,
      ...configured,
      // 目录存在即表示该国家在首页可选；旧的官网填表标记不再覆盖云端配置。
      applicationMode: 'form_assist',
      cloudCatalog: configured.cloudCatalog
        || (configured.visaTypes.length ? null : generic.cloudCatalog),
      visaTypes: configured.visaTypes.length ? configured.visaTypes : generic.visaTypes,
    };
  });
}

// 对于配置了 cloudCatalog 的国家，云存储目录才是唯一可信来源：无论云端返回
// 多少版本（含空数组），都用它覆盖本地静态占位（示范版）版本，避免在加载完成后
// 仍向用户展示本不该出现的演示 PDF。
function replaceCountryVersions(catalog, catalogCountry, cloudVersions) {
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
    destinationFilters: [HOT_FILTER, ...continents, OTHER_CONTINENT],
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
    catalogInitialized: false,
    catalogError: '',
  },

  onLoad() {
    this.runtimeVisaCatalog = [];
    this.refreshCountries();
    this.loadCountryFormCatalog();
  },

  onPullDownRefresh() {
    this.loadCountryFormCatalog({ force: true }).then(() => wx.stopPullDownRefresh());
  },

  loadCountryFormCatalog(options = {}) {
    this.setData({ catalogLoading: true, catalogError: '' });
    return listCountryFormCountries(options)
      .then((cloudDirectories) => {
        const supportedCatalog = buildCatalogFromCloudDirectories(visaCatalog, cloudDirectories);
        const catalogCountries = supportedCatalog.filter((country) => country.cloudCatalog);
        const requests = catalogCountries.map((country) => (
          listCountryFormVersions(country.cloudCatalog.country, options)
            .then((versions) => ({ country, versions, error: null }))
            .catch((error) => ({ country, versions: [], error }))
        ));
        return Promise.all(requests).then((results) => ({ supportedCatalog, results }));
      })
      .then(({ supportedCatalog, results }) => {
        this.runtimeVisaCatalog = results.reduce((catalog, result) => (
          replaceCountryVersions(catalog, result.country, result.versions)
        ), supportedCatalog);
        const failures = results.filter((result) => result.error);
        return new Promise((resolve) => {
          this.setData({
            catalogLoading: false,
            catalogInitialized: true,
            catalogError: failures.map((result) => (
              `${result.country.name}：${result.error.message || String(result.error)}`
            )).join('\n'),
          }, () => {
            this.refreshCountries();
            this.resyncSelection();
            resolve();
          });
        });
      })
      .catch((err) => {
        console.error('Load country form catalog failed:', err);
        this.runtimeVisaCatalog = [];
        return new Promise((resolve) => {
          this.setData({
            catalogLoading: false,
            catalogInitialized: true,
            catalogError: err.message || String(err),
          }, () => {
            this.refreshCountries();
            this.resyncSelection();
            resolve();
          });
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
    const source = this.runtimeVisaCatalog || [];
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
    const source = this.runtimeVisaCatalog || [];
    const countries = source.filter((country) => {
      if (query) return countryMatchesQuery(country, query);
      const hitContinent = selectedContinent === HOT_FILTER
        ? country.hot
        : country.continent === selectedContinent;
      return hitContinent;
    }).map(decorateCountry);
    this.setData({
      countries,
      searchGuideCountryName: query && !countries.length && this.data.catalogInitialized
        ? rawQuery
        : '',
    });
  },

  // 云目录加载完成后，若用户已经选中了某国家/签证类型，需要用最新的 runtimeVisaCatalog
  // 重新绑定选择项，把加载前拿到的占位版本替换成真实的云端版本；若原选中的版本已不存在，
  // 则清空第三步的选择，避免残留演示数据。
  resyncSelection() {
    const { selectedCountryId, selectedVisaTypeId, selectedVersionId } = this.data;
    if (!selectedCountryId) return;
    const source = this.runtimeVisaCatalog || [];
    const country = decorateCountry(source.find((item) => item.id === selectedCountryId));
    if (!country) {
      this.setData(getCountrySelection(null));
      return;
    }
    const selectedVisaType = selectedVisaTypeId
      ? country.visaTypes.find((item) => item.id === selectedVisaTypeId)
      : null;
    if (!selectedVisaType) {
      this.setData({ ...getCountrySelection(country) });
      return;
    }
    const selectedDistrict = selectedVisaType.districts[0];
    const selectedVersion = selectedVersionId
      ? selectedDistrict.versions.find((item) => item.id === selectedVersionId)
      : null;
    this.setData({
      selectedCountry: country,
      selectedVisaType,
      selectedVisaTypeId: selectedVisaType.id,
      selectedDistrict,
      selectedVersion: selectedVersion || null,
      selectedVersionId: selectedVersion ? selectedVersion.id : '',
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
