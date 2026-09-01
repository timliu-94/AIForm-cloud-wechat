const assert = require('assert');
const {
  PDFDocument,
  PDFName,
  PDFTextField,
  StandardFonts,
} = require('pdf-lib');
const clientLayout = require('../../../miniprogram/utils/textLayout');
const {
  buildForm,
  buildPagePreviewFields,
  buildPreviewPages,
} = require('../../../miniprogram/utils/italyForm');
const cloudLayout = require('../pdf/textLayout');
const fillPdfAcroForm = require('../pdf/fillPdfAcroForm');
const {
  buildAcroformValues,
  needsAcroformFieldMapRecovery,
} = require('../../../miniprogram/utils/pdfExport');
const zlib = require('zlib');

// 导出改为把文字画成矢量轮廓到页面内容层。测试通过解码页面内容流、统计
// 路径填充操作符（f / f*）来验证"确实画了矢量图形"，取代旧的 getText 断言。
function decodePageContent(pdfDoc, pageIndex) {
  const page = pdfDoc.getPage(pageIndex);
  const contentsRef = page.node.Contents();
  if (!contentsRef) return '';
  const streams = contentsRef.asArray ? contentsRef.asArray() : [contentsRef];
  return streams.map((ref) => {
    const stream = pdfDoc.context.lookup(ref);
    // 保存前是 PDFContentStream（操作符未编码），保存后重载是 PDFRawStream（可能 Flate 压缩）。
    if (typeof stream.getContentsString === 'function') return stream.getContentsString();
    const bytes = Buffer.from(stream.contents);
    try {
      return zlib.inflateSync(bytes).toString('latin1');
    } catch (err) {
      return bytes.toString('latin1');
    }
  }).join('\n');
}

function countFillOperators(content) {
  const matches = content.match(/(?:^|\s)f\*?(?=\s|$)/g);
  return matches ? matches.length : 0;
}

function testSharedLayoutParity() {
  const cases = [
    {
      text: 'SHORT TEXT',
      field: { rect: [0, 0, 200, 20], font_size: 10.5 },
    },
    {
      text: 'A VERY LONG ADDRESS WITHOUT ANY CONVENIENT BREAK POINT 1234567890',
      field: { rect: [0, 0, 160, 42], font_size: 10.5, input_type: '地址' },
    },
    {
      text: '超长中文地址测试上海市徐汇区',
      field: { rect: [0, 0, 90, 42], font_size: 10, input_type: '地址' },
    },
    {
      text: 'VERY-LONG-EMAIL-ADDRESS@EXAMPLE.COM',
      field: { rect: [0, 0, 100, 20], font_size: 10.5 },
    },
  ];

  cases.forEach(({ text, field }) => {
    assert.deepStrictEqual(
      clientLayout.layoutText(text, field),
      cloudLayout.layoutText(text, field),
    );
  });
}

function testMultilineAndOverflow() {
  const multiline = cloudLayout.layoutText(
    'VIA ROMA 18 20121 MILANO ITALY',
    { rect: [0, 0, 80, 42], input_type: '地址', font_size: 10 },
  );
  assert.strictEqual(multiline.overflow, false);
  assert(multiline.lines.length > 1);

  const overflow = cloudLayout.layoutText(
    'THIS VALUE CANNOT FIT',
    {
      rect: [0, 0, 5, 5],
      layout_mode: 'singleline',
      font_size: 10,
      font_size_min: 4,
    },
  );
  assert.strictEqual(overflow.overflow, true);
}

function testSmallPreviewFontUsesVisualScaling() {
  const layout = clientLayout.layoutText(
    'A LONG USER VALUE',
    { rect: [0, 0, 60, 12], fontSize: 10.5 },
  );
  const smallStyle = clientLayout.buildScaledTextStyle(layout, 0.55, 'px');
  assert(smallStyle.includes('font-size:12.00px'));
  assert(smallStyle.includes('transform-origin:0 0'));
  assert(smallStyle.includes('transform:scale('));

  const normalLayout = clientLayout.layoutText(
    'OK',
    { rect: [0, 0, 100, 30], fontSize: 24 },
  );
  const normalStyle = clientLayout.buildScaledTextStyle(normalLayout, 1, 'px');
  assert.strictEqual(normalStyle.includes('transform:scale('), false);
}

