const cloud = require('wx-server-sdk');
const {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  TextAlignment,
} = require('pdf-lib');
const { getPdfTemplate } = require('./templateAssets');
const { layoutText, measureNotoSansSCText } = require('./textLayout');
const { loadGlyphFont, measureText, drawLayoutInBox } = require('./vectorText');

function needsUnicodeAppearanceFont(values) {
  return Object.values(values || {}).some((value) => (
    value !== undefined
    && value !== null
    && /[^\u0000-\u00ff]/.test(String(value))
  ));
}

function sanitizeFileName(value) {
  return String(value || 'visa-form')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'visa-form';
}

function isChecked(value) {
  return value === true || value === 'true' || value === '1' || value === 1 || value === 'yes' || value === 'on';
}

function isBooleanChoiceValue(value) {
  return typeof value === 'boolean'
    || value === 0
    || value === 1
    || ['true', 'false', '0', '1', 'yes', 'no', 'on', 'off'].includes(String(value).toLowerCase());
}

function fillNonTextField(field, value, font) {
  if (value === undefined || value === null || value === '') return;
  const text = String(value);

  if (field instanceof PDFCheckBox) {
    const checked = isChecked(value);
    if (checked) field.check();
    else field.uncheck();
    // 导出时关闭了全表单的自动外观更新，以免覆盖模板原有样式。
    // 部分模板的复选框没有 /AP，第一次 check() 只能写入 /V，无法同步控件
    // 的 /AS。先补齐可见外观，再次 check/uncheck 才能把 /AS 指向正确状态。
    if (checked || field.needsAppearancesUpdate()) {
      field.updateAppearances();
      if (checked) field.check();
      else field.uncheck();
    }
    return true;
  }

  if (field instanceof PDFRadioGroup) {
    // 部分 XFA 转换后的 PDF 会把每个按钮保留为只有一个选项的 RadioGroup，
    // 而小程序 schema 仍将其作为独立布尔按钮。此时不能 select('true')，
    // 应选择该组唯一的导出值；false 则清空。
    if (isBooleanChoiceValue(value)) {
      if (isChecked(value)) {
        const options = field.getOptions();
        if (!options.length) return false;
        field.select(options[0]);
      } else {
        field.clear();
      }
      return true;
    }
    field.select(text);
    return true;
  }

  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    field.select(text);
    field.updateAppearances(font);
    return true;
  }

  return false;
}

function forceFieldAppearances(field, font) {
  if (field instanceof PDFTextField
    || field instanceof PDFDropdown
    || field instanceof PDFOptionList
    || field instanceof PDFButton) {
    field.updateAppearances(font);
    return true;
  }
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
    field.updateAppearances();
    return true;
  }
  return false;
}

function createBlankWidgetAppearance(form, widget) {
  const context = form.doc.context;
  const rectangle = widget.getRectangle();
  const stream = context.formXObject([], {
    BBox: context.obj([
      0,
      0,
      Math.abs(Number(rectangle.width) || 0),
      Math.abs(Number(rectangle.height) || 0),
    ]),
    Resources: context.obj({}),
  });
  return context.register(stream);
}

function ensureFlattenableWidgetAppearances(form, font) {
  const failures = [];
  const blankedWidgets = [];
  const refreshedFields = [];

  form.getFields().forEach((field) => {
    const widgets = field.acroField.getWidgets();
    const requiresRepair = widgets.some((widget) => {
      try {
        form.findWidgetAppearanceRef(field, widget);
        return false;
      } catch (err) {
        return true;
      }
    });

    if (requiresRepair) {
      try {
        // PDFForm.updateFieldAppearances() 仅处理 dirty 字段。部分 XFA 转换
        // 模板虽然已有 /AP，但 /AP/N 缺失，因此必须强制重建。
        if (forceFieldAppearances(field, font)) refreshedFields.push(field.getName());
      } catch (err) {
        failures.push({ field: field.getName(), message: err.message || String(err) });
      }
    }

    widgets.forEach((widget, widgetIndex) => {
      try {
        // 直接复用 pdf-lib flatten() 的预检逻辑，同时覆盖普通
        // stream 和 checkbox/radio 的 on/off appearance dictionary。
        form.findWidgetAppearanceRef(field, widget);
      } catch (err) {
        widget.setNormalAppearance(createBlankWidgetAppearance(form, widget));
        blankedWidgets.push({
          field: field.getName(),
          widgetIndex,
          message: err.message || String(err),
        });
      }
    });
  });

  return { failures, blankedWidgets, refreshedFields };
}

