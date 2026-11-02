// All conversion tools live here. Each tool has metadata (shown in the UI)
// and a run(files, opts) function that returns [{ name, buffer, mime }].

const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { Readable } = require('stream');

const sharp = require('sharp');
const { PDFDocument, degrees } = require('pdf-lib');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { Document, Packer, Paragraph, TextRun, PageBreak } = require('docx');
const mammoth = require('mammoth');
const PDFKit = require('pdfkit');
const ExcelJS = require('exceljs');

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  tiff: 'image/tiff',
};

// ---------- helpers ----------
const fail = (msg) => Object.assign(new Error(msg), { user: true });
const baseName = (f) => path.parse(f.originalname).name;
const out = (name, buffer, ext) => ({ name, buffer, mime: MIME[ext] || 'application/octet-stream' });

function makePdf(build, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ size: 'A4', margin: 50, ...options });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// LibreOffice gives the best Word/Excel -> PDF quality. If it is installed we use it,
// otherwise we fall back to a pure-Node renderer (text only).
let sofficeAvailable = null;
function hasSoffice() {
  if (sofficeAvailable !== null) return Promise.resolve(sofficeAvailable);
  return new Promise((resolve) => {
    execFile('soffice', ['--version'], { timeout: 15000 }, (err) => {
      sofficeAvailable = !err;
      resolve(sofficeAvailable);
    });
  });
}