async function testMissingFieldErrorAndManualFieldCreation() {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([300, 300]);
  pdfDoc.addPage([300, 300]);
  const form = pdfDoc.getForm();
  let missingError;
  try {
    form.getField('manual_textbox_1_3');
  } catch (err) {
    missingError = err;
  }

  assert.strictEqual(
    fillPdfAcroForm.__test.isMissingFormFieldError(missingError),
    true,
  );
  assert.strictEqual(
    fillPdfAcroForm.__test.isMissingFormFieldError(new Error('unrelated layout error')),
    false,
  );

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const field = fillPdfAcroForm.__test.createManualFormField({
    pdfDoc,
    form,
    name: 'manual_textbox_1_3',
    definition: {
      manual: true,
      field_type: '/Tx',
      page: 2,
      rect: [30, 54.96, 264.29, 79.72],
    },
    font,
  });

  assert(field);
  assert.strictEqual(field.getName(), 'manual_textbox_1_3');
  const manualTextWidget = field.acroField.getWidgets()[0];
  assert.strictEqual(manualTextWidget.P().toString(), pdfDoc.getPage(1).ref.toString());
  const manualTextAppearance = manualTextWidget.getAppearanceCharacteristics();
  assert.strictEqual(manualTextAppearance.getBackgroundColor(), undefined);
  assert.strictEqual(manualTextAppearance.getBorderColor(), undefined);

  const glyphFont = require('../pdf/vectorText').loadGlyphFont();
  const beforeFill = countFillOperators(decodePageContent(pdfDoc, 1));
  const fillResult = fillPdfAcroForm.__test.fillTextField({
    field,
    value: 'HOTEL ROMA',
    definition: { font_size: 10.5 },
    glyphFont,
    pdfDoc,
  });
  assert.strictEqual(fillResult.overflow, false);

  // 文本以矢量轮廓画到该字段所在页（index 1），页面内容的填充操作符应增多。
  const afterFill = countFillOperators(decodePageContent(pdfDoc, 1));
  assert(afterFill > beforeFill, '矢量文字应向页面内容层写入字形轮廓');

  const fallbackCheckBox = fillPdfAcroForm.__test.createManualFormField({
    pdfDoc,
    form,
    name: 'choicebutton_0_10',
    definition: {
      name: 'choicebutton_0_10',
      field_type: '/Btn',
      page: 1,
      rect: [20, 20, 30, 30],
    },
    font,
    allowSchemaFallback: true,
  });
  assert(fallbackCheckBox);
  assert.strictEqual(fallbackCheckBox.getName(), 'choicebutton_0_10');

  const fallbackChoice = fillPdfAcroForm.__test.createManualFormField({
    pdfDoc,
    form,
    name: 'textbox_0_14',
    definition: {
      name: 'textbox_0_14',
      field_type: '/Ch',
      page: 1,
      rect: [40, 20, 100, 35],
    },
    font,
    allowSchemaFallback: true,
  });
  assert(fallbackChoice);
  assert.strictEqual(fallbackChoice.getName(), 'textbox_0_14');
}

function testPreviewPagesUseSharedFieldRendering() {
  const page = {
    page: 1,
    width: 595,
    height: 842,
    previewImage: 'page-1.png',
    leaves: [
      {
        needInput: true,
        skipFill: false,
        fields: [
          {
            name: 'accepted',
            leafId: 'leaf-checkbox',
            label: '确认',
            kind: 'checkbox',
            previewStyle: 'left:1%;top:2%;width:3%;height:4%',
          },
          {
            name: 'surname',
            leafId: 'leaf-text',
            label: '姓',
            kind: 'text',
            rect: [0, 0, 120, 20],
            fontSize: 10,
            previewStyle: 'left:5%;top:6%;width:20%;height:4%',
          },
        ],
      },
      {
        needInput: false,
        skipFill: false,
        isHandwriting: true,
        manualText: '需要手写',
        fields: [{
          name: 'signature',
          leafId: 'leaf-signature',
          label: '签名',
          kind: 'text',
          rect: [0, 0, 120, 20],
          fontSize: 10,
          previewStyle: 'left:5%;top:12%;width:20%;height:4%',
        }],
      },
    ],
  };
  const values = { accepted: true, surname: 'ZHANG' };
  const sharedFields = buildPagePreviewFields(page, values, {
    renderedWidth: 702,
    unit: 'rpx',
  });
  const previewPages = buildPreviewPages({ pages: [page] }, values);

  assert.deepStrictEqual(previewPages[0].overlays, sharedFields);
  assert.strictEqual(sharedFields[0].isCheckbox, true);
  assert.strictEqual(sharedFields[0].filled, true);
  assert.strictEqual(sharedFields[0].display, '✓');
  assert.strictEqual(sharedFields[2].manual, true);
  assert.strictEqual(sharedFields[2].display, '需要手写');

  const legacyValueFields = buildPagePreviewFields(page, {
    accepted: '1',
    surname: 0,
  });
  assert.strictEqual(legacyValueFields[0].filled, true);
  assert.strictEqual(legacyValueFields[1].filled, true);
  assert.strictEqual(legacyValueFields[1].display, '0');
}