function flattenForm(form, font) {
  const repair = ensureFlattenableWidgetAppearances(form, font);
  form.flatten({ updateFieldAppearances: false });
  return repair;
}

function collectAcroformDefinitions(schema) {
  const definitions = {};
  const seen = new Set();

  function visit(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value) && value.name && value.field_type) {
      definitions[value.name] = { ...definitions[value.name], ...value };
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    Object.keys(value).forEach((key) => visit(value[key]));
  }

  visit(schema);
  return definitions;
}

// 与小程序 assignUniqueFieldIds 保持同一规则。表单为了避免重复的 field_name
// 作为组件 key，会把部分字段保存成 acroform_<hash>；旧客户端或旧草稿可能未附带
// acroformFieldMap，因此云端也必须能从同版本 schema 反推出 PDF 原始 name。
function buildSchemaFieldMap(schema) {
  const fields = [];
  ((schema && schema.pages) || []).forEach((page) => {
    (page.leaf_nodes || []).forEach((leaf) => {
      (leaf.acroforms || []).forEach((field) => {
        if (!field || field.is_acro_need_filled === false) return;
        fields.push({
          name: String(field.name || ''),
          fieldName: String(field.field_name || '').trim(),
          page: leaf.page || 0,
          leafId: leaf.leaf_id || '',
          rect: field.rect || [],
        });
      });
    });
  });

  const nameCounts = {};
  const fieldNameCounts = {};
  fields.forEach((field) => {
    nameCounts[field.name] = (nameCounts[field.name] || 0) + 1;
    if (field.fieldName) {
      fieldNameCounts[field.fieldName] = (fieldNameCounts[field.fieldName] || 0) + 1;
    }
  });

  const fieldMap = {};
  const usedIds = new Set();
  fields.forEach((field) => {
    const hasDuplicateName = nameCounts[field.name] > 1;
    const hasDuplicateFieldName = field.fieldName && fieldNameCounts[field.fieldName] > 1;
    if (field.name && !hasDuplicateName && !hasDuplicateFieldName && !usedIds.has(field.name)) {
      fieldMap[field.name] = field.name;
      usedIds.add(field.name);
      return;
    }

    const identity = JSON.stringify([
      field.name,
      field.page,
      field.leafId,
      field.rect,
    ]);
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index += 1) {
      hash ^= identity.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const base = `acroform_${(hash >>> 0).toString(36)}`;
    let id = base;
    let suffix = 1;
    while (usedIds.has(id) || nameCounts[id]) {
      suffix += 1;
      id = `${base}_${suffix}`;
    }
    fieldMap[id] = field.name;
    usedIds.add(id);
  });
  return fieldMap;
}

function isMissingFormFieldError(err) {
  const message = String((err && err.message) || err || '');
  return /no (?:form )?field with (?:the )?name/i.test(message);
}

// 新模板的 PDF 字段名与 schema name 完全一致，优先走 exactNames。保留短名索引
// 仅用于兼容尚未按 canonical JSON 重建的旧 XFA 模板；它们可能带多层前缀，例如：
// topmostSubform[0].Page1[0].#area[10].textbox_0_0。
// 按最后一段建立唯一别名，避免为每个模板硬编码大段 fieldMap。
function buildFormFieldNameIndex(form) {
  const exactNames = new Set();
  const aliases = {};
  form.getFields().forEach((field) => {
    const name = field.getName();
    exactNames.add(name);
    const shortName = name.split('.').pop();
    if (!aliases[shortName]) aliases[shortName] = new Set();
    aliases[shortName].add(name);
  });
  return { exactNames, aliases };
}

function resolveFormFieldName(fieldName, fieldNameIndex) {
  // canonical PDF 即使存在同短名的旧层级字段，也必须优先选择精确名称。
  if (!fieldNameIndex || fieldNameIndex.exactNames.has(fieldName)) return fieldName;
  const candidates = fieldNameIndex.aliases[fieldName];
  return candidates && candidates.size === 1 ? Array.from(candidates)[0] : fieldName;
}

