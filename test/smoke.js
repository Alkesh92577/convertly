// Smoke test: starts the server on a random port and runs every tool once.
const assert = require('assert');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { Document, Packer, Paragraph } = require('docx');
const JSZip = require('jszip');
const app = require('../server');

async function makeSamples() {
  const png = await sharp({ create: { width: 400, height: 300, channels: 4, background: '#3b82f6' } }).png().toBuffer();

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    pdfDoc.addPage().drawText(`Hello page ${i}`, { x: 50, y: 700, size: 24, font });
  }
  const pdf = Buffer.from(await pdfDoc.save());

  const docx = await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph('Hello from Word'), new Paragraph('Second line')] }] })
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRows([['Name', 'Score'], ['Asha', 90], ['Ravi', 85]]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());

  const csv = Buffer.from('a,b\n1,2\n3,4\n');
  return { png, pdf, docx, xlsx, csv };
}

async function main() {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const s = await makeSamples();

  async function call(id, files, opts = {}) {
    const fd = new FormData();
    for (const [name, buf] of files) fd.append('files', new Blob([buf]), name);
    for (const [k, v] of Object.entries(opts)) fd.append(k, v);
    const res = await fetch(`${base}/api/convert/${id}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`${id}: ${res.status} ${await res.text()}`);
    return { buf: Buffer.from(await res.arrayBuffer()), name: decodeURIComponent(res.headers.get('X-Filename')) };
  }

  const tests = [
    ['pdf-to-word', [['a.pdf', s.pdf]], {}, (r) => r.buf.slice(0, 2).toString() === 'PK' && r.name === 'a.docx'],
    ['word-to-pdf', [['a.docx', s.docx]], {}, (r) => r.buf.slice(0, 4).toString() === '%PDF'],
    [
      'image-resize',
      [['a.png', s.png]],
      { width: 100 },
      async (r) => (await sharp(r.buf).metadata()).width === 100,
    ],
    [
      'image-convert',
      [['a.png', s.png]],
      { format: 'jpeg', quality: 80 },
      async (r) => (await sharp(r.buf).metadata()).format === 'jpeg' && r.name === 'a.jpg',
    ],
    ['image-compress', [['a.png', s.png]], { quality: 60 }, (r) => r.buf.length > 0],
    ['image-to-pdf', [['a.png', s.png], ['b.png', s.png]], {}, async (r) => (await PDFDocument.load(r.buf)).getPageCount() === 2],
    ['merge-pdf', [['a.pdf', s.pdf], ['b.pdf', s.pdf]], {}, async (r) => (await PDFDocument.load(r.buf)).getPageCount() === 6],
    [
      'split-pdf',
      [['a.pdf', s.pdf]],
      { mode: 'extract', ranges: '1,3' },
      async (r) => (await PDFDocument.load(r.buf)).getPageCount() === 2,
    ],
    [
      'split-pdf',
      [['a.pdf', s.pdf]],
      { mode: 'each' },
      async (r) => Object.keys((await JSZip.loadAsync(r.buf)).files).length === 3,
    ],
    ['rotate-pdf', [['a.pdf', s.pdf]], { angle: 90 }, async (r) => (await PDFDocument.load(r.buf)).getPage(0).getRotation().angle === 90],
    ['pdf-to-text', [['a.pdf', s.pdf]], {}, (r) => r.buf.toString().includes('Hello page 1')],
    ['excel-to-pdf', [['a.xlsx', s.xlsx]], {}, (r) => r.buf.slice(0, 4).toString() === '%PDF'],
    ['excel-to-csv', [['a.xlsx', s.xlsx]], {}, (r) => r.buf.toString().includes('Asha')],
    ['csv-to-excel', [['a.csv', s.csv]], {}, (r) => r.buf.slice(0, 2).toString() === 'PK'],
  ];

  let failed = 0;
  for (const [id, files, opts, check] of tests) {
    try {
      const r = await call(id, files, opts);
      assert.ok(await check(r), 'output check failed');
      console.log(`PASS  ${id}${opts.mode ? ' (' + opts.mode + ')' : ''}  -> ${r.name} (${r.buf.length} bytes)`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${id}: ${e.message}`);
    }
  }
  server.close();
  console.log(failed ? `\n${failed} test(s) failed` : '\nAll tools OK');
  process.exit(failed ? 1 : 0);
}

main();
