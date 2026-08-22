/* backupctl — vanilla JS frontend */

const STATE = { tasks: [], serverRunning: null, pollTimer: null, pendingQueue: [] };

/** Create an element (tag, optional class, optional text). */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** fetch JSON from the API; failures surface as {error}. */
async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    data.error = data.error || (data.detail || `HTTP ${res.status}`);
    return data;
  }
  return data;
}

/* ---------------- toasts ---------------- */

/** Show a transient toast (type: positive/negative/warning). */
function toast(message, type = 'positive') {
  const node = el('div', `toast ${type}`, message);
  document.getElementById('toasts').append(node);
  setTimeout(() => node.remove(), 5000);
}

/* ---------------- modals ---------------- */

/** Open a modal (title, optional body node, buttons); returns the overlay. */
function openModal({ title, body, buttons }) {
  const overlay = el('div', 'modal-overlay');
  const sheet = el('div', 'modal-sheet');
  sheet.append(el('div', 'modal-title', title));
  if (body) sheet.append(body);
  const row = el('div', 'modal-buttons');
  for (const b of buttons) {
    const btn = el('button', `btn ${b.cls || 'btn-ghost'}`, b.label);
    btn.onclick = () => b.onClick(overlay);
    row.append(btn);
  }
  sheet.append(row);
  overlay.append(sheet);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.getElementById('modal-root').append(overlay);
  return overlay;
}

/** Promise modal: resolves true on submit, false on cancel. */
function confirmModal(title, submitLabel = 'Run') {
  return new Promise((resolve) => {
    openModal({
      title,
      buttons: [
        { label: 'Cancel', cls: 'btn-ghost', onClick: (o) => { o.remove(); resolve(false); } },
        { label: submitLabel, cls: 'btn-primary', onClick: (o) => { o.remove(); resolve(true); } },
      ],
    });
  });
}

/** Promise modal with password fields; resolves the values array or null. */
function fieldsModal(title, fields, submitLabel = 'Run') {
  return new Promise((resolve) => {
    const body = el('div', 'modal-fields');
    const inputs = [];
    for (const f of fields) {
      const inp = el('input', 'modal-input');
      inp.type = 'password';
      inp.placeholder = f.label;
      inputs.push(inp);
      body.append(inp);
    }
    const overlay = openModal({
      title,
      body,
      buttons: [
        { label: 'Cancel', cls: 'btn-ghost', onClick: (o) => { o.remove(); resolve(null); } },
        { label: submitLabel, cls: 'btn-primary', onClick: (o) => { o.remove(); resolve(inputs.map((i) => i.value)); } },
      ],
    });
    setTimeout(() => inputs[0].focus(), 50);
  });
}

