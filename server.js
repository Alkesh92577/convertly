
const express = require('express');
const multer = require('multer');
const path = require('path');
const JSZip = require('jszip');
const { tools } = require('./tools');

const PORT = process.env.PORT || 3000;
const MAX_FILE_MB = parseInt(process.env.MAX_FILE_MB || '50', 10);
const BASE_URL = 'https://convertly-ochre-ten.vercel.app';

const app = express();
app.disable('x-powered-by');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_MB * 1024 * 1024,
    files: 30,
  },
});

// ---------- SEO HELPERS ----------

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function getToolSlug(tool) {
  return slugify(tool.title);
}

function getToolUrl(tool) {
  return `${BASE_URL}/tools/${getToolSlug(tool)}`;
}

function getToolDescription(tool) {
  return `${tool.desc} Use Convertly's free online ${tool.title.toLowerCase()} tool. Fast, simple and secure file conversion.`;
}

// ---------- SITEMAP ----------



app.get('/sitemap.xml', (req, res) => {
  const urls = [
    `${BASE_URL}/`,
    `${BASE_URL}/about.html`,
    `${BASE_URL}/contact.html`,
    `${BASE_URL}/privacy-policy.html`,
    ...tools.map((tool) => getToolUrl(tool)),
  ];

  const xml =
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    urls.map((url) => `<url><loc>${url}</loc></url>`).join('') +
    `</urlset>`;

  res.status(200);
  res.set('Content-Type', 'application/xml; charset=UTF-8');
  res.send(xml);
});



// ---------- STATIC WEBSITE ----------

app.use(express.static(path.join(__dirname, 'public')));

// ---------- TOOL LIST API ----------

app.get('/api/tools', (req, res) => {
  res.json(
    tools.map(({ run, ...meta }) => ({
      ...meta,
      slug: getToolSlug(meta),
      seoUrl: `/tools/${getToolSlug(meta)}`,
      multiple: meta.max > 1,
    }))
  );
});

// ---------- SEO LANDING PAGES ----------