function createManualFormField({
  pdfDoc,
  form,
  name,
  definition,
  font,
  allowSchemaFallback = false,
}) {
  if (!definition || (definition.manual !== true && !allowSchemaFallback)) return null;

  const pageNumber = Number(definition.page);
  const rect = Array.isArray(definition.rect) ? definition.rect.map(Number) : [];
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDoc.getPageCount()) return null;
  if (rect.length < 4 || rect.some((value) => !Number.isFinite(value))) return null;

  const [x0, y0, x1, y1] = rect;
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;

  const page = pdfDoc.getPage(pageNumber - 1);
  const widgetOptions = {
    x: x0,
    y: y0,
    width,
    height,
    borderWidth: 0,
  };

  if (definition.field_type === '/Tx' || definition.field_type === '/Ch') {
    const field = form.createTextField(name);
    field.addToPage(page, { ...widgetOptions, font });
    return field;
  }

  if (definition.field_type === '/Btn') {
    const field = form.createCheckBox(name);
    field.addToPage(page, widgetOptions);
    return field;
  }

  return null;
}

async function loadTemplateFieldDefinitions(template) {
  if (!template.schemaFileID) return { definitions: {}, fieldMap: {} };
  try {
    const source = await cloud.downloadFile({ fileID: template.schemaFileID });
    const schemaText = Buffer.from(source.fileContent).toString('utf8').replace(/^\uFEFF/, '');
    const schema = JSON.parse(schemaText);
    return {
      definitions: collectAcroformDefinitions(schema),
      fieldMap: buildSchemaFieldMap(schema),
    };
  } catch (err) {
    console.warn('Load AcroForm layout schema failed, falling back to PDF widget geometry:', {
      schemaFileID: template.schemaFileID,
      message: err.message || String(err),
    });
    return { definitions: {}, fieldMap: {} };
  }
}

function widgetLayoutBox(field) {
  const widgets = field.acroField.getWidgets();
  if (!widgets.length) return { width: 0, height: 0, borderWidth: 0, widgets };
  let width = Infinity;
  let height = Infinity;
  let borderWidth = 0;

  widgets.forEach((widget) => {
    const rect = widget.getRectangle();
    const characteristics = widget.getAppearanceCharacteristics();
    const rotation = characteristics ? Number(characteristics.getRotation()) || 0 : 0;
    const quarterTurn = Math.abs(rotation % 180) === 90;
    width = Math.min(width, Math.abs(quarterTurn ? rect.height : rect.width));
    height = Math.min(height, Math.abs(quarterTurn ? rect.width : rect.height));
    const border = widget.getBorderStyle();
    borderWidth = Math.max(borderWidth, border ? Number(border.getWidth()) || 0 : 0);
  });

  return { width, height, borderWidth, widgets };
}

// 矢量绘制必须知道字段控件画在哪一页。优先用 widget 的 /P 页引用，
// 缺失时回退到遍历各页 Annots 定位（部分 XFA 转换模板不写 /P）。
function resolveWidgetPage(pdfDoc, widget) {
  const pages = pdfDoc.getPages();
  const pageRef = typeof widget.P === 'function' ? widget.P() : null;
  if (pageRef) {
    const byRef = pages.find((page) => page.ref === pageRef);
    if (byRef) return byRef;
  }
  const widgetDict = widget.dict;
  return pages.find((page) => {
    const annots = page.node.Annots && page.node.Annots();
    if (!annots) return false;
    return annots.asArray().some((ref) => pdfDoc.context.lookup(ref) === widgetDict);
  }) || null;
}

function alignmentName(alignment) {
  if (alignment === TextAlignment.Center) return 'center';
  if (alignment === TextAlignment.Right) return 'right';
  return 'left';
}

function defaultAppearanceFontSize(field, widgets) {
  const appearances = widgets
    .map((widget) => widget.getDefaultAppearance())
    .concat(field.acroField.getDefaultAppearance())
    .filter(Boolean);
  for (let index = 0; index < appearances.length; index += 1) {
    const pattern = /\/[^\s]+\s+([-+]?(?:\d+\.?\d*|\.\d+))\s+Tf/g;
    const appearance = String(appearances[index]);
    let match = pattern.exec(appearance);
    let lastSize;
    while (match) {
      lastSize = Number(match[1]);
      match = pattern.exec(appearance);
    }
    if (lastSize > 0) return lastSize;
  }
  return undefined;
}

