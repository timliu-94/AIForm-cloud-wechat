// 意大利申根签证表单数据层。
// 把抽取出来的 acroforms schema（叶子节点 + 其包含的 acroform 字段）转换成
// 小程序表单/预览所需的视图模型。核心约束：按 JSON 叶子节点顺序展示，每个叶子
// 是一个不可分割的文字块，里面的若干 acroforms 以「包含」关系嵌套在该文字块下。
const {
  getCountryConfigByCloudDirectory,
  getPreviewImage,
  getTemplateAsset,
  getTemplateConfig,
  loadTemplateSchema,
} = require('../config/countryConfig');
const { countryFormSchemaAsset, downloadCloudJSON } = require('./cloudAssets');
const { findCachedCountryFormVersion } = require('./countryFormCatalog');
const { buildScaledTextStyle, layoutText } = require('./textLayout');

const TEMPLATE_ID = 'it-schengen-tourism-shanghai-demo';
const COUNTRY_NAME = '意大利';
const FORM_TITLE = '意大利申根签证申请表';
const FULL_PREVIEW_CANVAS_RPX = 702;

// 新版标注（Italy_acroforms_new.json）已自带语义信息，无需再做
// OCR 配对 / 标签覆盖 / 示范映射 / 幽灵字段表：
//   - 叶子节点 is_need_filled：标注该文字块是否需要用户填写。为 false 时不渲染录入控件、
//     不计入进度、不写回值，但仍保留文字块与预览位置提示。
//   - 叶子节点 is_handwritting：标注该文字块需手写。它会出现在表单里提示用户手写，
//     不计入进度，但仍保留对应 acroform 的图片预览位置提示。
//   - acroform is_acro_need_filled：标注该 PDF 字段是否需要用户填写。
//   - acroform is_acro_handwritting：标注该 PDF 字段需在打印后手写；字段级
//     标注优先于叶子节点，以支持同一文字块里同时存在在线填写和手写字段。
//   - acroform field_name：字段中文名（直接作为标签）。
//   - acroform field_example：填写示范（直接展示在输入框下方）。
//   - acroform input_type：语义类型，决定录入控件（日期/地址/电话/文本）。

// input_type 可能是字符串或数组（一个文本框对应多种可能含义），统一成可读文本。
function normalizeInputType(inputType) {
  if (Array.isArray(inputType)) return inputType.filter(Boolean).join(' / ');
  return inputType || '';
}

function hasType(inputType, keyword) {
  if (Array.isArray(inputType)) return inputType.some((t) => String(t).indexOf(keyword) >= 0);
  return String(inputType || '').indexOf(keyword) >= 0;
}

// 文本框根据语义类型挑选录入控件。
function pickComponent(inputType) {
  if (hasType(inputType, '日期')) return 'date';
  if (hasType(inputType, '电话')) return 'phone';
  if (hasType(inputType, '地址')) return 'textarea';
  return 'text';
}

// 标注里未给出语义字段名时，field_name 会回落成 acroform 自身的 name（如
// choicebutton_0_28）。这类无意义名字视作「无名」，由调用方给出兜底标签。
function semanticName(af) {
  const fn = af.field_name;
  return fn && fn !== af.name ? fn : '';
}

function isAcroFillable(af) {
  return af.is_acro_need_filled !== false;
}

// 与云端 fillPdfAcroForm.isChecked 保持一致，兼容旧草稿/分享数据中的字符串布尔值。
function isCheckedValue(value) {
  return value === true || value === 'true' || value === '1'
    || value === 1 || value === 'yes' || value === 'on';
}

// 每页可选校准（百分比偏移 + 纵向缩放）。当前 schema、预览图和
// commonforms PDF 来自同一版本，保持恒等换算；仅为旧版本素材保留校准入口。
const PAGE_CALIBRATION = {
  // 1: { dxPct: 0, dyPct: 0, scaleY: 1 },
};

// PDF 点坐标(左下角原点) → 渲染图百分比坐标(左上角原点)。
// 用百分比而非像素，可适配任意 DPI 的 PNG（这正是“PDF 转 PNG 后坐标会变”需要做的换算）。
function buildGeometry(rect, size, pageNo) {
  const [w, h] = size;
  const [x0, y0, x1, y1] = rect;
  const cal = PAGE_CALIBRATION[pageNo] || {};
  const dxPct = cal.dxPct || 0;
  const dyPct = cal.dyPct || 0;
  const scaleY = cal.scaleY || 1;
  const left = (x0 / w) * 100 + dxPct;
  const top = ((h - y1) / h) * 100 * scaleY + dyPct;
  const width = ((x1 - x0) / w) * 100;
  const height = ((y1 - y0) / h) * 100 * scaleY;
  return {
    pLeft: left,
    pTop: top,
    pWidth: width,
    pHeight: height,
    pCenterY: top + height / 2,
    previewStyle: [
      `left:${left.toFixed(2)}%`,
      `top:${top.toFixed(2)}%`,
      `width:${width.toFixed(2)}%`,
      `height:${height.toFixed(2)}%`,
    ].join(';'),
  };
}

