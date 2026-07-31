const assert = require('assert');
const {
  PDFDocument,
  StandardFonts,
} = require('pdf-lib');
const clientLayout = require('../../../miniprogram/utils/textLayout');
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

async function run() {
  testSharedLayoutParity();
  testMultilineAndOverflow();
  await testPdfAppearanceKeepsOriginalValue();
  await testPdfOverflowIsRejected();
  console.log('text layout tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
