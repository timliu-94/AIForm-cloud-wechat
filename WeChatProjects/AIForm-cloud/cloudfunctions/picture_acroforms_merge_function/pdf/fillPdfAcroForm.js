const cloud = require('wx-server-sdk');
const {
  PDFBool,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  TextAlignment,
} = require('pdf-lib');
const { getPdfTemplate } = require('./templateAssets');
const { layoutText, measureHelveticaText } = require('./textLayout');

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

  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
    field.select(text);
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      field.updateAppearances(font);
    }
    return true;
  }

  return false;
}

function disableNeedAppearances(form) {
  if (form.acroForm && form.acroForm.dict) {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.False);
    return;
  }
  const acroForm = form.doc && form.doc.catalog && form.doc.catalog.get(PDFName.of('AcroForm'));
  if (acroForm && typeof acroForm.set === 'function') {
    acroForm.set(PDFName.of('NeedAppearances'), PDFBool.False);
  }
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

function isMissingFormFieldError(err) {
  const message = String((err && err.message) || err || '');
  return /no (?:form )?field with (?:the )?name/i.test(message);
}

function createManualFormField({ pdfDoc, form, name, definition, font }) {
  if (!definition || definition.manual !== true) return null;

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

  if (definition.field_type === '/Tx') {
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
  if (!template.schemaFileID) return {};
  try {
    const source = await cloud.downloadFile({ fileID: template.schemaFileID });
    const schemaText = Buffer.from(source.fileContent).toString('utf8').replace(/^\uFEFF/, '');
    const schema = JSON.parse(schemaText);
    return collectAcroformDefinitions(schema);
  } catch (err) {
    console.warn('Load AcroForm layout schema failed, falling back to PDF widget geometry:', {
      schemaFileID: template.schemaFileID,
      message: err.message || String(err),
    });
    return {};
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

function setAppearanceFontSize(field, widgets, font, fontSize) {
  const replacement = `/${font.name} ${fontSize.toFixed(2)} Tf`;
  const replaceTf = (appearance) => {
    const current = String(appearance || '');
    if (/\/[^\s]+\s+[-+]?(?:\d+\.?\d*|\.\d+)\s+Tf/.test(current)) {
      return current.replace(/\/[^\s]+\s+[-+]?(?:\d+\.?\d*|\.\d+)\s+Tf/g, replacement);
    }
    return `${current}\n0 g\n${replacement}`.trim();
  };

  field.acroField.setDefaultAppearance(replaceTf(field.acroField.getDefaultAppearance()));
  widgets.forEach((widget) => {
    widget.setDefaultAppearance(replaceTf(widget.getDefaultAppearance()));
  });
}

function applyTextAlignment(field, alignment) {
  if (alignment === 'center') field.setAlignment(TextAlignment.Center);
  else if (alignment === 'right') field.setAlignment(TextAlignment.Right);
  else field.setAlignment(TextAlignment.Left);
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

function fillTextField({ field, value, definition, font, form }) {
  const text = String(value);
  const box = widgetLayoutBox(field);
  const maxLength = field.getMaxLength();
  const isCombed = field.isCombed();
  if (isCombed && typeof maxLength === 'number' && text.length > maxLength) {
    return {
      overflow: true,
      reason: `字符数 ${text.length} 超过分格字段上限 ${maxLength}`,
      layout: null,
    };
  }
  if (!isCombed && typeof maxLength === 'number' && text.length > maxLength) {
    field.removeMaxLength();
  }

  const fieldDefinition = {
    ...definition,
    rect: [0, 0, box.width, box.height],
    font_size: definition.font_size || defaultAppearanceFontSize(field, box.widgets),
    text_alignment: definition.text_alignment || alignmentName(field.getAlignment()),
    padding: Math.max(Number(definition.padding) || 1, box.borderWidth + 1),
    multiline: field.isMultiline(),
    combed: isCombed,
  };
  const layout = layoutText(text, fieldDefinition, {
    measureText: measureHelveticaText,
  });
  if (layout.overflow) {
    return {
      overflow: true,
      reason: `在最小字号 ${layout.fontSize}pt 下仍超出 ${box.width.toFixed(2)}×${box.height.toFixed(2)}pt`,
      layout,
    };
  }

  if (layout.mode === 'multiline') {
    field.disableCombing();
    field.enableMultiline();
  } else if (!isCombed) {
    field.disableMultiline();
  }
  applyTextAlignment(field, layout.alignment);
  setAppearanceFontSize(field, box.widgets, font, layout.fontSize);

  // /V 保留用户原文；仅 Appearance 使用插入换行后的视觉文本。
  const appearanceText = layout.multiline ? layout.lines.join('\n') : layout.lines[0];
  field.setText(appearanceText);
  field.updateAppearances(font);
  field.setText(text);
  form.markFieldAsClean(field.ref);

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
  const [source, fieldDefinitions] = await Promise.all([
    cloud.downloadFile({ fileID: template.fileID }),
    loadTemplateFieldDefinitions(template),
  ]);
  const loadStartedAt = Date.now();
  const pdfDoc = await PDFDocument.load(source.fileContent);
  const appearanceFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fillStartedAt = Date.now();
  const form = pdfDoc.getForm();
  const missingFields = [];
  const failedFields = [];
  const skippedFields = [];
  const filledFields = [];
  const checkedFields = [];
  const createdFields = [];
  const unsupportedFields = [];
  const overflowFields = [];
  const textLayouts = {};

  Object.keys(values).forEach((fieldName) => {
    if (values[fieldName] === undefined || values[fieldName] === null || values[fieldName] === '') {
      skippedFields.push(fieldName);
      return;
    }
    const pdfFieldName = template.fieldMap[fieldName] || fieldName;
    const definition = fieldDefinitions[pdfFieldName] || fieldDefinitions[fieldName] || {};
    // 手写/签字栏必须保持空白；即使旧草稿或异常请求仍带了值，也不写入 PDF。
    if (definition.is_acro_handwritting === true) {
      skippedFields.push(fieldName);
      return;
    }
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
          font: appearanceFont,
        });
        if (!field) {
          missingFields.push(pdfFieldName);
          return;
        }
        createdFields.push(pdfFieldName);
      }
      if (field instanceof PDFTextField) {
        const result = fillTextField({
          field,
          value: values[fieldName],
          definition,
          font: appearanceFont,
          form,
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
      } else if (fillNonTextField(field, values[fieldName], appearanceFont)) {
        filledFields.push(pdfFieldName);
        if (field instanceof PDFCheckBox && isChecked(values[fieldName])) {
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

  if (!filledFields.length) {
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
    };
  }

  if (options.flatten === true) {
    form.flatten({ updateFieldAppearances: false });
  }
  disableNeedAppearances(form);

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
    filledFields,
    checkedFields,
    createdFields,
    missingFields,
    failedFields,
    skippedFields,
    unsupportedFields,
    overflowFields,
    textLayouts,
  };
}

module.exports = fillPdfAcroForm;
module.exports.__test = {
  collectAcroformDefinitions,
  createManualFormField,
  fillNonTextField,
  fillTextField,
  isChecked,
  isMissingFormFieldError,
  widgetLayoutBox,
};