async function sofficeToPdf(file, ext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'conv-'));
  try {
    const inPath = path.join(dir, 'input' + ext);
    await fs.writeFile(inPath, file.buffer);
    await new Promise((resolve, reject) =>
      execFile(
        'soffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', dir, inPath],
        { timeout: 120000 },
        (err) => (err ? reject(err) : resolve())
      )
    );
    return await fs.readFile(path.join(dir, 'input.pdf'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function parseRanges(str, total) {
  const pages = [];
  for (const part of String(str || '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw fail(`Invalid page range: "${p}". Use format like 1-3,5`);
    let a = +m[1];
    let b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i++) {
      if (i < 1 || i > total) throw fail(`Page ${i} is out of range (PDF has ${total} pages)`);
      pages.push(i - 1);
    }
  }
  if (!pages.length) throw fail('Please enter the pages you want, e.g. 1-3,5');
  return pages;
}

async function loadPdf(file) {
  try {
    return await PDFDocument.load(file.buffer);
  } catch {
    throw fail(`Could not read "${file.originalname}". It may be corrupted or password protected.`);
  }
}

const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

// ---------- Excel -> PDF fallback (simple table renderer) ----------
async function excelToPdfFallback(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return makePdf(
    (doc) => {
      let first = true;
      wb.eachSheet((ws) => {
        if (!first) doc.addPage();
        first = false;
        doc.font('Helvetica-Bold').fontSize(14).text(ws.name, 40, 40);
        doc.moveDown(0.5);
        const cols = Math.max(ws.columnCount, 1);
        const w = (doc.page.width - 80) / cols;
        doc.font('Helvetica').fontSize(9);
        ws.eachRow({ includeEmpty: false }, (row) => {
          const cells = [];
          for (let c = 1; c <= cols; c++) cells.push(String(row.getCell(c).text ?? ''));
          const h = Math.max(16, ...cells.map((t) => doc.heightOfString(t, { width: w - 8 }) + 8));
          let y = doc.y;
          if (y + h > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            y = doc.page.margins.top;
          }
          cells.forEach((t, i) => {
            const x = 40 + i * w;
            doc.rect(x, y, w, h).stroke('#bbbbbb');
            doc.fillColor('#000000').text(t, x + 4, y + 4, { width: w - 8, height: h - 6 });
          });
          doc.x = 40;
          doc.y = y + h;
        });
      });
    },
    { layout: 'landscape', margin: 40 }
  );
}

// ---------- tool definitions ----------
const imageAccept = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.tif,.avif,.svg';

const tools = [
  {
    id: 'pdf-to-word',
    title: 'PDF to Word',
    desc: 'Convert PDF text into an editable Word (.docx) document.',
    category: 'PDF',
    icon: '📄',
    accept: '.pdf',
    min: 1,
    max: 10,
    options: [],
    async run(files) {
      const results = [];
      for (const f of files) {
        const pages = [];
        try {
          await pdfParse(f.buffer, {
            pagerender: async (page) => {
              const tc = await page.getTextContent();
              let lastY;
              let text = '';
              for (const item of tc.items) {
                const y = item.transform[5];
                if (lastY === undefined || lastY === y) text += item.str;
                else text += '\n' + item.str;
                lastY = y;
              }
              pages.push(text);
              return text;
            },
          });
        } catch {
          throw fail(`Could not read "${f.originalname}". It may be corrupted or password protected.`);
        }
        if (!pages.some((p) => p.trim())) {
          throw fail(`"${f.originalname}" has no selectable text (scanned PDF?). OCR is not supported.`);
        }
        const children = [];
        pages.forEach((text, i) => {
          if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
          text.split('\n').forEach((line) =>
            children.push(new Paragraph({ children: [new TextRun({ text: line, size: 22 })] }))
          );
        });
        const doc = new Document({ sections: [{ children }] });
        results.push(out(`${baseName(f)}.docx`, await Packer.toBuffer(doc), 'docx'));
      }
      return results;
    },
  },

  
  {
    id: 'pdf-to-excel',
    title: 'PDF to Excel',
    desc: 'Extract text-based PDF tables into an Excel (.xlsx) spreadsheet.',
    category: 'Excel',
    icon: '📊',
    accept: '.pdf',
    min: 1,
    max: 5,
    options: [],

 
async run(files) {
  const results = [];

  for (const f of files) {
    let parsed;

   
const pageItems = [];

try {
  parsed = await pdfParse(f.buffer, {
    pagerender: async (page) => {
      const content = await page.getTextContent();

      const items = content.items
        .filter((item) => item.str && item.str.trim())
        .map((item) => ({
          x: item.transform[4],
          y: item.transform[5],
          text: item.str.trim(),
        }));

      pageItems.push(items);

      // Preserve visual lines for the contact-card parser.
      const lines = [];

      for (const item of [...items].sort(
        (a, b) => b.y - a.y || a.x - b.x
      )) {
        let line = lines.find(
          (entry) => Math.abs(entry.y - item.y) <= 3
        );

        if (!line) {
          line = { y: item.y, items: [] };
          lines.push(line);
        }

        line.items.push(item);
      }

      return lines
        .sort((a, b) => b.y - a.y)
        .map((line) =>
          line.items
            .sort((a, b) => a.x - b.x)
            .map((item) => item.text)
            .join(' ')
        )
        .join('\n');
    },
  });
} catch (err) {
  console.error('[pdf-to-excel]', err);
  throw fail(`Could not read "${f.originalname}".`);
}


    const text = parsed.text || '';
    const lines = text.split(/\r?\n/).map((s) => s.trim());

    if (!lines.some(Boolean)) {
      throw fail(
        `"${f.originalname}" has no selectable text. Scanned PDFs need OCR, which is not supported by this version.`
      );
    }

    const wb = new ExcelJS.Workbook();

    // Detect business-card/contact data.
    const emails = text.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) || [];

    const hasContactLabels =
      /\b(address|contact|mobile|phone|email)\s*:/i.test(text);

    const isContactDocument =
      emails.length > 0 && hasContactLabels;

    if (isContactDocument) {
      const ws = wb.addWorksheet('Contacts');

      ws.columns = [
        { header: 'Company Name', key: 'company', width: 28 },
        { header: 'Contact Person', key: 'person', width: 24 },
        { header: 'Designation', key: 'designation', width: 25 },
        { header: 'Email', key: 'email', width: 38 },
        { header: 'Contact Number', key: 'phone', width: 22 },
        { header: 'Address', key: 'address', width: 48 },
      ];

      const records = [];
      let current = null;

      const isCompanyHeading = (line) =>
        /^[A-Z][A-Z0-9 &.,'()/-]{2,}$/.test(line) &&
        !/^(EMAIL|CONTACT|ADDRESS|PHONE|MOBILE|BUSINESS CARDS|CONVERTLY)$/i.test(line);

      const saveRecord = () => {
        if (current && (
          current.company || current.person || current.email ||
          current.phone || current.address
        )) {
          records.push(current);
        }
      };

      for (const line of lines.filter(Boolean)) {
        if (/^(sample pdf|convertly pdf|business cards|expected columns)/i.test(line)) {
          continue;
        }

        if (isCompanyHeading(line)) {
          saveRecord();

          current = {
            company: line,
            person: '',
            designation: '',
            email: '',
            phone: '',
            address: '',
          };

          continue;
        }

        if (!current) {
          current = {
            company: '',
            person: '',
            designation: '',
            email: '',
            phone: '',
            address: '',
          };
        }

        const email = line.match(
          /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
        );

        if (email) {
          current.email = email[0];
          continue;
        }

        const phone = line.match(
          /(?:\+?\d[\d ()-]{7,}\d)/
        );

        if (/^(contact|phone|mobile|tel)\s*:/i.test(line)) {
          current.phone = line.replace(/^[^:]+:\s*/, '').trim();
          continue;
        }

        if (/^address\s*:/i.test(line)) {
          current.address = line.replace(/^address\s*:\s*/i, '').trim();
          continue;
        }

        if (!current.person && /[—–]/.test(line)) {
          const parts = line.split(/\s+[—–]\s+/, 2);
          current.person = parts[0].trim();
          current.designation = (parts[1] || '').trim();
          continue;
        }

        if (
          !current.phone &&
          /^(contact|phone|mobile|tel)\s*:/i.test(line)
        ) {
          current.phone = phone ? phone[0].trim() : '';
        } else if (
          !current.person &&
          /^[A-Za-z][A-Za-z .'-]+$/.test(line) &&
          !/^(email|contact|address|phone|mobile)$/i.test(line)
        ) {
          current.person = line;
        }
      }

      saveRecord();

      if (records.length) {
        ws.addRows(records);
      } else {
        // Keep contact information instead of failing if headings differ.
        const fallback = wb.addWorksheet('Extracted Text');
        fallback.addRow(['Extracted Text']);
        lines.filter(Boolean).forEach((line) => fallback.addRow([line]));
      }
    } 
else {
  const ws = wb.addWorksheet('Extracted Data');

  for (const items of pageItems) {
    const sorted = [...items].sort(
      (a, b) => b.y - a.y || a.x - b.x
    );

    const lines = [];

    for (const item of sorted) {
      let line = lines.find(
        (entry) => Math.abs(entry.y - item.y) <= 3
      );

      if (!line) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }

      line.items.push(item);
    }

    // Learn column starts from lines containing several cells.
    const candidateLines = lines.filter(
      (line) => line.items.length >= 3
    );

    const starts = candidateLines
      .flatMap((line) =>
        line.items.map((item) => ({
          x: item.x,
          y: line.y,
        }))
      )
      .sort((a, b) => a.x - b.x);

    const clusters = [];

    for (const point of starts) {
      let cluster = clusters.find(
        (entry) => Math.abs(entry.x - point.x) <= 6
      );

      if (!cluster) {
        cluster = { x: point.x, ys: new Set() };
        clusters.push(cluster);
      }

      cluster.ys.add(point.y);
      cluster.x =
        (cluster.x * (cluster.ys.size - 1) + point.x) /
        cluster.ys.size;
    }

    const anchors = clusters
      .filter((cluster) => cluster.ys.size >= 2)
      .map((cluster) => cluster.x)
      .sort((a, b) => a - b);

    for (const line of lines.sort((a, b) => b.y - a.y)) {
      const cells = [];

      for (const item of line.items.sort((a, b) => a.x - b.x)) {
        let col = 0;

        if (anchors.length > 1) {
          let best = Infinity;

          anchors.forEach((anchor, index) => {
            const distance = Math.abs(item.x - anchor);

            if (distance < best) {
              best = distance;
              col = index;
            }
          });
        }

        cells[col] = cells[col]
          ? `${cells[col]} ${item.text}`
          : item.text;
      }

      if (cells.some(Boolean)) {
        ws.addRow(cells);
      }
    }
  }

  if (!ws.rowCount) {
    throw fail(`No readable text found in "${f.originalname}".`);
  }
}


    // Professional formatting for all sheets.
    for (const ws of wb.worksheets) {
      ws.getRow(1).font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };

      ws.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF253858' },
      };

      ws.eachRow((row, rowNumber) => {
        row.alignment = {
          vertical: 'top',
          wrapText: true,
        };

        if (rowNumber > 1) {
          row.height = 22;
        }
      });

      if (ws.columnCount > 1) {
        ws.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: ws.columnCount },
        };
      }

      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    results.push(
      out(`${baseName(f)}.xlsx`, buffer, 'xlsx')
    );
  }

  return results;
},


  },

  {
    id: 'word-to-pdf',
    title: 'Word to PDF',
    desc: 'Convert Word (.docx) documents to PDF.',
    category: 'PDF',
    icon: '📝',
    accept: '.docx,.doc,.odt,.rtf',
    min: 1,
    max: 10,
    options: [],
    async run(files) {
      const results = [];
      const useOffice = await hasSoffice();
      for (const f of files) {
        let pdf;
        if (useOffice) {
          pdf = await sofficeToPdf(f, path.extname(f.originalname) || '.docx');
        } else {
          if (!/\.docx$/i.test(f.originalname)) {
            throw fail('Only .docx is supported on this server (install LibreOffice for .doc/.odt/.rtf).');
          }
          let text;
          try {
            ({ value: text } = await mammoth.extractRawText({ buffer: f.buffer }));
          } catch {
            throw fail(`Could not read "${f.originalname}". Is it a valid .docx file?`);
          }
          pdf = await makePdf((doc) => {
            doc.font('Helvetica').fontSize(12).text(text || ' ', { align: 'left' });
          });
        }
        results.push(out(`${baseName(f)}.pdf`, pdf, 'pdf'));
      }
      return results;
    },
  },
  {
    id: 'image-resize',
    title: 'Resize Image',
    desc: 'Change width and height of PNG, JPG, WebP and more.',
    category: 'Image',
    icon: '📐',
    accept: imageAccept,
    min: 1,
    max: 20,
    options: [
      { name: 'width', label: 'Width (px)', type: 'number', placeholder: 'e.g. 800' },
      { name: 'height', label: 'Height (px)', type: 'number', placeholder: 'e.g. 600 (optional)' },
      {
        name: 'fit',
        label: 'Fit mode',
        type: 'select',
        default: 'inside',
        options: [
          ['inside', 'Keep aspect ratio (fit inside)'],
          ['cover', 'Crop to fill exact size'],
          ['fill', 'Stretch to exact size'],
        ],
      },
    ],
    async run(files, opts) {
      const width = num(opts.width);
      const height = num(opts.height);
      if (!width && !height) throw fail('Enter a width or a height.');
      const results = [];
      for (const f of files) {
        try {
          const img = sharp(f.buffer, { animated: false });
          const meta = await img.metadata();
          const fmt = meta.format === 'svg' ? 'png' : meta.format;
          const buf = await img
            .resize({ width, height, fit: opts.fit || 'inside', withoutEnlargement: false })
            .toFormat(fmt)
            .toBuffer();
          const ext = fmt === 'jpeg' ? 'jpg' : fmt;
          results.push(out(`${baseName(f)}-resized.${ext}`, buf, ext));
        } catch {
          throw fail(`Could not process "${f.originalname}". Is it a valid image?`);
        }
      }
      return results;
    },
  },
  {
    id: 'image-convert',
    title: 'Convert Image (PNG / JPG / WebP)',
    desc: 'Convert between PNG, JPEG, WebP, AVIF and TIFF.',
    category: 'Image',
    icon: '🖼️',
    accept: imageAccept,
    min: 1,
    max: 20,
    options: [
      {
        name: 'format',
        label: 'Convert to',
        type: 'select',
        default: 'png',
        options: [
          ['png', 'PNG'],
          ['jpeg', 'JPEG'],
          ['webp', 'WebP'],
          ['avif', 'AVIF'],
          ['tiff', 'TIFF'],
        ],
      },
      { name: 'quality', label: 'Quality (1-100)', type: 'number', default: 90 },
    ],
    async run(files, opts) {
      const fmt = ['png', 'jpeg', 'webp', 'avif', 'tiff'].includes(opts.format) ? opts.format : 'png';
      const quality = Math.min(100, num(opts.quality) || 90);
      const results = [];
      for (const f of files) {
        try {
          let img = sharp(f.buffer);
          if (fmt === 'jpeg') img = img.flatten({ background: '#ffffff' });
          const buf = await img.toFormat(fmt, { quality }).toBuffer();
          const ext = fmt === 'jpeg' ? 'jpg' : fmt;
          results.push(out(`${baseName(f)}.${ext}`, buf, ext));
        } catch {
          throw fail(`Could not convert "${f.originalname}". Is it a valid image?`);
        }
      }
      return results;
    },
  },
  {
    id: 'image-compress',
    title: 'Compress Image',
    desc: 'Reduce image file size with minimal quality loss.',
    category: 'Image',
    icon: '🗜️',
    accept: '.png,.jpg,.jpeg,.webp',
    min: 1,
    max: 20,
    options: [{ name: 'quality', label: 'Quality (1-100)', type: 'number', default: 70 }],
    async run(files, opts) {
      const quality = Math.min(100, num(opts.quality) || 70);
      const results = [];
      for (const f of files) {
        try {
          const meta = await sharp(f.buffer).metadata();
          const fmt = ['png', 'jpeg', 'webp'].includes(meta.format) ? meta.format : 'jpeg';
          const opt = fmt === 'png' ? { quality, compressionLevel: 9, palette: true } : { quality, mozjpeg: fmt === 'jpeg' };
          const buf = await sharp(f.buffer).toFormat(fmt, opt).toBuffer();
          const ext = fmt === 'jpeg' ? 'jpg' : fmt;
          results.push(out(`${baseName(f)}-compressed.${ext}`, buf, ext));
        } catch {
          throw fail(`Could not compress "${f.originalname}".`);
        }
      }
      return results;
    },
  },
  {
    id: 'image-to-pdf',
    title: 'Image to PDF',
    desc: 'Combine one or more images into a single PDF.',
    category: 'PDF',
    icon: '🧾',
    accept: imageAccept,
    min: 1,
    max: 30,
    multiple: true,
    options: [
      {
        name: 'page',
        label: 'Page size',
        type: 'select',
        default: 'a4',
        options: [
          ['a4', 'A4 (image fitted on page)'],
          ['image', 'Same size as image'],
        ],
      },
    ],
    async run(files, opts) {
      const pdf = await PDFDocument.create();
      for (const f of files) {
        let png;
        try {
          png = await sharp(f.buffer).flatten({ background: '#ffffff' }).png().toBuffer();
        } catch {
          throw fail(`Could not read "${f.originalname}". Is it a valid image?`);
        }
        const img = await pdf.embedPng(png);
        if (opts.page === 'image') {
          const page = pdf.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        } else {
          const [pw, ph] = [595.28, 841.89];
          const m = 24;
          const scale = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height, 1);
          const w = img.width * scale;
          const h = img.height * scale;
          const page = pdf.addPage([pw, ph]);
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
      }
      const name = files.length === 1 ? `${baseName(files[0])}.pdf` : 'images.pdf';
      return [out(name, Buffer.from(await pdf.save()), 'pdf')];
    },
  },
  {
    id: 'merge-pdf',
    title: 'Merge PDF',
    desc: 'Join multiple PDF files into one (in the order you add them).',
    category: 'PDF',
    icon: '🔗',
    accept: '.pdf',
    min: 2,
    max: 20,
    multiple: true,
    options: [],
    async run(files) {
      const merged = await PDFDocument.create();
      for (const f of files) {
        const src = await loadPdf(f);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      return [out('merged.pdf', Buffer.from(await merged.save()), 'pdf')];
    },
  },
  {
    id: 'split-pdf',
    title: 'Split / Extract PDF Pages',
    desc: 'Extract selected pages or split every page into its own PDF.',
    category: 'PDF',
    icon: '✂️',
    accept: '.pdf',
    min: 1,
    max: 1,
    options: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'extract',
        options: [
          ['extract', 'Extract selected pages into one PDF'],
          ['each', 'Split every page into a separate PDF (ZIP)'],
        ],
      },
      { name: 'ranges', label: 'Pages (for extract mode)', type: 'text', placeholder: 'e.g. 1-3,5' },
    ],
    async run([f], opts) {
      const src = await loadPdf(f);
      const total = src.getPageCount();
      if (opts.mode === 'each') {
        const results = [];
        for (let i = 0; i < total; i++) {
          const d = await PDFDocument.create();
          const [p] = await d.copyPages(src, [i]);
          d.addPage(p);
          results.push(out(`${baseName(f)}-page-${i + 1}.pdf`, Buffer.from(await d.save()), 'pdf'));
        }
        return results;
      }
      const idx = parseRanges(opts.ranges, total);
      const d = await PDFDocument.create();
      const pages = await d.copyPages(src, idx);
      pages.forEach((p) => d.addPage(p));
      return [out(`${baseName(f)}-extracted.pdf`, Buffer.from(await d.save()), 'pdf')];
    },
  },
  {
    id: 'rotate-pdf',
    title: 'Rotate PDF',
    desc: 'Rotate all pages of a PDF by 90, 180 or 270 degrees.',
    category: 'PDF',
    icon: '🔄',
    accept: '.pdf',
    min: 1,
    max: 10,
    options: [
      {
        name: 'angle',
        label: 'Rotate clockwise by',
        type: 'select',
        default: '90',
        options: [
          ['90', '90°'],
          ['180', '180°'],
          ['270', '270°'],
        ],
      },
    ],
    async run(files, opts) {
      const angle = [90, 180, 270].includes(+opts.angle) ? +opts.angle : 90;
      const results = [];
      for (const f of files) {
        const doc = await loadPdf(f);
        doc.getPages().forEach((p) => p.setRotation(degrees((p.getRotation().angle + angle) % 360)));
        results.push(out(`${baseName(f)}-rotated.pdf`, Buffer.from(await doc.save()), 'pdf'));
      }
      return results;
    },
  },
  {
    id: 'pdf-to-text',
    title: 'PDF to Text',
    desc: 'Extract all text from a PDF into a .txt file.',
    category: 'PDF',
    icon: '🔤',
    accept: '.pdf',
    min: 1,
    max: 10,
    options: [],
    async run(files) {
      const results = [];
      for (const f of files) {
        let data;
        try {
          data = await pdfParse(f.buffer);
        } catch {
          throw fail(`Could not read "${f.originalname}". It may be corrupted or password protected.`);
        }
        results.push(out(`${baseName(f)}.txt`, Buffer.from(data.text || '', 'utf8'), 'txt'));
      }
      return results;
    },
  },
  {
    id: 'excel-to-pdf',
    title: 'Excel to PDF',
    desc: 'Convert Excel (.xlsx) spreadsheets to PDF.',
    category: 'Excel',
    icon: '📊',
    accept: '.xlsx,.xls,.ods',
    min: 1,
    max: 10,
    options: [],
    async run(files) {
      const results = [];
      const useOffice = await hasSoffice();
      for (const f of files) {
        let pdf;
        if (useOffice) {
          pdf = await sofficeToPdf(f, path.extname(f.originalname) || '.xlsx');
        } else {
          if (!/\.xlsx$/i.test(f.originalname)) {
            throw fail('Only .xlsx is supported on this server (install LibreOffice for .xls/.ods).');
          }
          try {
            pdf = await excelToPdfFallback(f.buffer);
          } catch {
            throw fail(`Could not read "${f.originalname}". Is it a valid .xlsx file?`);
          }
        }
        results.push(out(`${baseName(f)}.pdf`, pdf, 'pdf'));
      }
      return results;
    },
  },
  {
    id: 'excel-to-csv',
    title: 'Excel to CSV',
    desc: 'Export every sheet of an Excel file as CSV.',
    category: 'Excel',
    icon: '📑',
    accept: '.xlsx',
    min: 1,
    max: 5,
    options: [],
    async run(files) {
      const results = [];
      for (const f of files) {
        const wb = new ExcelJS.Workbook();
        try {
          await wb.xlsx.load(f.buffer);
        } catch {
          throw fail(`Could not read "${f.originalname}". Is it a valid .xlsx file?`);
        }
        const sheets = wb.worksheets;
        for (const ws of sheets) {
          const buf = await wb.csv.writeBuffer({ sheetName: ws.name });
          const suffix = sheets.length > 1 ? `-${ws.name.replace(/[^\w\-]+/g, '_')}` : '';
          results.push(out(`${baseName(f)}${suffix}.csv`, Buffer.from(buf), 'csv'));
        }
      }
      return results;
    },
  },
  {
    id: 'csv-to-excel',
    title: 'CSV to Excel',
    desc: 'Convert CSV files into Excel (.xlsx) spreadsheets.',
    category: 'Excel',
    icon: '📈',
    accept: '.csv',
    min: 1,
    max: 10,
    options: [],
    async run(files) {
      const results = [];
      for (const f of files) {
        const wb = new ExcelJS.Workbook();
        try {
          await wb.csv.read(Readable.from(f.buffer));
        } catch {
          throw fail(`Could not read "${f.originalname}". Is it a valid CSV file?`);
        }
        results.push(out(`${baseName(f)}.xlsx`, Buffer.from(await wb.xlsx.writeBuffer()), 'xlsx'));
      }
      return results;
    },
  },
];

module.exports = { tools, MIME };