function fillTextField({
  field, value, definition, glyphFont, pdfDoc,
}) {
  const text = String(value);
  const box = widgetLayoutBox(field);
  // 下拉框/列表没有 comb/maxLength/multiline 等文本框特有属性，按普通单行文本处理。
  const isTextField = field instanceof PDFTextField;
  const maxLength = isTextField ? field.getMaxLength() : undefined;
  const isCombed = isTextField ? field.isCombed() : false;
  if (isCombed && typeof maxLength === 'number' && text.length > maxLength) {
    return {
      overflow: true,
      reason: `字符数 ${text.length} 超过分格字段上限 ${maxLength}`,
      layout: null,
    };
  }
  if (isTextField && !isCombed && typeof maxLength === 'number' && text.length > maxLength) {
    field.removeMaxLength();
  }

  const padding = Math.max(Number(definition.padding) || 1, box.borderWidth + 1);
  const fieldDefinition = {
    ...definition,
    rect: [0, 0, box.width, box.height],
    font_size: definition.font_size || defaultAppearanceFontSize(field, box.widgets),
    text_alignment: definition.text_alignment
      || alignmentName(isTextField ? field.getAlignment() : undefined),
    padding,
    multiline: isTextField ? field.isMultiline() : false,
    combed: isCombed,
  };
  // 导出以 Noto Sans SC 的真实字形度量为准；无字体的旧测试调用
  // 则回退到同一字体的 advance width 表。小程序预览使用后者对齐。
  const layout = layoutText(text, fieldDefinition, {
    measureText: glyphFont
      ? (content, size) => measureText(glyphFont, content, size)
      : measureNotoSansSCText,
  });
  if (layout.overflow) {
    return {
      overflow: true,
      reason: `在最小字号 ${layout.fontSize}pt 下仍超出 ${box.width.toFixed(2)}×${box.height.toFixed(2)}pt`,
      layout,
    };
  }

  // 不再写入 AcroForm 外观/字体，改为把文字轮廓直接画到每个控件所在页的绝对
  // 矩形内。字段随后被扁平化移除，最终 PDF 上是纯矢量线条，任何阅读器（含微信
  // 内置阅读器）都能原样显示，且不含 CJK 字体，体积仅 KB 级。
  if (glyphFont && pdfDoc) {
    box.widgets.forEach((widget) => {
      const page = resolveWidgetPage(pdfDoc, widget);
      if (!page) return;
      drawLayoutInBox({
        page,
        rect: widget.getRectangle(),
        layout,
        font: glyphFont,
        padding,
      });
    });
  }

  return { overflow: false, layout };
}

function elapsed(start) {
  return `${Date.now() - start}ms`;
}

function moveLastPageToFront(pdfDoc) {
  const pageCount = pdfDoc.getPageCount();
  if (pageCount < 2) return false;

  const lastPage = pdfDoc.getPage(pageCount - 1);
  pdfDoc.removePage(pageCount - 1);
  pdfDoc.insertPage(0, lastPage);
  return true;
}

