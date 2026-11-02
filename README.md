# Convertly – All-in-one File Converter Website

PDF, Word, Excel aur Image tools ek hi website me. Backend: Node.js + Express. Frontend: plain HTML/CSS/JS (koi build step nahi).

## Tools

| Category | Tools |
|---|---|
| PDF | PDF to Word, Word to PDF, Image to PDF, Merge PDF, Split/Extract Pages, Rotate PDF, PDF to Text |
| Image | Resize, Convert (PNG / JPEG / WebP / AVIF / TIFF), Compress |
| Excel | Excel to PDF, Excel to CSV, CSV to Excel |

## Run karne ka tareeka

Requirement: **Node.js 18 ya usse naya** (https://nodejs.org)

```bash
npm install
npm start
```

Browser me kholo: http://localhost:3000

Test chalane ke liye (optional): `npm test`

## Settings (environment variables)

- `PORT` – server port (default 3000)
- `MAX_FILE_MB` – max upload size per file (default 50)

Example: `PORT=8080 MAX_FILE_MB=100 npm start`

## Project structure

```
convertly/
├── server.js        # Express server + API
├── tools.js         # Saare conversion tools (yahin naya tool add karo)
├── package.json
├── public/          # Website (index.html, style.css, app.js)
└── test/smoke.js    # Har tool ka automatic test
```

## Naya tool kaise add karein

`tools.js` me `tools` array me ek object add karo (`id`, `title`, `desc`, `category`, `accept`, `min`, `max`, `options`, `run`). Frontend me card aur form **apne aap** ban jata hai.

## Important notes

- **Word to PDF / Excel to PDF**: Agar server par **LibreOffice** installed hai (`soffice` command), to best quality milti hai aur .doc/.odt/.xls bhi chalte hain. Bina LibreOffice ke simple text-based conversion hota hai (sirf .docx / .xlsx).
  - Ubuntu/Debian: `sudo apt install libreoffice`
- **PDF to Word**: Text extract karke editable Word banata hai. Complex layout/tables/images exact same nahi aate. Scanned PDF (sirf image wali) ke liye OCR chahiye, jo isme nahi hai.
- Files memory me process hoti hain, disk par save nahi hoti.
- Live website deploy karte waqt rate limiting (`express-rate-limit`), HTTPS aur virus/size checks add karna accha rahega.

## Deploy

Kisi bhi Node hosting par chalega (Render, Railway, VPS, etc.). Start command: `npm start`. Docker use karna ho to LibreOffice wala image use karo taaki Word/Excel to PDF best aaye.