// 把一个叶子节点（文字块）里的 acroforms 转成带标签的表单字段。
// 标签 / 示范 / 控件类型均直接取自新版标注（field_name / field_example / input_type）。
function buildLeafFields(leaf, size) {
  const ordered = (leaf.acroforms || []).filter(isAcroFillable);
  let btnIdx = 0;
  return ordered.map((af) => {
    const isBtn = af.field_type === '/Btn';
    const named = semanticName(af);
    let label = named;
    if (!label) {
      // 标注未给出字段名时的兜底：勾选框给「选项 N」，文本框给语义类型或「文本」。
      label = isBtn ? `选项 ${btnIdx + 1}` : (normalizeInputType(af.input_type) || '文本');
    }
    if (isBtn) btnIdx += 1;
    const geo = buildGeometry(af.rect, size, leaf.page);
    const component = isBtn ? 'checkbox' : pickComponent(af.input_type);
    // 填写示范：仅文本类字段取用（日期/勾选有各自的占位提示，不取示范）。
    const example = (!isBtn && component !== 'date') ? (af.field_example || '') : '';
    return {
      // id 在 buildForm 完成全量重名检查后赋值；name 是 schema 与重建后 PDF
      // 共同使用的 canonical AcroForm 名称，不再依赖原始 PDF/XFA 字段名。
      id: '',
      name: af.name,
      fieldName: af.field_name || '',
      leafId: leaf.leaf_id,
      page: leaf.page,
      fieldType: af.field_type,
      kind: isBtn ? 'checkbox' : 'text',
      // AcroForm 有显式布尔值时以字段级标注为准；旧 schema 缺失该属性时
      // 才继承叶子节点的手写设置。
      isHandwriting: typeof af.is_acro_handwritting === 'boolean'
        ? af.is_acro_handwritting
        : leaf.is_handwritting === true,
      component,
      example,
      label,
      // 复合 input_type（如「单选+文本」）作为类型标注会误导，仅在有明确字段名时展示。
      inputType: named ? normalizeInputType(af.input_type) : '',
      layoutInputType: af.input_type,
      fontSize: af.font_size,
      fontSizeMin: af.font_size_min,
      textAlignment: af.text_alignment,
      layoutMode: af.layout_mode,
      multiline: af.multiline || af.is_multiline,
      lineHeightRatio: af.line_height_ratio,
      padding: af.padding,
      rect: af.rect,
      ...geo,
    };
  });
}