/** Promise modal listing tasks; resolves the picked task or null. */
function pickerModal(title, tasks) {
  return new Promise((resolve) => {
    let overlay = null;
    const list = el('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '6px';
    for (const t of tasks) {
      const b = el('button', 'btn btn-ghost', t.name);
      b.style.textAlign = 'left';
      b.onclick = () => { overlay.remove(); resolve(t); };
      list.append(b);
    }
    overlay = openModal({
      title,
      body: list,
      buttons: [{ label: 'Cancel', cls: 'btn-ghost', onClick: (o) => { o.remove(); resolve(null); } }],
    });
  });
}

/* ---------------- data ---------------- */

/** Fetch /api/tasks and re-render the page. */
async function loadTasks() {
  const data = await api('/api/tasks');
  STATE.tasks = data.tasks || [];
  STATE.serverRunning = (data.tasks || []).some((t) => t.running);
  document.getElementById('config-warning').hidden = !data.missing_config;
  render();
}

/** Build the grouped card grid from STATE.tasks. */
function render() {
  const page = document.getElementById('page');
  page.innerHTML = '';
  const groups = new Map();
  for (const t of STATE.tasks) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  for (const [group, tasks] of groups) {
    const header = el('div', 'category-header');
    header.append(el('span', 'category-title', group));
    header.append(el('span', 'category-count', `${tasks.length} task(s)`));
    page.append(header);
    const grid = el('div', 'task-grid');
    for (const t of tasks) grid.append(card(t));
    page.append(grid);
  }
}

/** Build one task card element from its JSON. */
function card(t) {
  const pillText = t.running ? 'Running…' : (t.state ? t.state.last_run_text : 'Never run');
  const c = el('div', 'task-card');
  c.innerHTML = `
    <div class="card-head">
      <span class="card-title"></span>
      <span class="pill ${t.pill}">${pillText}</span>
    </div>
    ${t.running && t.live ? `<div class="card-live"></div>` : ''}
    ${!t.avail ? `<span class="badge-unavail"></span>` : ''}
    ${t.uploads
      ? `<div class="dropzone-box" tabindex="0"><span class="dropzone-note"></span><input type="file" multiple hidden></div>`
      : t.note ? `<div class="card-note"></div>` : ''}
    ${t.queued > 0 ? `<div class="queue-chip">${t.queued} file(s) queued</div>` : ''}
    <div class="card-actions">
      ${t.export_url ? '<a class="btn btn-ghost export-btn" target="_blank" rel="noopener"></a>' : ''}
      <button class="btn ${t.running ? 'btn-ghost' : 'btn-primary'} run-btn"></button>
      <button class="btn btn-ghost log-btn">Log</button>
    </div>`;
  c.querySelector('.card-title').textContent = t.name;
  const live = c.querySelector('.card-live');
  if (live) live.textContent = t.live;
  const unavail = c.querySelector('.badge-unavail');
  if (unavail) unavail.textContent = t.avail_reason;
  if (t.uploads) {
    const note = c.querySelector('.dropzone-note');
    note.textContent = t.note || 'Drop files here or click to browse';
  } else {
    const cardNote = c.querySelector('.card-note');
    if (cardNote) cardNote.textContent = t.note;
  }
  const runBtn = c.querySelector('.run-btn');
  const logBtn = c.querySelector('.log-btn');
  runBtn.textContent = t.running ? 'Stop' : 'Run';
  runBtn.disabled = !t.running && (!t.avail || STATE.serverRunning);
  runBtn.onclick = t.running ? cancelRun : () => runTask(t);
  logBtn.onclick = () => openLog(t);
  const exportBtn = c.querySelector('.export-btn');
  if (exportBtn) {
    exportBtn.textContent = 'Generate Export';
    exportBtn.href = t.export_url;
  }
  if (t.uploads) {
    const zone = c.querySelector('.dropzone-box');
    const input = c.querySelector('input[type=file]');
    wireDropzone(zone, input, (files) => uploadFiles(t, files));
  }
  return c;
}

/* ---------------- drop zone wiring ---------------- */

/** Wire a drop zone + hidden input to a handler receiving a FileList. */
function wireDropzone(zone, input, handler) {
  zone.onclick = () => input.click();
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    handler(e.dataTransfer.files);
  };
  input.onchange = () => { handler(input.files); input.value = ''; };
}

/* ---------------- uploads ---------------- */