function testDuplicateAcroformIdentity() {
  const field = (name, rect) => ({
    name,
    field_name: '重复标题',
    field_type: '/Tx',
    rect,
    is_acro_need_filled: true,
    input_type: '普通文本',
  });
  const schema = {
    pages: [{
      page: 1,
      size: [100, 100],
      leaf_nodes: [
        { leaf_id: 'leaf-a', page: 1, text: '第一项', acroforms: [field('pdf_a', [10, 10, 40, 20])] },
        { leaf_id: 'leaf-b', page: 1, text: '第二项', acroforms: [field('pdf_b', [10, 30, 40, 40])] },
      ],
    }],
  };
  const form = buildForm(schema, 'identity-test', {
    id: 'identity-test',
    country: 'Italy',
    name: '重名测试',
    previewPattern: 'page-{page}.png',
  });
  const [first, second] = form.fields;
  assert.notStrictEqual(first.id, second.id);
  assert.notStrictEqual(first.id, first.name);
  assert.notStrictEqual(second.id, second.name);
  assert.strictEqual(first.label, '重复标题');
  assert.strictEqual(second.label, '重复标题');

  const overlays = buildPagePreviewFields(form.pages[0], {
    [first.id]: '甲',
    [second.id]: '乙',
  });
  assert.deepStrictEqual(overlays.map((item) => item.display), ['甲', '乙']);

  const cloudFieldMap = fillPdfAcroForm.__test.buildSchemaFieldMap(schema);
  assert.strictEqual(cloudFieldMap[first.id], first.name);
  assert.strictEqual(cloudFieldMap[second.id], second.name);
}

function testCrossPageLeafUsesAcroformPage() {
  const textField = (name, page, rect, fieldName = '重复标题') => ({
    name,
    page,
    field_name: fieldName,
    field_type: '/Tx',
    rect,
    is_acro_need_filled: true,
    input_type: '普通文本',
  });
  const schema = {
    pages: [
      {
        page: 1,
        size: [100, 100],
        leaf_nodes: [{
          leaf_id: 'leaf-cross-page',
          page: 1,
          text: '跨页填写项目',
          acroforms: [
            textField('pdf_page_1', 1, [10, 10, 40, 20]),
            textField('pdf_page_2', 2, [20, 160, 80, 180]),
          ],
        }],
      },
      {
        page: 2,
        size: [200, 200],
        leaf_nodes: [{
          leaf_id: 'leaf-native-page-2',
          page: 2,
          text: '第二页原生项目',
          acroforms: [
            textField('pdf_native_page_2', 2, [20, 120, 80, 140], '第二页字段'),
          ],
        }],
      },
    ],
  };
  const form = buildForm(schema, 'cross-page-test', {
    id: 'cross-page-test',
    country: 'Italy',
    name: '跨页测试',
    previewPattern: 'page-{page}.png',
  });

  const firstPageFields = form.pages[0].leaves.flatMap((leaf) => leaf.fields);
  const secondPageFields = form.pages[1].leaves.flatMap((leaf) => leaf.fields);
  const crossPageField = secondPageFields.find((field) => field.name === 'pdf_page_2');

  assert.deepStrictEqual(firstPageFields.map((field) => field.name), ['pdf_page_1']);
  assert.deepStrictEqual(
    secondPageFields.map((field) => field.name),
    ['pdf_page_2', 'pdf_native_page_2'],
  );
  assert(crossPageField);
  assert.strictEqual(crossPageField.page, 2);
  assert.strictEqual(crossPageField.sourcePage, 1);
  // 第二页高度为 200，rect 顶边为 180，正确的预览 top 应为 10%。
  assert(crossPageField.previewStyle.includes('top:10.00%'));
  assert.strictEqual(form.pages[1].leaves[0].leafId, 'leaf-cross-page');

  const values = {
    [form.fields.find((field) => field.name === 'pdf_page_1').id]: '第一页',
    [crossPageField.id]: '第二页',
    pdf_native_page_2: '原生字段',
  };
  assert.deepStrictEqual(
    buildPagePreviewFields(form.pages[0], values).map((field) => field.name),
    ['pdf_page_1'],
  );
  assert.deepStrictEqual(
    buildPagePreviewFields(form.pages[1], values).map((field) => field.name),
    ['pdf_page_2', 'pdf_native_page_2'],
  );
  // 辅助填写页只传 { width, leaves }，缺少显式 page 时也必须保留当前页方框。
  assert.deepStrictEqual(
    buildPagePreviewFields({
      width: form.pages[1].width,
      leaves: form.pages[1].leaves,
    }, values).map((field) => field.name),
    ['pdf_page_2', 'pdf_native_page_2'],
  );

  // 前端继续用 leaf 原始页生成隐藏 ID，须与云端旧草稿恢复规则保持一致。
  const cloudFieldMap = fillPdfAcroForm.__test.buildSchemaFieldMap(schema);
  assert.strictEqual(cloudFieldMap[crossPageField.id], crossPageField.name);
}

