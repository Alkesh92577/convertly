(() => {
  const state = { tools: [], cat: 'All', q: '', tool: null, files: [] };
  const $ = (s) => document.querySelector(s);
  const grid = $('#grid');
  const dlg = $('#dlg');
  const panel = $('#panel');

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  async function init() {
    $('#year').textContent = new Date().getFullYear();
    const res = await fetch('/api/tools');
    state.tools = await res.json();
    renderCats();
    renderGrid();
    $('#search').addEventListener('input', (e) => {
      state.q = e.target.value.trim().toLowerCase();
      renderGrid();
    });
  }

  function renderCats() {
    const cats = ['All', ...new Set(state.tools.map((t) => t.category))];
    $('#cats').innerHTML = cats
      .map((c) => `<button class="chip ${c === state.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join('');
    $('#cats').onclick = (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state.cat = b.dataset.cat;
      renderCats();
      renderGrid();
    };
  }

  function renderGrid() {
    const list = state.tools.filter(
      (t) =>
        (state.cat === 'All' || t.category === state.cat) &&
        (!state.q || (t.title + ' ' + t.desc + ' ' + t.category).toLowerCase().includes(state.q))
    );
    grid.innerHTML = list
      .map(
        (t) => `<button class="card" data-id="${t.id}">
          <div class="ico">${t.icon}</div>
          <h3>${esc(t.title)}</h3>
          <p>${esc(t.desc)}</p>
          <span class="cat">${esc(t.category)}</span>
        </button>`
      )
      .join('');
    $('#empty').hidden = list.length > 0;
  }

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openTool(card.dataset.id);
  });

  function openTool(id) {
    state.tool = state.tools.find((t) => t.id === id);
    state.files = [];
    const t = state.tool;
    const opts = t.options
      .map((o) => {
        const val = o.default !== undefined ? `value="${esc(o.default)}"` : '';
        const ph = o.placeholder ? `placeholder="${esc(o.placeholder)}"` : '';
        let field;
        if (o.type === 'select') {
          field = `<select name="${o.name}">${o.options
            .map(([v, l]) => `<option value="${esc(v)}" ${v === o.default ? 'selected' : ''}>${esc(l)}</option>`)
            .join('')}</select>`;
        } else {
          field = `<input name="${o.name}" type="${o.type === 'number' ? 'number' : 'text'}" ${o.type === 'number' ? 'min="1"' : ''} ${val} ${ph} />`;
        }
        return `<label>${esc(o.label)}${field}</label>`;
      })
      .join('');
    const hint = t.max > 1 ? `Up to ${t.max} files` : 'One file';
    panel.innerHTML = `
      <h2>${t.icon} ${esc(t.title)}</h2>
      <p class="sub">${esc(t.desc)}</p>
      <div class="drop" id="drop" tabindex="0">
        <div><strong>Click to choose</strong> or drag & drop</div>
        <div style="font-size:13px;margin-top:4px">${hint}${t.min > 1 ? ` (min ${t.min})` : ''} · ${esc(t.accept)}</div>
      </div>
      <input id="fileInput" type="file" hidden accept="${esc(t.accept)}" ${t.max > 1 ? 'multiple' : ''} />
      <ul class="files" id="fileList"></ul>
      ${opts ? `<div class="opts" id="opts">${opts}</div>` : ''}
      <button class="btn" id="go">Convert</button>
      <div id="result"></div>`;
    const drop = $('#drop');
    const input = $('#fileInput');
    drop.onclick = () => input.click();
    drop.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && input.click();
    input.onchange = () => {
      addFiles([...input.files]);
      input.value = '';
    };
    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('over');
      })
    );
    drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
    $('#go').onclick = convert;
    dlg.showModal();
  }

  function addFiles(list) {
    const t = state.tool;
    const exts = t.accept.split(',').map((x) => x.trim().toLowerCase());
    for (const f of list) {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      if (!exts.includes(ext)) {
        showMsg('err', `"${f.name}" is not supported. Allowed: ${t.accept}`);
        continue;
      }
      if (t.max === 1) state.files = [f];
      else if (state.files.length < t.max) state.files.push(f);
    }
    renderFiles();
  }

  function renderFiles() {
    $('#fileList').innerHTML = state.files
      .map(
        (f, i) => `<li><span class="nm">${esc(f.name)}</span><span class="sz">${fmtSize(f.size)}</span>
        <button data-i="${i}" aria-label="Remove">✕</button></li>`
      )
      .join('');
    $('#fileList').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.files.splice(+b.dataset.i, 1);
      renderFiles();
    };
  }

  function showMsg(type, html) {
    $('#result').innerHTML = `<div class="msg ${type}">${html}</div>`;
  }

  async function convert() {
    const t = state.tool;
    if (state.files.length < t.min) {
      return showMsg('err', t.min === 1 ? 'Please choose a file first.' : `Please add at least ${t.min} files.`);
    }
    const fd = new FormData();
    state.files.forEach((f) => fd.append('files', f));
    document.querySelectorAll('#opts [name]').forEach((el) => fd.append(el.name, el.value));
    const btn = $('#go');
    btn.disabled = true;
    btn.textContent = 'Converting…';
    $('#result').innerHTML = '';
    try {
      const res = await fetch(`/api/convert/${t.id}`, { method: 'POST', body: fd });
      if (!res.ok) {
        let msg = 'Conversion failed.';
        try {
          msg = (await res.json()).error || msg;
        } catch {}
        throw new Error(msg);
      }
      const name = decodeURIComponent(res.headers.get('X-Filename') || 'converted-file');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showMsg('ok', `✅ Done! <a href="${url}" download="${esc(name)}">Download ${esc(name)}</a> (${fmtSize(blob.size)})`);
    } catch (err) {
      showMsg('err', esc(err.message));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Convert';
    }
  }

  init();
})();
