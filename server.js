const express = require('express');
const multer = require('multer');
const path = require('path');
const JSZip = require('jszip');
const { tools } = require('./tools');

const PORT = process.env.PORT || 3000;
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '50', 10);

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(), // files are processed in memory and never saved to disk
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 30 },
});

// Tool list for the frontend (without the run functions)
app.get('/api/tools', (req, res) => {
  res.json(
    tools.map(({ run, ...meta }) => ({ multiple: meta.max > 1, ...meta }))
  );
});

app.post('/api/convert/:id', upload.array('files', 30), async (req, res) => {
  const tool = tools.find((t) => t.id === req.params.id);
  if (!tool) return res.status(404).json({ error: 'Unknown tool.' });

  const files = req.files || [];
  if (files.length < tool.min) {
    return res.status(400).json({
      error: tool.min === 1 ? 'Please upload a file.' : `Please upload at least ${tool.min} files.`,
    });
  }
  if (files.length > tool.max) {
    return res.status(400).json({ error: `You can upload at most ${tool.max} file(s) for this tool.` });
  }

  try {
    const results = await tool.run(files, req.body || {});
    let name;
    let mime;
    let data;
    if (results.length === 1) {
      ({ name, mime, buffer: data } = results[0]);
    } else {
      const zip = new JSZip();
      results.forEach((r) => zip.file(r.name, r.buffer));
      data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      name = `${tool.id}-results.zip`;
      mime = 'application/zip';
    }
    res.set({
      'Content-Type': mime,
      'Content-Length': data.length,
      'X-Filename': encodeURIComponent(name),
      'Access-Control-Expose-Headers': 'X-Filename',
    });
    res.send(data);
  } catch (err) {
    if (err.user) return res.status(400).json({ error: err.message });
    console.error(`[${tool.id}]`, err);
    res.status(500).json({ error: 'Conversion failed. Please try again with a different file.' });
  }
});

// Error handler (e.g. file too large)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Maximum size is ${MAX_FILE_MB} MB.` });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Too many files uploaded.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Convertly running on http://localhost:${PORT}`));
}

module.exports = app;