/** POST one file into a task's staging. */
async function uploadToTask(task, file) {
  const res = await api(`/api/upload/${encodeURIComponent(task.name)}?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    body: file,
  });
  if (res.error) { toast(res.error, 'warning'); return false; }
  toast(`${file.name} queued for ${task.name}`, 'positive');
  return true;
}

/** Upload a FileList dropped onto a task card. */
async function uploadFiles(task, fileList) {
  for (const file of fileList) {
    await uploadToTask(task, file); // the server validates the pattern (400 -> toast)
  }
  await loadTasks();
}

/* ---------------- global drop: auto-detect, batch confirm, run all ---------------- */

/** Global drop: detect each file server-side, batch-confirm, run sequentially. */
async function handleGlobalFiles(fileList) {
  const byTask = new Map(); // task name -> {task, files: []}
  for (const file of Array.from(fileList)) {
    const res = await api(`/api/detect?name=${encodeURIComponent(file.name)}`);
    const r = res.result;
    if (!r) {
      toast(`No task matches ${file.name} — drop it onto the matching card instead`, 'warning');
      continue;
    }
    let taskName = r.task;
    if (r.ambiguous.length > 1) {
      const options = r.ambiguous.map((n) => STATE.tasks.find((t) => t.name === n)).filter(Boolean);
      const picked = await pickerModal(`Which task is ${file.name} for?`, options);
      if (!picked) continue;
      taskName = picked.name;
    }
    const task = STATE.tasks.find((t) => t.name === taskName);
    if (!task) continue;
    if (!byTask.has(task.name)) byTask.set(task.name, { task, files: [] });
    byTask.get(task.name).files.push(file);
  }
  const entries = [...byTask.values()];
  if (!entries.length) return;

  for (const { task, files } of entries) {
    for (const file of files) {
      await uploadToTask(task, file);
    }
  }
  await loadTasks();

  if (STATE.serverRunning) {
    toast(`Queued ${entries.length} task(s) — a task is already running`, 'warning');
    return;
  }
  const lines = entries
    .map(({ task, files }) => `${task.name} (${files.length} file${files.length > 1 ? 's' : ''})`)
    .join(', ');
  const ok = await confirmModal(`Detected: ${lines}. Run all now?`);
  if (!ok) {
    toast('Files queued — run them later from their cards', 'positive');
    return;
  }
  STATE.pendingQueue = entries.map((e) => e.task.name);
  const first = STATE.pendingQueue.shift();
  const firstTask = STATE.tasks.find((t) => t.name === first);
  if (firstTask) runTask(firstTask, { skipGenericConfirm: true });
}

/* ---------------- running ---------------- */

/** Render the task's prompts, POST /api/run, start polling. */
async function runTask(task, opts = {}) {
  const extra = {};
  const prompts = task.prompts || [];
  const confirmPrompt = prompts.find((p) => p.type === 'confirm');
  const secretPrompts = prompts.filter((p) => p.type !== 'confirm');
  if (confirmPrompt) {
    const ok = await confirmModal(confirmPrompt.label || `Run ${task.name}?`);
    if (!ok) return;
    extra[confirmPrompt.key] = true;
  }
  if (secretPrompts.length) {
    const vals = await fieldsModal(task.name, secretPrompts.map((p) => ({ label: p.label })));
    if (!vals) return;
    secretPrompts.forEach((p, i) => { if (vals[i]) extra[p.key] = vals[i]; });
  }
  if (!prompts.length && !task.uploads && !opts.skipGenericConfirm) {
    const ok = await confirmModal(`Run ${task.name}?`);
    if (!ok) return;
  }
  const res = await api(`/api/run/${encodeURIComponent(task.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(extra),
  });
  if (res.error) { toast(res.error, 'warning'); return; }
  startPolling(task);
}

/** Stop the running task and clear the batch queue. */
async function cancelRun() {
  STATE.pendingQueue = [];
  const res = await api('/api/cancel', { method: 'POST' });
  toast(res.error || 'Stopping the task…', res.error ? 'negative' : 'warning');
}

/** Poll /api/status while running; on completion toast, paste dialog, next batch task. */
function startPolling(task) {
  STATE.pollTimer = setInterval(async () => {
    const s = await api('/api/status');
    if (s.running) {
      await loadTasks(); // re-render: Running pill, Stop button, live log line
      return;
    }
    clearInterval(STATE.pollTimer);
    STATE.pollTimer = null;
    const d = s.done;
    await loadTasks();
    if (d) {
      toast(`${d.task}: ${d.ok ? 'OK' : 'FAILED'} — ${d.summary.slice(0, 200)}`, d.ok ? 'positive' : 'negative');
      if (d.ok && d.paste) openPaste(d.task, d.summary);
    }
    if (STATE.pendingQueue.length) {
      const next = STATE.pendingQueue.shift();
      const nextTask = STATE.tasks.find((x) => x.name === next);
      if (nextTask) runTask(nextTask, { skipGenericConfirm: true });
    }
  }, 700);
}

/* ---------------- dialogs for results ---------------- */

/** Modal showing text in a monospace box with buttons. */
function resultModal(title, text, buttons) {
  const pre = el('pre', 'log-box');
  pre.textContent = text;
  openModal({ title, body: pre, buttons });
}

/** Show the task's last-run log. */
function openLog(task) {
  resultModal(`${task.name} — log`, task.state && task.state.output ? task.state.output : '(no log recorded yet)', [
    { label: 'Close', cls: 'btn-ghost', onClick: (o) => o.remove() },
  ]);
}

/** Show captured output with Copy and Done (commit) buttons. */
function openPaste(name, output) {
  resultModal(`${name} — output to paste`, output, [
    {
      label: 'Copy',
      cls: 'btn-ghost',
      onClick: () => navigator.clipboard.writeText(output).then(() => toast('Copied to clipboard', 'positive')),
    },
    {
      label: 'Done',
      cls: 'btn-primary',
      onClick: async (o) => {
        const res = await api(`/api/paste_done/${encodeURIComponent(name)}`, { method: 'POST' });
        o.remove();
        if (res.error) { toast(res.error, 'negative'); return; }
        if (!res.committed) { toast('No commit_dir configured for this task — nothing to commit', 'warning'); return; }
        toast(`Committed ${res.dest || ''}`, 'positive');
      },
    },
  ]);
}

/* ---------------- global drop zone wiring ---------------- */

/** Wire the top drop zone to click/drop handling. */
function wireGlobalDropzone() {
  wireDropzone(
    document.getElementById('global-dropzone'),
    document.getElementById('global-file'),
    handleGlobalFiles,
  );
}

/* ---------------- boot ---------------- */

wireGlobalDropzone();
loadTasks();