async function testMultilineAddressRendersWrappedVectors() {
  const { loadGlyphFont } = require('../pdf/vectorText');
  const glyphFont = loadGlyphFont();
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([300, 300]);
  const form = pdfDoc.getForm();
  const field = form.createTextField('address');
  field.addToPage(page, { x: 20, y: 200, width: 90, height: 42 });
  const original = 'VIA ROMA 18 20121 MILANO ITALY';

  const beforeFill = countFillOperators(decodePageContent(pdfDoc, 0));
  const result = fillPdfAcroForm.__test.fillTextField({
    field,
    value: original,
    definition: { input_type: '地址', font_size: 10 },
    glyphFont,
    pdfDoc,
  });

  assert.strictEqual(result.overflow, false);
  const previewLayout = clientLayout.layoutText(original, {
    rect: [0, 0, 90, 42],
    input_type: '地址',
    font_size: 10,
    padding: 1,
  });
  assert.deepStrictEqual(
    {
      lines: result.layout.lines,
      fontSize: result.layout.fontSize,
      overflow: result.layout.overflow,
    },
    {
      lines: previewLayout.lines,
      fontSize: previewLayout.fontSize,
      overflow: previewLayout.overflow,
    },
  );
  // 窄框长地址应换行成多行，逐字画出矢量轮廓。
  assert(result.layout.lines.length > 1);
  const afterFill = countFillOperators(decodePageContent(pdfDoc, 0));
  assert(afterFill > beforeFill + 5, '多行地址应向页面内容层写入字形轮廓');
}

async function testChinesePdfRendersVectorOutlines() {
  assert.strictEqual(fillPdfAcroForm.__test.needsUnicodeAppearanceFont({ name: '刘晨' }), true);
  assert.strictEqual(fillPdfAcroForm.__test.needsUnicodeAppearanceFont({ name: 'LIU CHEN 123' }), false);

  const { loadGlyphFont } = require('../pdf/vectorText');
  const glyphFont = loadGlyphFont();
  // 含生僻字 琛（U+741B）——旧的动态子集方案在微信内置阅读器会丢字，
  // 矢量轮廓方案只要源字体有字形就能画出。
  assert(glyphFont.hasGlyphForCodePoint('琛'.codePointAt(0)), '源字体应包含 琛 字形');

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([300, 300]);
  const form = pdfDoc.getForm();
  const field = form.createTextField('chinese_name');
  field.addToPage(page, { x: 20, y: 200, width: 120, height: 20 });
  const original = '刘琛 / LIU CHEN';

  const beforeFill = countFillOperators(decodePageContent(pdfDoc, 0));
  const result = fillPdfAcroForm.__test.fillTextField({
    field,
    value: original,
    definition: { font_size: 10 },
    glyphFont,
    pdfDoc,
  });
  assert.strictEqual(result.overflow, false);

  // 文字应作为矢量轮廓写入页面内容层（填充操作符增多），而非依赖嵌入字体外观。
  const afterFill = countFillOperators(decodePageContent(pdfDoc, 0));
  assert(afterFill > beforeFill + 5, '中文（含生僻字）应逐字画出矢量轮廓');

  // 扁平化后字段被移除；导出 PDF 不含 CJK 字体，体积仅 KB 级。
  fillPdfAcroForm.__test.flattenForm(form, await pdfDoc.embedFont(StandardFonts.Helvetica));
  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  const reloaded = await PDFDocument.load(bytes);
  assert.strictEqual(reloaded.getForm().getFields().length, 0);
  assert(bytes.length < 200 * 1024, `导出体积应远小于旧方案，实际 ${(bytes.length / 1024).toFixed(0)}KB`);
}

