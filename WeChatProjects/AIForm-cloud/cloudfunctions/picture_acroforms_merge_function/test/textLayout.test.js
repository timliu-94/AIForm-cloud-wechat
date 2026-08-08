const assert = require('assert');
const {
  PDFDocument,
  PDFName,
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
  assert.strictEqual(field.acroField.getWidgets()[0].P().toString(), pdfDoc.getPage(1).ref.toString());

  const fillResult = fillPdfAcroForm.__test.fillTextField({
    field,
    value: 'HOTEL ROMA',
    definition: { font_size: 10.5 },
    font,
    form,
  });
  assert.strictEqual(fillResult.overflow, false);

  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  const reloaded = await PDFDocument.load(bytes);
  assert.strictEqual(
    reloaded.getForm().getTextField('manual_textbox_1_3').getText(),
    'HOTEL ROMA',
  );
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
}

async function testPdfAppearanceKeepsOriginalValue() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([300, 300]);
  const form = pdfDoc.getForm();
  const field = form.createTextField('address');
  field.addToPage(page, { x: 20, y: 200, width: 90, height: 42 });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const original = 'VIA ROMA 18 20121 MILANO ITALY';

  const result = fillPdfAcroForm.__test.fillTextField({
    field,
    value: original,
    definition: { input_type: '地址', font_size: 10 },
    font,
    form,
  });

  assert.strictEqual(result.overflow, false);
  assert(result.layout.lines.length > 1);
  assert.strictEqual(field.getText(), original);
  assert.strictEqual(field.needsAppearancesUpdate(), false);
  const widget = field.acroField.getWidgets()[0];
  assert(widget.getAppearances().normal);

  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  const reloaded = await PDFDocument.load(bytes);
  const reloadedField = reloaded.getForm().getTextField('address');
  assert.strictEqual(reloadedField.getText(), original);
  assert.strictEqual(reloadedField.needsAppearancesUpdate(), false);
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

async function run() {
  testSharedLayoutParity();
  testMultilineAndOverflow();
  testSmallPreviewFontUsesVisualScaling();
  await testMissingFieldErrorAndManualFieldCreation();
  testPreviewPagesUseSharedFieldRendering();
  testDuplicateAcroformIdentity();
  await testPdfAppearanceKeepsOriginalValue();
  await testPdfOverflowIsRejected();
  await testPdfCheckboxIsSavedWithVisibleAppearance();
  console.log('text layout tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