async function fillPdfAcroForm(event) {
  const startedAt = Date.now();
  const wxContext = cloud.getWXContext();
  const templateId = event.templateId || 'italy';
  const template = getPdfTemplate(templateId, event.templateAsset);
  if (!template) {
    return {
      success: false,
      errMsg: `Unsupported templateId: ${templateId}`,
    };
  }

  const values = event.values || {};
  const options = event.options || {};
  const downloadStartedAt = Date.now();
  const [source, templateSchema] = await Promise.all([
    cloud.downloadFile({ fileID: template.fileID }),
    loadTemplateFieldDefinitions(template),
  ]);
  const fieldDefinitions = templateSchema.definitions || {};
  const schemaFieldMap = templateSchema.fieldMap || {};
  const loadStartedAt = Date.now();
  const pdfDoc = await PDFDocument.load(source.fileContent);
  // fontkit 字体仅运行时用于取字形轮廓，不嵌入 PDF；复选框等标准符号仍用内置字体。
  const glyphFont = loadGlyphFont();
  const symbolFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fillStartedAt = Date.now();
  const form = pdfDoc.getForm();
  const fieldNameIndex = buildFormFieldNameIndex(form);
  const missingFields = [];
  const failedFields = [];
  const skippedFields = [];
  const filledFields = [];
  const checkedFields = [];
  const createdFields = [];
  const unsupportedFields = [];
  const overflowFields = [];
  const textLayouts = {};
  const attemptedFields = [];
  const resolvedFieldNames = {};

  Object.keys(values).forEach((fieldName) => {
    if (values[fieldName] === undefined || values[fieldName] === null || values[fieldName] === '') {
      skippedFields.push(fieldName);
      return;
    }
    const mappedFieldName = template.fieldMap[fieldName] || schemaFieldMap[fieldName] || fieldName;
    const pdfFieldName = resolveFormFieldName(mappedFieldName, fieldNameIndex);
    const definition = fieldDefinitions[mappedFieldName] || fieldDefinitions[fieldName] || {};
    // 手写/签字栏必须保持空白；即使旧草稿或异常请求仍带了值，也不写入 PDF。
    if (definition.is_acro_handwritting === true) {
      skippedFields.push(fieldName);
      return;
    }
    attemptedFields.push(mappedFieldName);
    if (pdfFieldName !== mappedFieldName) resolvedFieldNames[mappedFieldName] = pdfFieldName;
    try {
      let field;
      try {
        field = form.getField(pdfFieldName);
      } catch (err) {
        if (!isMissingFormFieldError(err)) throw err;
        field = createManualFormField({
          pdfDoc,
          form,
          name: pdfFieldName,
          definition,
          font: symbolFont,
          // 云存储中的部分 XFA PDF 会在运行时丢失字段树。只在同版本 schema
          // 明确包含该字段及有效几何信息时，按标注坐标重建，避免任意请求创建字段。
          allowSchemaFallback: definition.name === mappedFieldName,
        });
        if (!field) {
          missingFields.push(pdfFieldName);
          return;
        }
        createdFields.push(pdfFieldName);
      }
      // 文本框、下拉框、列表的选中值都可能含中文，统一走矢量绘制。
      const rendersAsText = field instanceof PDFTextField
        || field instanceof PDFDropdown
        || field instanceof PDFOptionList;
      if (rendersAsText) {
        const result = fillTextField({
          field,
          value: values[fieldName],
          definition,
          glyphFont,
          pdfDoc,
        });
        if (result.overflow) {
          overflowFields.push({
            field: pdfFieldName,
            label: definition.field_name || pdfFieldName,
            reason: result.reason,
          });
        } else {
          filledFields.push(pdfFieldName);
          textLayouts[pdfFieldName] = {
            fontSize: result.layout.fontSize,
            lineCount: result.layout.lines.length,
            multiline: result.layout.multiline,
          };
        }
      } else if (fillNonTextField(field, values[fieldName], symbolFont)) {
        filledFields.push(pdfFieldName);
        if ((field instanceof PDFCheckBox || field instanceof PDFRadioGroup)
          && isChecked(values[fieldName])) {
          checkedFields.push(pdfFieldName);
        }
      } else {
        unsupportedFields.push(pdfFieldName);
      }
    } catch (err) {
      if (isMissingFormFieldError(err)) {
        missingFields.push(pdfFieldName);
      } else {
        failedFields.push({ field: pdfFieldName, message: err.message || String(err) });
      }
    }
  });

  console.log('fillPdfAcroForm summary:', {
    templateId,
    inputCount: Object.keys(values).length,
    filledCount: filledFields.length,
    checkedCount: checkedFields.length,
    createdCount: createdFields.length,
    skippedCount: skippedFields.length,
    missingCount: missingFields.length,
    failedCount: failedFields.length,
    unsupportedCount: unsupportedFields.length,
    overflowCount: overflowFields.length,
    sampleMissingFields: missingFields.slice(0, 20),
    sampleCheckedFields: checkedFields.slice(0, 20),
    sampleCreatedFields: createdFields.slice(0, 20),
    sampleFailedFields: failedFields.slice(0, 10),
    sampleUnsupportedFields: unsupportedFields.slice(0, 20),
    sampleOverflowFields: overflowFields.slice(0, 10),
    sampleResolvedFieldNames: Object.entries(resolvedFieldNames).slice(0, 20),
    recoveredSchemaFieldCount: Object.keys(schemaFieldMap).length,
    timing: {
      download: elapsed(downloadStartedAt),
      load: elapsed(loadStartedAt),
      fill: elapsed(fillStartedAt),
      totalSoFar: elapsed(startedAt),
    },
  });

  if (overflowFields.length) {
    return {
      success: false,
      errMsg: `${overflowFields.length} 个字段的内容无法完整放入 PDF 填写框，请缩短后重试。`,
      overflowFields,
      missingFields,
      failedFields,
      skippedFields,
      unsupportedFields,
    };
  }

  if (failedFields.length) {
    const firstFailure = failedFields[0];
    return {
      success: false,
      errMsg: `PDF 字段排版失败：${firstFailure.field}: ${firstFailure.message}`,
      overflowFields,
      missingFields,
      failedFields,
      skippedFields,
      unsupportedFields,
    };
  }

  // 允许用户导出尚未填写的空白/部分空白模板。只有请求中确实带了非空、
  // 非手写字段，却一个也没有命中 PDF 时，才判定为字段映射错误。
  if (!filledFields.length && attemptedFields.length) {
    const firstFailure = failedFields[0];
    const errMsg = firstFailure
      ? `No PDF AcroForm fields were filled. First failure: ${firstFailure.field}: ${firstFailure.message}`
      : 'No matching PDF AcroForm fields were filled. Check template fieldMap.';
    return {
      success: false,
      errMsg,
      missingFields,
      failedFields,
      skippedFields,
      unsupportedFields,
      overflowFields,
      resolvedFieldNames,
    };
  }

  // 文本已作为矢量轮廓画到页面内容层，控件本身不再承载可见外观，统一扁平化
  // 移除所有字段。这样最终 PDF 不含 CJK 字体、跨阅读器一致，也不会残留空控件。
  const flattened = true;
  const flattenRepair = flattenForm(form, symbolFont);

  const pageOrderAdjusted = options.a3PrintOrder === true
    ? moveLastPageToFront(pdfDoc)
    : false;

  const saveStartedAt = Date.now();
  const pdfBytes = await pdfDoc.save({
    updateFieldAppearances: false,
  });
  const title = sanitizeFileName(event.title || template.filename || 'visa-form');
  const cloudPath = [
    'generated_forms',
    wxContext.OPENID || 'anonymous',
    `${Date.now()}-${title.replace(/\.pdf$/i, '')}.pdf`,
  ].join('/');
  const uploadStartedAt = Date.now();
  const upload = await cloud.uploadFile({
    cloudPath,
    fileContent: Buffer.from(pdfBytes),
  });

  console.log('fillPdfAcroForm done:', {
    templateId,
    pdfBytes: pdfBytes.length,
    cloudPath,
    pageOrderAdjusted,
    flattened,
    flattenRepair: flattenRepair && {
      failedAppearanceUpdates: flattenRepair.failures.length,
      blankedWidgets: flattenRepair.blankedWidgets.length,
      refreshedFields: flattenRepair.refreshedFields.length,
      sampleFailures: flattenRepair.failures.slice(0, 10),
      sampleBlankedWidgets: flattenRepair.blankedWidgets.slice(0, 10),
      sampleRefreshedFields: flattenRepair.refreshedFields.slice(0, 20),
    },
    timing: {
      save: elapsed(saveStartedAt),
      upload: elapsed(uploadStartedAt),
      total: elapsed(startedAt),
    },
  });

  return {
    success: true,
    fileID: upload.fileID,
    cloudPath,
    pageOrderAdjusted,
    flattened,
    flattenRepair,
    filledFields,
    checkedFields,
    createdFields,
    missingFields,
    failedFields,
    skippedFields,
    unsupportedFields,
    overflowFields,
    textLayouts,
    resolvedFieldNames,
  };
}

module.exports = fillPdfAcroForm;
module.exports.__test = {
  collectAcroformDefinitions,
  buildSchemaFieldMap,
  createManualFormField,
  fillNonTextField,
  fillTextField,
  ensureFlattenableWidgetAppearances,
  flattenForm,
  buildFormFieldNameIndex,
  isChecked,
  isBooleanChoiceValue,
  isMissingFormFieldError,
  needsUnicodeAppearanceFont,
  resolveFormFieldName,
  resolveWidgetPage,
  widgetLayoutBox,
};