async function testFlattenRemovesFieldsAndRepairsBrokenWidgets() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([300, 300]);
  const form = pdfDoc.getForm();
  const filledField = form.createTextField('chinese_name');
  filledField.addToPage(page, { x: 20, y: 200, width: 120, height: 20 });
  const emptyField = form.createTextField('empty_field');
  emptyField.addToPage(page, { x: 20, y: 160, width: 120, height: 20 });
  const brokenField = form.createTextField('broken_missing_normal_appearance');
  brokenField.addToPage(page, { x: 20, y: 120, width: 120, height: 20 });
  const brokenWidget = brokenField.acroField.getWidgets()[0];
  brokenWidget.ensureAP().delete(PDFName.of('N'));
  assert.throws(
    () => brokenWidget.getNormalAppearance(),
    /Unexpected N type: undefined/,
  );
  const { loadGlyphFont } = require('../pdf/vectorText');
  const glyphFont = loadGlyphFont();
  const symbolFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const result = fillPdfAcroForm.__test.fillTextField({
    field: filledField,
    value: '刘晨 / LIU CHEN',
    definition: { font_size: 10 },
    glyphFont,
    pdfDoc,
  });
  assert.strictEqual(result.overflow, false);

  const repair = fillPdfAcroForm.__test.flattenForm(form, symbolFont);
  assert.strictEqual(repair.failures.length, 0);
  assert.strictEqual(repair.blankedWidgets.length, 0);
  assert.deepStrictEqual(repair.refreshedFields, []);
  assert.deepStrictEqual(repair.removedTextFields, [
    'chinese_name',
    'empty_field',
    'broken_missing_normal_appearance',
  ]);
  assert.deepStrictEqual(repair.removedChoiceFields, []);
  assert.strictEqual(form.getFields().length, 0);

  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  const reloaded = await PDFDocument.load(bytes);
  assert.strictEqual(reloaded.getForm().getFields().length, 0);

  const fallbackDoc = await PDFDocument.create();
  const fallbackPage = fallbackDoc.addPage([200, 100]);
  const fallbackForm = fallbackDoc.getForm();
  const fallbackField = fallbackForm.createTextField('unrepairable_missing_normal_appearance');
  fallbackField.addToPage(fallbackPage, { x: 10, y: 20, width: 100, height: 20 });
  fallbackField.acroField.getWidgets()[0].ensureAP().delete(PDFName.of('N'));
  const fallbackFont = await fallbackDoc.embedFont(StandardFonts.Helvetica);
  const originalUpdateAppearances = PDFTextField.prototype.updateAppearances;
  let fallbackRepair;
  try {
    PDFTextField.prototype.updateAppearances = () => {
      throw new Error('synthetic appearance provider failure');
    };
    fallbackRepair = fillPdfAcroForm.__test.ensureFlattenableWidgetAppearances(
      fallbackForm,
      fallbackFont,
    );
  } finally {
    PDFTextField.prototype.updateAppearances = originalUpdateAppearances;
  }
  assert.deepStrictEqual(fallbackRepair.failures, [{
    field: 'unrepairable_missing_normal_appearance',
    message: 'synthetic appearance provider failure',
  }]);
  assert.strictEqual(fallbackRepair.blankedWidgets.length, 1);
  assert.strictEqual(fallbackRepair.refreshedFields.length, 0);
  fallbackForm.flatten({ updateFieldAppearances: false });
  assert.strictEqual(fallbackForm.getFields().length, 0);
}

