const { countryFormFile } = require('./cloudAssets');

const visaCatalog = [
  {
    id: 'italy',
    name: '意大利',
    continent: '欧洲',
    hot: true,
    flag: '/static/country_flag/意大利-it.png',
    visaTypes: [
      {
        id: 'tourism',
        name: '短期旅游',
        districts: [
          {
            id: 'shanghai',
            name: '上海领区',
            versions: [
              {
                id: 'it-schengen-tourism-shanghai-demo',
                name: '申根短期签证申请表',
                version: '示范版',
                publishedAt: '2026-06-27',
                scope: '以上海领区示例 PDF 和 AcroForm 标注演示',
                status: 'active',
                sourcePdf: countryFormFile('Italy', 'schengen-Visa-application-form.pdf'),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'france',
    name: '法国',
    continent: '欧洲',
    hot: true,
    flag: '/static/country_flag/法国-fr.png',
    visaTypes: [
      {
        id: 'tourism',
        name: '短期旅游',
        districts: [
          {
            id: 'shanghai',
            name: '上海领区',
            versions: [
              {
                id: 'fr-schengen-tourism-2026-01',
                name: '申根短期签证申请表',
                version: '2026.01',
                publishedAt: '2026-01-10',
                scope: '上海、江苏、浙江、安徽',
                status: 'active',
                sourcePdf: countryFormFile('France', 'france_schengen_2026.pdf'),
              },
            ],
          },
          {
            id: 'beijing',
            name: '北京领区',
            versions: [
              {
                id: 'fr-schengen-tourism-2025-12',
                name: '申根短期签证申请表',
                version: '2025.12',
                publishedAt: '2025-12-18',
                scope: '北京、天津、河北、山东、山西、内蒙古',
                status: 'active',
                sourcePdf: countryFormFile('France', 'france_schengen_2025.pdf'),
              },
            ],
          },
        ],
      },
      {
        id: 'business',
        name: '商务',
        districts: [
          {
            id: 'shanghai',
            name: '上海领区',
            versions: [
              {
                id: 'fr-business-2026-01',
                name: '商务访问申请表',
                version: '2026.01',
                publishedAt: '2026-01-10',
                scope: '上海、江苏、浙江、安徽',
                status: 'active',
                sourcePdf: countryFormFile('France', 'france_business_2026.pdf'),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'germany',
    name: '德国',
    continent: '欧洲',
    hot: true,
    flag: '/static/country_flag/德国-de.png',
    visaTypes: [
      {
        id: 'tourism',
        name: '短期旅游',
        districts: [
          {
            id: 'shanghai',
            name: '上海领区',
            versions: [
              {
                id: 'de-schengen-tourism-2026-02',
                name: '申根短期签证申请表',
                version: '2026.02',
                publishedAt: '2026-02-04',
                scope: '上海、江苏、浙江、安徽',
                status: 'active',
                sourcePdf: countryFormFile('Germany', 'germany_schengen_2026.pdf'),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'japan',
    name: '日本',
    continent: '亚洲',
    hot: true,
    flag: '',
    visaTypes: [
      {
        id: 'tourism',
        name: '短期旅游',
        districts: [
          {
            id: 'shanghai',
            name: '上海领区',
            versions: [
              {
                id: 'jp-tourism-2026-01',
                name: '短期停留签证申请表',
                version: '2026.01',
                publishedAt: '2026-01-01',
                scope: '上海、江苏、浙江、安徽、江西',
                status: 'active',
                sourcePdf: countryFormFile('Japan', 'japan_tourism_2026.pdf'),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'usa',
    name: '美国',
    continent: '北美洲',
    hot: false,
    flag: '',
    visaTypes: [
      {
        id: 'business-tourism',
        name: '商务/旅游',
        districts: [
          {
            id: 'china',
            name: '中国大陆申请地',
            versions: [
              {
                id: 'us-ds160-demo',
                name: 'DS-160 信息采集表',
                version: '2026.01',
                publishedAt: '2026-01-15',
                scope: '中国大陆预约面谈',
                status: 'active',
                sourcePdf: countryFormFile('USA', 'us_ds160_demo.pdf'),
              },
            ],
          },
        ],
      },
    ],
  },
];

const pdfSchemas = {
  'fr-schengen-tourism-2026-01': {
    schema_version: '1.0',
    source_pdf: countryFormFile('France', 'france_schengen_2026.pdf'),
    generated_at: '2026-06-01T08:30:00Z',
    summary: {
      pages: 2,
      total_leaves: 12,
      total_acroforms: 14,
      leaves_with_ocr: 12,
      leaves_with_llm_fields: 12,
    },
    semantic_fields: {
      surname: {
        cn_name: '姓',
        en_name: 'Surname',
        required: true,
        output_format: '大写英文字母',
        example: 'ZHANG',
        help: '请严格按照护照个人资料页填写。系统导出时会自动转为大写。',
        max_length: 40,
        module: 'person',
      },
      given_names: {
        cn_name: '名',
        en_name: 'Given name(s)',
        required: true,
        output_format: '大写英文字母',
        example: 'SAN',
        help: '多个名字请按护照顺序填写，使用空格分隔。',
        max_length: 60,
        module: 'person',
      },
      birth_date: {
        cn_name: '出生日期',
        en_name: 'Date of birth',
        required: true,
        output_format: 'DD-MM-YYYY',
        example: '08-05-1992',
        help: '选择日期后系统会按 PDF 要求格式输出。',
        module: 'person',
      },
      nationality: {
        cn_name: '现国籍',
        en_name: 'Current nationality',
        required: true,
        output_format: '英文国家名',
        example: 'CHINA',
        help: '中国大陆护照通常填写 CHINA。',
        max_length: 40,
        module: 'person',
      },
      passport_no: {
        cn_name: '护照号码',
        en_name: 'Passport number',
        required: true,
        output_format: '大写字母和数字',
        example: 'E12345678',
        help: '请填写护照资料页右上方的护照号码。',
        max_length: 20,
        module: 'passport',
      },
      issue_date: {
        cn_name: '签发日期',
        en_name: 'Date of issue',
        required: true,
        output_format: 'DD-MM-YYYY',
        example: '12-06-2024',
        help: '按护照资料页签发日期填写。',
        module: 'passport',
      },
      expiry_date: {
        cn_name: '有效期至',
        en_name: 'Valid until',
        required: true,
        output_format: 'DD-MM-YYYY',
        example: '11-06-2034',
        help: '护照有效期通常需覆盖预计离境后至少 3 个月。',
        module: 'passport',
      },
      arrival_date: {
        cn_name: '预计入境日期',
        en_name: 'Intended date of arrival',
        required: true,
        output_format: 'DD-MM-YYYY',
        example: '01-10-2026',
        help: '与机票、酒店和行程单保持一致。',
        module: 'trip',
      },
      departure_date: {
        cn_name: '预计离境日期',
        en_name: 'Intended date of departure',
        required: true,
        output_format: 'DD-MM-YYYY',
        example: '12-10-2026',
        help: '离境日期不能早于入境日期。',
        module: 'trip',
      },
      hotel_address: {
        cn_name: '住宿地址',
        en_name: 'Hotel or temporary address',
        required: true,
        output_format: '英文地址',
        example: '10 RUE DE RIVOLI, PARIS',
        help: '填写首晚酒店或主要住宿地址。',
        max_length: 120,
        module: 'trip',
      },
      expense_self: {
        cn_name: '本人承担费用',
        en_name: 'Expenses covered by applicant',
        required: false,
        output_format: '勾选项',
        example: '已勾选',
        help: '如果由本人承担主要旅行费用，请勾选。',
        module: 'trip',
      },
      signature_place: {
        cn_name: '签名地点',
        en_name: 'Place and date',
        required: true,
        output_format: '英文城市名',
        example: 'SHANGHAI',
        help: '填写递交或签署申请表的城市。',
        max_length: 40,
        module: 'application',
      },
    },
    pages: [
      {
        page: 1,
        size: [595.32, 841.92],
        n_frames: 1,
        n_leaves: 8,
        n_acroforms: 9,
        trees: [],
        leaf_nodes: [
          {
            leaf_id: 'p001_l0001',
            path: [0],
            bbox: [28, 735, 566, 805],
            page: 1,
            is_leaf: true,
            text: '1. Surname',
            acroforms: ['surname'],
          },
          {
            leaf_id: 'p001_l0002',
            path: [1],
            bbox: [28, 670, 566, 734],
            page: 1,
            is_leaf: true,
            text: '2. Given name(s)',
            acroforms: ['given_names'],
          },
          {
            leaf_id: 'p001_l0003',
            path: [2],
            bbox: [28, 600, 290, 669],
            page: 1,
            is_leaf: true,
            text: '4. Date of birth',
            acroforms: ['birth_date'],
          },
          {
            leaf_id: 'p001_l0004',
            path: [3],
            bbox: [304, 600, 566, 669],
            page: 1,
            is_leaf: true,
            text: '6. Current nationality',
            acroforms: ['nationality'],
          },
          {
            leaf_id: 'p001_l0005',
            path: [4],
            bbox: [28, 510, 566, 590],
            page: 1,
            is_leaf: true,
            text: '13. Number of travel document',
            acroforms: ['passport_no'],
          },
        ],
        acroforms: [
          {
            name: 'surname',
            input_type: '姓名',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 740, 560, 768],
            page: 1,
            font_size: 10.5,
            text_alignment: 'left',
          },
          {
            name: 'given_names',
            input_type: '姓名',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 675, 560, 703],
            page: 1,
            font_size: 10.5,
            text_alignment: 'left',
          },
          {
            name: 'birth_date',
            input_type: '日期',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 620, 280, 648],
            page: 1,
            font_size: 10.5,
            text_alignment: 'center',
          },
          {
            name: 'nationality',
            input_type: '国家地区',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [310, 620, 560, 648],
            page: 1,
            font_size: 10.5,
            text_alignment: 'left',
          },
          {
            name: 'passport_no',
            input_type: '号码',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 535, 560, 563],
            page: 1,
            font_size: 10.5,
            text_alignment: 'left',
          },
        ],
      },
      {
        page: 2,
        size: [595.32, 841.92],
        n_frames: 1,
        n_leaves: 4,
        n_acroforms: 5,
        trees: [],
        leaf_nodes: [
          {
            leaf_id: 'p002_l0001',
            path: [0],
            bbox: [28, 700, 566, 780],
            page: 2,
            is_leaf: true,
            text: 'Travel dates',
            acroforms: ['arrival_date', 'departure_date'],
          },
          {
            leaf_id: 'p002_l0002',
            path: [1],
            bbox: [28, 610, 566, 699],
            page: 2,
            is_leaf: true,
            text: 'Address in Member State',
            acroforms: ['hotel_address'],
          },
        ],
        acroforms: [
          {
            name: 'issue_date',
            input_type: '日期',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 755, 280, 783],
            page: 2,
            font_size: 10.5,
            text_alignment: 'center',
          },
          {
            name: 'expiry_date',
            input_type: '日期',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [310, 755, 560, 783],
            page: 2,
            font_size: 10.5,
            text_alignment: 'center',
          },
          {
            name: 'arrival_date',
            input_type: '日期',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 704, 280, 732],
            page: 2,
            font_size: 10.5,
            text_alignment: 'center',
          },
          {
            name: 'departure_date',
            input_type: '日期',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [310, 704, 560, 732],
            page: 2,
            font_size: 10.5,
            text_alignment: 'center',
          },
          {
            name: 'hotel_address',
            input_type: '地址',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 636, 560, 678],
            page: 2,
            font_size: 9.5,
            text_alignment: 'left',
          },
          {
            name: 'expense_self',
            input_type: '勾选',
            field_type: '/Btn',
            value: '',
            default_value: '',
            rect: [32, 590, 48, 606],
            page: 2,
            font_size: 10.5,
            text_alignment: 'center',
          },
          {
            name: 'signature_place',
            input_type: '地区',
            field_type: '/Tx',
            value: '',
            default_value: '',
            rect: [32, 120, 280, 148],
            page: 2,
            font_size: 10.5,
            text_alignment: 'left',
          },
        ],
      },
    ],
  },
};

pdfSchemas['it-schengen-tourism-shanghai-demo'] = pdfSchemas['fr-schengen-tourism-2026-01'];
pdfSchemas['fr-schengen-tourism-2025-12'] = pdfSchemas['fr-schengen-tourism-2026-01'];
pdfSchemas['fr-business-2026-01'] = pdfSchemas['fr-schengen-tourism-2026-01'];
pdfSchemas['de-schengen-tourism-2026-02'] = pdfSchemas['fr-schengen-tourism-2026-01'];
pdfSchemas['jp-tourism-2026-01'] = pdfSchemas['fr-schengen-tourism-2026-01'];
pdfSchemas['us-ds160-demo'] = pdfSchemas['fr-schengen-tourism-2026-01'];

const continents = ['欧洲', '亚洲', '北美洲', '南美洲', '非洲', '大洋洲'];

function findCountry(countryId) {
  return visaCatalog.find((country) => country.id === countryId);
}

function findTemplate(templateId) {
  let result = null;
  visaCatalog.some((country) =>
    country.visaTypes.some((visaType) =>
      visaType.districts.some((district) =>
        district.versions.some((version) => {
          if (version.id === templateId) {
            result = { country, visaType, district, version };
            return true;
          }
          return false;
        }),
      ),
    ),
  );
  return result;
}

function getSchema(templateId) {
  return pdfSchemas[templateId] || pdfSchemas['it-schengen-tourism-shanghai-demo'];
}

function getAllTemplates() {
  const templates = [];
  visaCatalog.forEach((country) => {
    country.visaTypes.forEach((visaType) => {
      visaType.districts.forEach((district) => {
        district.versions.forEach((version) => {
          templates.push({ country, visaType, district, version });
        });
      });
    });
  });
  return templates;
}

module.exports = {
  continents,
  visaCatalog,
  findCountry,
  findTemplate,
  getSchema,
  getAllTemplates,
};
