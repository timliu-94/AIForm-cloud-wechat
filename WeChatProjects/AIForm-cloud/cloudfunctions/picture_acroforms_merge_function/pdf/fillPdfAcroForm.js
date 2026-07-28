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
} = require('pdf-lib');
const { getPdfTemplate } = require('./templateAssets');

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

function fillField(field, value) {
  if (value === undefined || value === null || value === '') return;
  const text = String(value);

  if (field instanceof PDFTextField) {
    const maxLength = field.getMaxLength();
    if (typeof maxLength === 'number' && maxLength < text.length) {
      field.removeMaxLength();
    }
    field.setText(text);
    return true;
  }

  if (field instanceof PDFCheckBox) {
    if (isChecked(value)) field.check();
    else field.uncheck();
    return true;
  }

  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
    field.select(text);
    return true;
  }

  return false;
}

function markNeedAppearances(form) {
  if (form.acroForm && form.acroForm.dict) {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
    return;
  }
  const acroForm = form.doc && form.doc.catalog && form.doc.catalog.get(PDFName.of('AcroForm'));
  if (acroForm && typeof acroForm.set === 'function') {
    acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }
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
  const source = await cloud.downloadFile({ fileID: template.fileID });
  const loadStartedAt = Date.now();
  const pdfDoc = await PDFDocument.load(source.fileContent);
  const fillStartedAt = Date.now();
  const form = pdfDoc.getForm();
  const missingFields = [];
  const failedFields = [];
  const skippedFields = [];
  const filledFields = [];
  const unsupportedFields = [];

  Object.keys(values).forEach((fieldName) => {
    if (values[fieldName] === undefined || values[fieldName] === null || values[fieldName] === '') {
      skippedFields.push(fieldName);
      return;
    }
    const pdfFieldName = template.fieldMap[fieldName] || fieldName;
    try {
      const field = form.getField(pdfFieldName);
      if (fillField(field, values[fieldName])) {
        filledFields.push(pdfFieldName);
      } else {
        unsupportedFields.push(pdfFieldName);
      }
    } catch (err) {
      if (/No field with name/.test(String(err && err.message))) {
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
    skippedCount: skippedFields.length,
    missingCount: missingFields.length,
    failedCount: failedFields.length,
    unsupportedCount: unsupportedFields.length,
    sampleMissingFields: missingFields.slice(0, 20),
    sampleFailedFields: failedFields.slice(0, 10),
    sampleUnsupportedFields: unsupportedFields.slice(0, 20),
    timing: {
      download: elapsed(downloadStartedAt),
      load: elapsed(loadStartedAt),
      fill: elapsed(fillStartedAt),
      totalSoFar: elapsed(startedAt),
    },
  });

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
    };
  }

  if (options.flatten === true) {
    form.flatten();
  } else if (options.updateAppearances === true) {
    form.updateFieldAppearances();
  } else {
    markNeedAppearances(form);
  }

  const pageOrderAdjusted = options.a3PrintOrder === true
    ? moveLastPageToFront(pdfDoc)
    : false;

  const saveStartedAt = Date.now();
  const pdfBytes = await pdfDoc.save({
    updateFieldAppearances: options.updateAppearances === true,
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
    missingFields,
    failedFields,
    skippedFields,
    unsupportedFields,
  };
}

module.exports = fillPdfAcroForm;