async function testPdfOverflowIsRejected() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([100, 100]);
  const form = pdfDoc.getForm();
  const field = form.createTextField('tiny');
  field.addToPage(page, { x: 10, y: 10, width: 5, height: 5 });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const result = fillPdfAcroForm.__test.fillTextField({
    field,
    value: 'TOO LONG',
    definition: { layout_mode: 'singleline', font_size: 10, font_size_min: 4 },
    font,
    form,
  });
  assert.strictEqual(result.overflow, true);
}

async function testPdfCheckboxIsSavedWithVisibleAppearance() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([100, 100]);
  const form = pdfDoc.getForm();
  const checkbox = form.createCheckBox('accepted');
  checkbox.addToPage(page, { x: 20, y: 20, width: 16, height: 16 });
  const originalWidget = checkbox.acroField.getWidgets()[0];

  // 真实签证模板中的部分复选框没有 /AP；此时第一次 check() 只能写值，
  // 不能把 widget 的 /AS 从 /Off 切换到可见的选中态。
  originalWidget.dict.delete(PDFName.of('AP'));
  assert.strictEqual(checkbox.acroField.getOnValue(), undefined);
  assert.strictEqual(checkbox.needsAppearancesUpdate(), true);

  assert.strictEqual(
    fillPdfAcroForm.__test.fillNonTextField(checkbox, true),
    true,
  );
  assert.strictEqual(checkbox.isChecked(), true);
  assert.strictEqual(checkbox.needsAppearancesUpdate(), false);
  assert.strictEqual(
    originalWidget.getAppearanceState().toString(),
    checkbox.acroField.getOnValue().toString(),
  );
  assert.notStrictEqual(originalWidget.getAppearanceState().toString(), '/Off');

  // 与生产导出保持一致：不触发全表单自动更新，确认勾选值和可见外观均已落盘。
  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  const reloaded = await PDFDocument.load(bytes);
  const reloadedCheckbox = reloaded.getForm().getCheckBox('accepted');
  const widget = reloadedCheckbox.acroField.getWidgets()[0];
  const appearanceState = widget.getAppearanceState();
  const normalAppearance = widget.getAppearances().normal;

  assert.strictEqual(reloadedCheckbox.isChecked(), true);
  assert(appearanceState);
  assert(normalAppearance.has(appearanceState));
  assert.strictEqual(appearanceState.toString(), reloadedCheckbox.acroField.getOnValue().toString());
  assert.notStrictEqual(appearanceState.toString(), '/Off');
  assert.strictEqual(reloadedCheckbox.needsAppearancesUpdate(), false);
}

async function testExportedCheckboxDrawsMarkWithoutWidgetRectangle() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([100, 100]);
  const form = pdfDoc.getForm();
  const checkbox = form.createCheckBox('accepted_without_frame');
  checkbox.addToPage(page, { x: 20, y: 20, width: 16, height: 16 });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  fillPdfAcroForm.__test.fillNonTextField(checkbox, true, font);
  const beforeMark = decodePageContent(pdfDoc, 0);
  assert.strictEqual(fillPdfAcroForm.__test.drawChoiceFieldMark({
    field: checkbox,
    pdfDoc,
  }), 1);
  const markedContent = decodePageContent(pdfDoc, 0).slice(beforeMark.length);
  const strokeCount = (markedContent.match(/(?:^|\s)S(?=\s|$)/g) || []).length;
  const lineWidths = Array.from(
    markedContent.matchAll(/(?:^|\s)(\d+(?:\.\d+)?) w(?=\s|$)/g),
    (match) => Number(match[1]),
  );
  assert.strictEqual(strokeCount, 2, '选中项应绘制两段矢量粗线勾');
  assert.strictEqual(lineWidths.length, 2);
  assert(lineWidths.every((width) => width >= 2.5), '常规选项框应按尺寸绘制明显的粗线');
  assert(/(?:^|\s)1 J(?=\s|$)/.test(markedContent), '勾选线段应使用圆角端点');

  const tinyCheckbox = form.createCheckBox('tiny_accepted_without_frame');
  tinyCheckbox.addToPage(page, { x: 50, y: 20, width: 6, height: 6 });
  fillPdfAcroForm.__test.fillNonTextField(tinyCheckbox, true, font);
  const beforeTinyMark = decodePageContent(pdfDoc, 0);
  assert.strictEqual(fillPdfAcroForm.__test.drawChoiceFieldMark({
    field: tinyCheckbox,
    pdfDoc,
  }), 1);
  const tinyMarkedContent = decodePageContent(pdfDoc, 0).slice(beforeTinyMark.length);
  assert(/(?:^|\s)1\.4(?:0+)? w(?=\s|$)/.test(tinyMarkedContent), '小选项框也应保持可辨识的最小线宽');

  const repair = fillPdfAcroForm.__test.flattenForm(form, font);
  assert.deepStrictEqual(repair.removedChoiceFields, [
    'accepted_without_frame',
    'tiny_accepted_without_frame',
  ]);
  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  const reloaded = await PDFDocument.load(bytes);
  const content = decodePageContent(reloaded, 0);
  assert.strictEqual(reloaded.getForm().getFields().length, 0);
  assert(!/(?:^|\s)re(?=\s|$)/.test(content), '导出内容层不应绘制选项矩形框');
}