// 页面状态不再直接把可重复的字段名当作组件 key。加载 JSON 后全量检查：
//   1. PDF AcroForm name 重复；
//   2. 用于前端展示的 field_name 重复。
// 命中任一情况就生成隐藏 ID。非重名项保持 id === name，以兼容已有草稿。
function assignUniqueFieldIds(pages) {
  const allFields = [];
  pages.forEach((page) => page.leaves.forEach((leaf) => {
    leaf.fields.forEach((field) => allFields.push(field));
  }));

  const nameCounts = {};
  const fieldNameCounts = {};
  allFields.forEach((field) => {
    const name = String(field.name || '');
    const fieldName = String(field.fieldName || '').trim();
    nameCounts[name] = (nameCounts[name] || 0) + 1;
    if (fieldName) fieldNameCounts[fieldName] = (fieldNameCounts[fieldName] || 0) + 1;
  });

  const usedIds = new Set();
  allFields.forEach((field) => {
    const name = String(field.name || '');
    const fieldName = String(field.fieldName || '').trim();
    const hasDuplicateName = nameCounts[name] > 1;
    const hasDuplicateFieldName = fieldName && fieldNameCounts[fieldName] > 1;
    if (name && !hasDuplicateName && !hasDuplicateFieldName && !usedIds.has(name)) {
      field.id = name;
      usedIds.add(name);
      return;
    }

    // ID 由 PDF 字段名、页码、叶子节点和坐标生成，不依赖数组顺序。
    // 这样 JSON 新增其他字段后，已有草稿的隐藏 ID 仍保持稳定。
    const identity = JSON.stringify([
      name,
      field.page || 0,
      field.leafId || '',
      field.rect || [],
    ]);
    let hash = 2166136261;
    for (let i = 0; i < identity.length; i += 1) {
      hash ^= identity.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const base = `acroform_${(hash >>> 0).toString(36)}`;
    let id = base;
    let suffix = 1;
    while (usedIds.has(id) || nameCounts[id]) {
      suffix += 1;
      id = `${base}_${suffix}`;
    }
    field.id = id;
    usedIds.add(id);
  });
}

function buildFieldPreviewLayout(field, value, pageWidth, renderedWidth, unit = 'px') {
  if (field.kind === 'checkbox') {
    return {
      lines: [value === true ? '✓' : ''],
      lineItems: [{ key: 0, text: value === true ? '✓' : '' }],
      multiline: false,
      overflow: false,
      valueStyle: '',
    };
  }
  const layout = layoutText(value, {
    ...field,
    inputType: field.layoutInputType || field.inputType,
  });
  const scale = Number(pageWidth) > 0 ? Number(renderedWidth) / Number(pageWidth) : 0;
  return {
    lines: layout.lines,
    lineItems: layout.lines.map((text, key) => ({ key, text })),
    multiline: layout.multiline,
    overflow: layout.overflow,
    valueStyle: buildScaledTextStyle(layout, scale, unit),
    fontSize: layout.fontSize,
    lineHeight: layout.lineHeight,
  };
}

// 为单页生成字段叠加层。“辅助填写”和完整 PDF 预览必须共用这份数据转换，
// 否则勾选框、手写字段或文字自适应规则变更后，两处预览会出现不同结果。
function buildPagePreviewFields(page, values, options = {}) {
  const out = [];
  const activeName = options.activeName || '';
  const renderedWidth = options.renderedWidth || FULL_PREVIEW_CANVAS_RPX;
  const unit = options.unit || 'px';
  const pageValues = values || {};

  page.leaves.forEach((leaf) => {
    if (leaf.skipFill) return;
    leaf.fields.forEach((field) => {
      const fieldId = field.id || field.name;
      const isCheckbox = field.kind === 'checkbox';
      if (field.isHandwriting || !leaf.needInput) {
        const textLayout = buildFieldPreviewLayout(
          { ...field, kind: 'text' },
          field.isHandwriting ? '需要手写' : leaf.manualText,
          page.width,
          renderedWidth,
          unit,
        );
        out.push({
          id: fieldId,
          name: field.name,
          leafId: field.leafId,
          label: field.label,
          isCheckbox: false,
          manual: true,
          skipFill: leaf.skipFill,
          isHandwriting: field.isHandwriting || leaf.isHandwriting,
          active: fieldId === activeName,
          display: field.isHandwriting ? '需要手写' : leaf.manualText,
          filled: false,
          style: field.previewStyle,
          ...textLayout,
        });
        return;
      }

      const raw = Object.prototype.hasOwnProperty.call(pageValues, fieldId)
        ? pageValues[fieldId]
        : pageValues[field.name];
      const filled = isCheckbox
        ? isCheckedValue(raw)
        : raw !== undefined && raw !== null && raw !== '';
      const display = isCheckbox ? (filled ? '✓' : '') : (filled ? String(raw) : '');
      const textLayout = buildFieldPreviewLayout(
        field,
        isCheckbox ? filled : display,
        page.width,
        renderedWidth,
        unit,
      );
      out.push({
        id: fieldId,
        name: field.name,
        leafId: field.leafId,
        label: field.label,
        isCheckbox,
        manual: false,
        active: fieldId === activeName,
        display,
        filled,
        style: field.previewStyle,
        ...textLayout,
      });
    });
  });
  return out;
}

function normalizeTemplateVersion(templateId, override) {
  const dynamic = override || findCachedCountryFormVersion(templateId);
  if (dynamic) return dynamic;
  const configured = getTemplateConfig(templateId);
  const template = configured ? configured.template : {};
  const previewImages = getTemplateAsset(templateId, 'previewImages') || {};
  return {
    id: templateId,
    country: template.country || 'Italy',
    versionDir: template.versionDir || '',
    pdfFilename: template.pdfFilename
      || (template.assets && template.assets.editableFilename)
      || '',
    version: template.version || '',
    name: FORM_TITLE,
    sourcePdf: getTemplateAsset(templateId, 'sourcePdf'),
    editablePdf: getTemplateAsset(templateId, 'editablePdf'),
    editableFilename: getTemplateAsset(templateId, 'editableFilename'),
    acroformSchema: getTemplateAsset(templateId, 'acroformSchema'),
    previewPattern: previewImages.pattern || '',
    previewPages: previewImages.pages || [],
  };
}

function getTemplatePreviewImage(templateId, templateVersion, page) {
  if (templateVersion && templateVersion.previewPattern) {
    return templateVersion.previewPattern.replace('{page}', page);
  }
  return getPreviewImage(templateId, page);
}

function buildForm(schema, templateId = TEMPLATE_ID, versionOverride) {
  if (!schema || !Array.isArray(schema.pages) || !schema.pages.length) {
    throw new Error('AcroForm JSON 缺少有效的 pages 数据');
  }
  const templateVersion = normalizeTemplateVersion(templateId, versionOverride);
  const pages = schema.pages.map((page) => {
    if (!Array.isArray(page.size) || page.size.length < 2 || !Array.isArray(page.leaf_nodes)) {
      throw new Error(`AcroForm JSON 第 ${page.page || '?'} 页结构无效`);
    }
    const leaves = page.leaf_nodes.map((leaf) => {
      const skipFill = leaf.is_need_filled === false;
      const isHandwriting = leaf.is_handwritting === true;
      const fields = buildLeafFields(leaf, page.size);
      const inputFields = skipFill ? [] : fields.filter((field) => !field.isHandwriting);
      const handwritingFields = skipFill ? [] : fields.filter((field) => field.isHandwriting);
      const needInput = inputFields.length > 0;
      return {
        leafId: leaf.leaf_id,
        page: leaf.page,
        text: leaf.text,
        lines: (leaf.text || '').split('\n'),
        skipFill,
        isHandwriting,
        hasHandwritingFields: handwritingFields.length > 0,
        needInput,
        manualFill: skipFill || (!needInput && handwritingFields.length > 0),
        manualText: isHandwriting ? '需要手写' : '无需填写',
        fieldCount: fields.length,
        inputFieldCount: inputFields.length,
        fields,
        inputFields,
        handwritingFields,
      };
    });
    return {
      page: page.page,
      width: page.size[0],
      height: page.size[1],
      previewImage: getTemplatePreviewImage(templateId, templateVersion, page.page),
      leaves,
    };
  });

  assignUniqueFieldIds(pages);

  // 全局字段表用于进度统计、初值、定位等，只包含需要线上录入的字段。
  const fields = [];
  pages.forEach((page) => page.leaves.forEach((leaf) => {
    leaf.inputFields.forEach((f) => fields.push(f));
  }));

  return {
    templateId,
    templateVersion,
    country: (
      getCountryConfigByCloudDirectory(templateVersion.country) || { name: COUNTRY_NAME }
    ).name,
    title: templateVersion.name || FORM_TITLE,
    summary: schema.summary,
    pages,
    fields,
    pageTabs: pages.map((p) => ({ page: p.page, label: `第 ${p.page} 页`, count: p.leaves.reduce((n, l) => n + l.inputFieldCount, 0) })),
  };
}

// 解析版本对应的 AcroForm schema 云路径：优先用版本自带的 acroformSchema；
// 缺失时按版本目录约定（country/versionDir/pdfFilename）推导，兼容不同版本文件夹。
function resolveSchemaFileID(templateVersion) {
  if (templateVersion.acroformSchema) return templateVersion.acroformSchema;
  return countryFormSchemaAsset(
    templateVersion.country,
    templateVersion.versionDir,
    templateVersion.pdfFilename || templateVersion.editableFilename,
  );
}

function loadForm(templateId = TEMPLATE_ID, versionOverride) {
  const templateVersion = normalizeTemplateVersion(templateId, versionOverride);
  const schemaFileID = resolveSchemaFileID(templateVersion);
  const schemaPromise = schemaFileID
    ? downloadCloudJSON(schemaFileID)
    : loadTemplateSchema(templateId);
  return schemaPromise.then((schema) => buildForm(schema, templateId, templateVersion));
}

// 依据已填写的值，为预览页生成每页的叠加层（把值放回 PDF 字段位置）。
function buildPreviewPages(form, values) {
  return form.pages.map((page) => ({
    page: page.page,
    width: page.width,
    height: page.height,
    previewImage: page.previewImage,
    overlays: buildPagePreviewFields(page, values, {
      renderedWidth: FULL_PREVIEW_CANVAS_RPX,
      unit: 'rpx',
    }),
  }));
}

module.exports = {
  TEMPLATE_ID,
  COUNTRY_NAME,
  FORM_TITLE,
  buildForm,
  buildFieldPreviewLayout,
  buildPagePreviewFields,
  buildPreviewPages,
  loadForm,
};