app.get('/tools/:slug', (req, res) => {
  const tool = tools.find(
    (item) => getToolSlug(item) === req.params.slug
  );

  if (!tool) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="robots" content="noindex">
        <title>Page Not Found - Convertly</title>
      </head>
      <body>
        <h1>404 - Tool Not Found</h1>
        <a href="/">Return to Convertly Homepage</a>
      </body>
      </html>
    `);
  }

  const title = `${tool.title} Online Free | Convertly`;
  const description = getToolDescription(tool);
  const canonical = getToolUrl(tool);

  const relatedTools = tools
    .filter((item) => item.id !== tool.id && item.category === tool.category)
    .slice(0, 4);

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${escapeHTML(title)}</title>

  <meta name="description" content="${escapeHTML(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonical}">

  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHTML(title)}">
  <meta property="og:description" content="${escapeHTML(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Convertly">

  <meta name="theme-color" content="#2563eb">

  <link rel="icon" href="/favicon.ico">
  <link rel="stylesheet" href="/style.css">

  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1157896086428198"
    crossorigin="anonymous"></script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "${escapeHTML(tool.title)} - Convertly",
    "url": "${canonical}",
    "description": "${escapeHTML(description)}",
    "applicationCategory": "UtilitiesApplication",
    "operatingSystem": "Any",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    }
  }
  </script>
</head>

<body>

<header class="top">
  <div class="wrap nav">
    <a class="brand" href="/" aria-label="Convertly homepage">
      <span class="logo">C</span> Convertly
    </a>
    <a href="/" class="tag">All Free Tools</a>
  </div>
</header>

<main>
  <section class="hero">
    <div class="wrap">
      <h1>${escapeHTML(tool.title)} Online Free</h1>

      <p>${escapeHTML(tool.desc)} Use Convertly to process your files quickly and easily, right from your browser.</p>

      <a class="btn" href="/?tool=${encodeURIComponent(tool.id)}">
        ${escapeHTML(tool.icon)} Start ${escapeHTML(tool.title)}
      </a>
    </div>
  </section>

  <section class="wrap tools-section">

    <article class="seo-content">
      <h2>How to Use ${escapeHTML(tool.title)}</h2>

      <p>Convertly makes file conversion simple. You don't need to install any software or create an account to use this free online tool.</p>

      <ol>
        <li>Click the Start ${escapeHTML(tool.title)} button above.</li>
        <li>Select the file from your computer or mobile device.</li>
        <li>Choose the required options, if available.</li>
        <li>Click the Convert button to process your file.</li>
        <li>Download your converted file instantly.</li>
      </ol>

      <h2>Why Use Convertly?</h2>

      <ul>
        <li>Free online file conversion</li>
        <li>Simple and easy-to-use interface</li>
        <li>No software installation required</li>
        <li>Works on desktop, tablet and mobile devices</li>
        <li>Convenient file processing directly in your browser</li>
      </ul>

      <h2>Frequently Asked Questions</h2>

      <h3>Is ${escapeHTML(tool.title)} free?</h3>
      <p>Yes. Convertly provides this tool for free without requiring a subscription.</p>

      <h3>Do I need to install software?</h3>
      <p>No. You can use this tool directly in your web browser.</p>

      <h3>Can I use this tool on my mobile?</h3>
      <p>Yes. Convertly is designed to work on smartphones, tablets and computers.</p>

      <h3>How do I convert my file?</h3>
      <p>Click Start ${escapeHTML(tool.title)}, upload your file, and click Convert. Your converted file will be ready to download.</p>
    </article>

    <h2>Explore More ${escapeHTML(tool.category)} Tools</h2>

    <div class="grid">
      ${relatedTools.map((item) => `
        <a class="card" href="/tools/${getToolSlug(item)}">
          <div class="ico">${escapeHTML(item.icon)}</div>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML(item.desc)}</p>
          <span class="cat">${escapeHTML(item.category)}</span>
        </a>
      `).join('')}
    </div>

    <p style="margin-top:30px">
      <a href="/">← Explore All Convertly Tools</a>
    </p>

  </section>
</main>

<footer class="convertly-footer">
  <div class="footer-container">
    <div class="footer-main">
      <div class="footer-brand">
        <a href="/" class="footer-logo">convertly<span>.</span></a>
        <p>Simple, reliable tools to convert and manage your files. Get your work done quickly with Convertly.</p>
        <div class="footer-privacy">
          <span class="privacy-dot"></span>
          Your files are processed for conversion.
        </div>
      </div>

      <div class="footer-links">
        <div class="footer-column">
          <h3>Explore</h3>
          <a href="/">Home</a>
          <a href="/#tools">All Tools</a>
        </div>

        <div class="footer-column">
          <h3>Company</h3>
          <a href="/about.html">About Us</a>
          <a href="/contact.html">Contact Us</a>
        </div>

        <div class="footer-column">
          <h3>Legal</h3>
          <a href="/privacy-policy.html">Privacy Policy</a>
        </div>
      </div>
    </div>

    <div class="footer-bottom">
      <p>© ${new Date().getFullYear()} Convertly. All rights reserved.</p>
      <a href="/privacy-policy.html">Privacy &amp; Data Protection</a>
    </div>
  </div>
</footer>

</body>
</html>`);
});

// ---------- FILE CONVERSION API ----------

app.post('/api/convert/:id', upload.array('files', 30), async (req, res) => {
  const tool = tools.find((t) => t.id === req.params.id);

  if (!tool) {
    return res.status(404).json({ error: 'Unknown tool.' });
  }

  const files = req.files || [];

  if (files.length < tool.min) {
    return res.status(400).json({
      error: tool.min === 1
        ? 'Please upload a file.'
        : `Please upload at least ${tool.min} files.`,
    });
  }

  if (files.length > tool.max) {
    return res.status(400).json({
      error: `You can upload at most ${tool.max} file(s) for this tool.`,
    });
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

      results.forEach((result) => {
        zip.file(result.name, result.buffer);
      });

      data = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });

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
    if (err.user) {
      return res.status(400).json({ error: err.message });
    }

    console.error(`[${tool.id}]`, err);

    res.status(500).json({
      error: 'Conversion failed. Please try again with a different file.',
    });
  }
});

// ---------- ERROR HANDLER ----------

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `File too large. Maximum size is ${MAX_FILE_MB} MB.`,
    });
  }

  if (
    err.code === 'LIMIT_UNEXPECTED_FILE' ||
    err.code === 'LIMIT_FILE_COUNT'
  ) {
    return res.status(400).json({
      error: 'Too many files uploaded.',
    });
  }

  console.error(err);

  res.status(500).json({
    error: 'Something went wrong.',
  });
});

// ---------- START SERVER ----------

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Convertly running on http://localhost:${PORT}`);
  });
}

module.exports = app;