async function testQualifiedXfaFieldNameAndBooleanRadio() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([100, 100]);
  const form = pdfDoc.getForm();
  const qualifiedName = 'topmostSubform[0].Page1[0].#area[0].textbox_0_0';
  const textField = form.createTextField(qualifiedName);
  textField.addToPage(page, { x: 10, y: 60, width: 60, height: 15 });
  const canonicalField = form.createTextField('textbox_0_1');
  canonicalField.addToPage(page, { x: 10, y: 45, width: 60, height: 10 });
  const legacySameShortName = form.createTextField('legacy.Page1.textbox_0_1');
  legacySameShortName.addToPage(page, { x: 10, y: 15, width: 60, height: 10 });
  const radio = form.createRadioGroup('topmostSubform[0].Page1[0].RB1[0].choicebutton_0_1');
  radio.addOptionToPage('0', page, { x: 10, y: 30, width: 10, height: 10 });

  const index = fillPdfAcroForm.__test.buildFormFieldNameIndex(form);
  assert.strictEqual(
    fillPdfAcroForm.__test.resolveFormFieldName('textbox_0_0', index),
    qualifiedName,
  );
  assert.strictEqual(
    fillPdfAcroForm.__test.resolveFormFieldName('missing_field', index),
    'missing_field',
  );
  assert.strictEqual(
    fillPdfAcroForm.__test.resolveFormFieldName('textbox_0_1', index),
    'textbox_0_1',
  );

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  assert.strictEqual(fillPdfAcroForm.__test.fillNonTextField(radio, false, font), true);
  assert.strictEqual(radio.getSelected(), undefined);
  assert.strictEqual(fillPdfAcroForm.__test.fillNonTextField(radio, true, font), true);
  assert.strictEqual(radio.getSelected(), '0');
}

function testLegacyAcroformFieldMapRecoveryDetection() {
  const oldApplication = {
    values: {
      acroform_abc: 'ZHANG',
      textbox_0_1: 'SAN',
    },
  };
  assert.strictEqual(needsAcroformFieldMapRecovery(oldApplication), true);
  assert.deepStrictEqual(
    buildAcroformValues(oldApplication, { acroform_abc: 'textbox_0_0' }),
    { textbox_0_0: 'ZHANG', textbox_0_1: 'SAN' },
  );
  assert.strictEqual(needsAcroformFieldMapRecovery({
    ...oldApplication,
    acroformFieldMap: { acroform_abc: 'textbox_0_0' },
  }), false);
}

async function run() {
  testSharedLayoutParity();
  testMultilineAndOverflow();
  testSmallPreviewFontUsesVisualScaling();
  await testMissingFieldErrorAndManualFieldCreation();
  testPreviewPagesUseSharedFieldRendering();
  testDuplicateAcroformIdentity();
  testCrossPageLeafUsesAcroformPage();
  await testMultilineAddressRendersWrappedVectors();
  await testChinesePdfRendersVectorOutlines();
  await testFlattenRemovesFieldsAndRepairsBrokenWidgets();
  await testPdfOverflowIsRejected();
  await testPdfCheckboxIsSavedWithVisibleAppearance();
  await testExportedCheckboxDrawsMarkWithoutWidgetRectangle();
  await testQualifiedXfaFieldNameAndBooleanRadio();
  testLegacyAcroformFieldMapRecoveryDetection();
  console.log('text layout tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
