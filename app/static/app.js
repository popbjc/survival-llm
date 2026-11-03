// Survival LLM front end: chat with a local model, show what it searched and read, open its sources.
const token = document.querySelector('meta[name="token"]').content;
const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), modelName: $("model-name"), messages: $("messages"), welcome: $("welcome"),
  using: $("using"), setup: $("setup"), composer: $("composer"), composerNote: $("composer-note"), input: $("input"), send: $("send"),
  reasoning: $("reasoning"), length: $("length"), layout: $("layout"), reader: $("reader"), readerBody: $("reader-body"),
  search: $("search"), searchForm: $("search-form"), dialog: $("models"), modelsList: $("models-list"),
  modelsIntro: $("models-intro"), announce: $("announce"), libraryBtn: $("library-btn"),
};
let state = null;          // last /api/status
let currentModel = null;   // Ollama name of the model answering
let conversation = null;
let busy = null;           // AbortController while an answer streams
let pollTimer = null;
let readerRequest = 0;     // ignore stale article loads
let lastFocus = null;      // where focus returns when the reader closes
let restarting = false;    // an update is installing; the app will restart
const narrow = () => window.matchMedia("(max-width: 820px)").matches;

class StaleTab extends Error {}

async function api(path, opts = {}) {
  const resp = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-Token": token, ...opts.headers } });
  if (resp.status === 403) { showStale(); throw new StaleTab("stale"); }
  return resp;
}
function showStale() {
  if ($("stale")) return;
  document.body.insertAdjacentHTML("afterbegin", `<div id="stale" class="banner" role="alert">Survival LLM 已重启。
    <button type="button" class="primary" onclick="location.reload()">重新加载此页面</button></div>`);
}
// Kept per settings folder: a dev copy's fresh profile (bin/dev --fresh) starts without the normal copy's choices.
const profile = document.querySelector('meta[name="profile"]')?.content || "";
const stored = (key) => (profile && !profile.startsWith("{{") ? `${profile}:${key}` : key);
function remember(key, value) { try { localStorage.setItem(stored(key), value); } catch { /* private window */ } }
function recall(key) { try { return localStorage.getItem(stored(key)); } catch { return null; } }
function announce(text) { els.announce.textContent = ""; setTimeout(() => { els.announce.textContent = text; }, 50); }

// Server-sent events from a POST response body (": tick" heartbeat lines are ignored).
async function* events(resp) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of block.split("\n")) if (line.startsWith("data: ")) yield JSON.parse(line.slice(6));
    }
  }
}

// ---------- Markdown: escape everything, then render a small safe subset ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function linkify(text) {  // escaped text with its web addresses as links (they open in the browser)
  return esc(text).replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");
}
function md(src) {
  let html = "", list = null, para = [], code = null;
  const flush = () => { if (para.length) { html += "<p>" + inline(para.join("<br>")) + "</p>"; para = []; } };
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of esc(src).split("\n")) {
    if (line.trim().startsWith("```")) {
      if (code) { html += "<pre><code>" + code.join("\n") + "</code></pre>"; code = null; }
      else { flush(); close(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)/))) {
      flush(); close();
      const level = Math.min(m[1].length + 2, 6);
      html += `<h${level}>${inline(m[2])}</h${level}>`;
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      flush();
      if (list !== "ul") { close(); html += "<ul>"; list = "ul"; }
      html += "<li>" + inline(m[1]) + "</li>";
    } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) {
      flush();
      if (list !== "ol") { close(); html += `<ol start="${m[1]}">`; list = "ol"; }
      html += "<li>" + inline(m[2]) + "</li>";
    } else if (!line.trim()) {
      flush(); close();
    } else if (list && /^\s{2,}\S/.test(line)) {
      html = html.replace(/<\/li>$/, "<br>" + inline(line.trim()) + "</li>");
    } else {
      close(); para.push(line);
    }
  }
  if (code) html += "<pre><code>" + code.join("\n") + "</code></pre>";
  flush(); close();
  return html;
}

// ---------- status, models, first-run setup ----------
const nameOf = (model) => (state?.models.find((m) => m.model === model)?.name) || model || "尚未选择";
const jobFor = (key) => state?.downloads.find((d) => d.key === key);
const activeJobs = () => (state?.downloads || []).filter((d) => ["starting", "downloading", "unpacking"].includes(d.status));
const isReady = () => state && state.ollama && state.models.length && state.library;
const isLoaded = (model) => !!model && (state?.loaded || []).includes(model.replace(/:latest$/, ""));

async function loadStatus() {
  try {
    state = await (await api("/api/status")).json();
  } catch (err) {
    if (err instanceof StaleTab) return;
    if (restarting) {  // the new version starts in a few seconds (with a new page token, so this page then asks to reload)
      setStatus("warn", "正在重启到新版本…");
      pollTimer = setTimeout(loadStatus, 2000);
      return;
    }
    setStatus("off", "Survival LLM 已停止。请重新打开应用。");
    return;
  }
  const installed = state.models.map((m) => m.model);
  if (!installed.includes(currentModel)) {
    const saved = recall("model");
    const before = currentModel;
    currentModel = installed.includes(saved) ? saved : state.default_model;
    if (currentModel && currentModel !== before) warm(currentModel);
  }
  renderStatus();
  showModel();
  renderSetup();
  if (els.dialog.open) renderModels();
  if (libraryDialog.open) renderLibrary();
  renderReaderLibrary();
  els.libraryBtn.hidden = !state.library && !state.my_files?.ready;
  renderVersion();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const quick = activeJobs().length || state?.setup || state?.warming.length || state?.ollama_starting || !state?.ollama;
  pollTimer = setTimeout(loadStatus, quick ? 1500 : isReady() ? 15000 : 6000);
}

function setStatus(kind, html) {
  els.status.innerHTML = `<span class="dot ${kind}"></span>${html}`;
}

function renderStatus() {
  const s = state;
  if (s.setup) {
    setStatus("warn", `正在设置：已下载 ${setupSteps(s).pct}%`);
  } else if (!s.ollama) {
    setStatus(s.ollama_installed ? "warn" : "off", s.ollama_installed
      ? (s.ollama_starting ? "正在启动 AI 引擎…"
        : `AI 引擎（Ollama）没有运行 · <button class="link" type="button" id="status-start">启动它</button>`)
      : "设置未完成：还需要 AI 引擎");
  } else if (!s.models.length || !s.library) {
    const missing = [!s.models.length && "AI 模型", !s.library && "知识库"].filter(Boolean).join("和");
    setStatus("warn", s.library || s.models.length ? `设置未完成：还需要${missing}` : "尚未完成设置");
  } else if (s.warming.includes(currentModel)) {
    setStatus("warn", `正在准备 ${esc(nameOf(currentModel))}…`);
  } else {
    const mine = s.my_files?.ready ? ` + 你的 ${s.my_files.ready.toLocaleString("zh-CN")} 个文件` : "";
    setStatus("on", `无需联网，随时可用 · <button class="link" type="button" id="status-library"
      title="切换或移动知识库">${s.library.articles.toLocaleString("zh-CN")} 篇文章</button>${mine}`);
  }
}

function showModel() {
  const entry = state?.catalog.find((c) => c.model === currentModel && c.installed);
  els.modelName.textContent = nameOf(currentModel);
  els.using.hidden = !currentModel;
  if (currentModel) {
    els.using.innerHTML = `正在由 <strong>${esc(nameOf(currentModel))}</strong> 回答`
      + (entry ? `，来自 ${esc(entry.maker)}。${esc(entry.blurb)}` : "。")
      + ` <button class="ghost" type="button" id="change-model">更换模型</button>`;
    $("change-model").onclick = openModels;
  }
}

function warm(model) {
  if (model) api("/api/warm", { method: "POST", body: JSON.stringify({ model }) }).then(loadStatus).catch(() => {});
}

// A second click confirms. (A browser confirm box looks out of place in the app window: "127.0.0.1 says".)
function confirmClick(btn, prompt) {
  if (!btn || btn.dataset.armed) return true;
  const original = btn.textContent;
  btn.dataset.armed = "1";
  btn.textContent = prompt;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = original; }, 4000);
  return false;
}

function selectModel(model, btn = null) {
  if (model === currentModel) { els.dialog.close(); return; }
  const chatting = els.messages.querySelector(".msg.user");
  if (chatting && !confirmClick(btn, "会开始一个新对话：再点一次")) return;
  currentModel = model;
  remember("model", model);
  warm(model);
  if (chatting) newChat();
  if (els.dialog.open) els.dialog.close();
  showModel();
  renderStatus();
  announce(`现在使用 ${nameOf(model)}。`);
}

// One row per catalog model (download / use), plus any other installed models.
function modelRows(container, { onlyFitting = false } = {}) {
  const sig = JSON.stringify([state.catalog, state.downloads, state.models, state.machine, state.disk_free_gb,
    currentModel, onlyFitting]);
  if (container.dataset.sig === sig) return;  // unchanged: keep the buttons a click or keyboard focus is on
  container.dataset.sig = sig;
  const focusedKey = document.activeElement?.closest?.(".model-row")?.dataset.key;
  container.innerHTML = "";
  const rows = state.catalog.filter((c) => !onlyFitting || (c.fits && c.fits_disk) || c.installed);
  for (const c of rows) {
    const current = c.installed && c.model === currentModel;
    const job = jobFor(`model:${c.model}`);
    const row = document.createElement("div");
    row.className = "model-row" + (current ? " current" : "") + (c.fits ? "" : " unfit");
    row.dataset.key = c.key;
    const memory = c.fits ? `需要 ${c.min_ram} GB 内存（RAM）`
      : `需要 ${c.min_ram} GB 内存（RAM）；本机只有 ${state.machine.ram_gb} GB`;
    row.innerHTML = `<div class="mr-main">
        <div class="mr-title">${esc(c.name)} <span class="mr-maker">来自 ${esc(c.maker)}</span>
          ${c.recommended ? '<span class="badge">适合本机</span>' : ""}
          ${current ? '<span class="badge inuse">使用中</span>' : ""}</div>
        <div class="mr-blurb">${esc(c.blurb)}</div>
        <div class="mr-meta">${c.installed ? "已下载" : `${c.gb} GB 下载`} · ${memory}</div>
      </div><div class="mr-action"></div>`;
    const action = row.querySelector(".mr-action");
    const button = (label, cls, onclick, disabled = false) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = cls; b.textContent = label; b.disabled = disabled; b.onclick = onclick;
      b.setAttribute("aria-label", `${label}：${c.name}`);
      action.appendChild(b);
    };
    if (c.installed) {
      button(current ? "使用中" : "使用此模型", current ? "ghost" : "primary", (e) => selectModel(c.model, e.currentTarget), current);
    } else if (job && ["starting", "downloading"].includes(job.status)) {
      const pct = job.total ? Math.round((job.completed / job.total) * 100) : 0;
      action.innerHTML = `<progress max="100" value="${pct}" aria-label="正在下载 ${esc(c.name)}"></progress>
        <p class="meta">${job.total ? `${(job.completed / 1e9).toFixed(1)} / ${(job.total / 1e9).toFixed(1)} GB` : "正在启动…"}</p>`;
    } else if (!state.ollama) {
      action.innerHTML = `<p class="meta">请先启动 AI 引擎</p>`;
    } else if (!c.fits_disk) {
      action.innerHTML = `<p class="meta">需要 ${c.gb + 5} GB 可用磁盘空间；本机可用 ${state.disk_free_gb} GB</p>`;
    } else if (c.fits || onlyFitting) {
      if (job?.status === "error") action.insertAdjacentHTML("beforeend", `<p class="meta error">${esc(job.error)}</p>`);
      button(job?.status === "error" ? "重试" : `下载 ${c.gb} GB`, c.recommended ? "primary" : "ghost",
        () => startModelDownload(c));
    } else {
      action.innerHTML = `<p class="meta">本机带不动这个模型</p>`;
    }
    container.appendChild(row);
  }
  const others = state.models.filter((m) => !state.catalog.some((c) => c.installed && c.model === m.model));
  if (others.length && !onlyFitting) {
    container.insertAdjacentHTML("beforeend", `<div class="group-title">本机上的其他模型</div>`);
    for (const m of others) {
      const current = m.model === currentModel;
      const row = document.createElement("div");
      row.className = "model-row" + (current ? " current" : "");
      row.dataset.key = m.model;
      row.innerHTML = `<div class="mr-main"><div class="mr-title">${esc(m.name)}
        ${current ? '<span class="badge inuse">使用中</span>' : ""}</div>
        <div class="mr-meta">${m.tested ? "上面列出的某个模型的另一份拷贝。" : "没有在 Survival LLM 上测试过，回答可能更差。"}</div></div>
        <div class="mr-action"><button type="button" class="ghost" ${current ? "disabled" : ""}>${current ? "使用中" : "使用此模型"}</button></div>`;
      row.querySelector("button").onclick = (e) => selectModel(m.model, e.currentTarget);
      container.appendChild(row);
    }
  }
  if (focusedKey) container.querySelector(`.model-row[data-key="${CSS.escape(focusedKey)}"] button`)?.focus();
}

function renderModels() {
  const engine = state.engine?.running;
  els.modelsIntro.textContent = `这台 ${state.machine.os} 电脑有 ${state.machine.ram_gb} GB 内存（RAM），可用磁盘空间 ${state.disk_free_gb} GB。模型越大知道得越多，但需要的内存也更大，速度也更慢。`
    + `趁有网的时候下载，并保持 Survival LLM 打开直到下载完成；下载中断后会从中断处继续。`
    + (engine ? ` AI 引擎：Ollama ${engine.version}，${engine.ours ? "内置于 Survival LLM" : "本机运行的 Ollama 应用"}。` : "");
  modelRows(els.modelsList);
}
function openModels() {
  if (!state) return;
  renderModels();
  els.dialog.showModal();
}

async function startModelDownload(c) {
  try {
    const resp = await api("/api/pull", { method: "POST", body: JSON.stringify({ model: c.model }) });
    if (resp.status === 409) announce(`${c.name} 已经在下载了。`);
  } catch { /* status polling shows any problem */ }
  loadStatus();
}

async function startLibraryDownload(pack) {
  try { await api("/api/library", { method: "POST", body: JSON.stringify({ pack }) }); } catch { /* shown via status */ }
  loadStatus();
}

// Someone with an AI but no library: the app works, from the AI's memory; say why, and how to get the library.
function renderLibraryMissing(setupShown) {
  const s = state, note = $("library-missing");
  const missing = !setupShown && s.models.length && !s.library;
  note.hidden = !missing;
  if (!missing) return;
  const html = s.library_away
    ? `知识库不在原来的位置：<code>${esc(s.library_dir)}</code>。如果它在某个驱动器上，把驱动器接上。
       <button class="link" type="button" id="missing-library">知识库窗口</button>`
    : `还没有知识库，所以回答只来自 AI 已知的内容，没有可核对的来源。
       <button class="link" type="button" id="missing-library">获取知识库</button>`;
  if (note.dataset.sig === html) return;
  note.dataset.sig = html;
  note.innerHTML = html;
  $("missing-library").onclick = () => openLibrary();
}

// ---------- first-run setup: choose a library and an AI, then one download that finishes on its own ----------
const TYPICAL_SPEED = 50e6 / 8;  // bytes a second on typical home internet (50 Mb/s), for estimates before it starts
const busyJob = (job) => job && ["starting", "downloading", "unpacking"].includes(job.status);
const bare = (model) => (model || "").replace(/:latest$/, "");
const hasModel = (model) => !!model && state.models.some((m) => bare(m.model) === bare(model));
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const gbText = (bytes) => `${(bytes / 1e9).toFixed(1)} GB`;
const speedText = (bytesPerSecond) => {  // in megabits a second (Mb/s), like internet plans
  const mbits = (bytesPerSecond * 8) / 1e6;
  return `${mbits >= 10 ? Math.round(mbits) : mbits.toFixed(1)} Mb/s`;
};
let doneJobs = new Set(), setupSig = "", sawSetup = false;
let armedKey = "", armedUntil = 0;  // a button waiting for its second click, kept while the screen redraws
const isArmed = (key) => armedKey === key && Date.now() < armedUntil;
function arm(key, redraw) {
  armedKey = key;
  armedUntil = Date.now() + 5000;
  redraw();
  setTimeout(redraw, 5100);  // back to its own label
}
let packNames = {};                         // pack id -> what the setup screen showed for it
let choice = { pack: null, model: null };   // what is picked on the setup screen
let needs = { library: false, ai: false };  // what the setup screen offers to download
let moreModels = false;                     // "Other AI models" is open

function progressHTML(job, doing, label) {  // the Updates window's downloads
  const pct = job.total ? Math.round((job.completed / job.total) * 100) : 0;
  return `<p>${job.status === "unpacking" ? "正在解包…（需要几分钟）" : doing}</p>
    <progress max="100" value="${pct}" aria-label="${label}"></progress>
    <p class="meta">${job.total ? `${(job.completed / 1e9).toFixed(1)} / ${(job.total / 1e9).toFixed(1)} GB · ` : ""}下载完成前请保持 Survival LLM 打开。如果中断了，重新打开会接着下载。</p>`;
}
function sizeText(gb) { return `${gb >= 10 ? Math.round(gb) : (+gb).toFixed(1)} GB`; }
function timeText(seconds) {
  let minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 2) return "约 1 分钟";
  if (minutes < 60) return `约 ${minutes} 分钟`;
  let hours = Math.floor(minutes / 60);
  minutes = Math.round((minutes % 60) / 10) * 10;
  if (minutes === 60) { hours += 1; minutes = 0; }
  return hours >= 3 || !minutes ? `约 ${hours} 小时` : `约 ${hours} 小时 ${minutes} 分钟`;
}
function option(name, value, checked, enabled, body) {
  return `<label class="ob-option${checked ? " on" : ""}${enabled ? "" : " unfit"}">
    <input type="radio" name="ob-${name}" value="${esc(value)}"${checked ? " checked" : ""}${enabled ? "" : " disabled"}>
    <span class="ob-main">${body}</span></label>`;
}
function part(num, title, why, body, done = false) {
  return `<section class="ob-part${done ? " done" : ""}"><h3><span class="num">${done ? "✓" : num}</span>${title}</h3>
    ${why ? `<p class="ob-why">${why}</p>` : ""}${body}</section>`;
}

// The AI models to offer: the ones that fit this computer, the best one first. If none fits, the smallest, as slow.
function setupModels(s) {
  const rows = s.catalog.map((c) => ({ ...c, pickable: c.installed || (c.fits && c.fits_disk) }));
  if (rows.length && !rows.some((r) => r.pickable)) {
    const small = rows.reduce((a, b) => (b.gb < a.gb ? b : a));
    if (small.fits_disk) Object.assign(small, { pickable: true, slow: true });
  }
  return rows;
}

function chooseView(s) {
  const packs = s.packs || [], models = setupModels(s);
  const aiUnknown = !s.ollama && s.ollama_installed;  // its engine is starting: which models it has isn't known yet
  needs = { library: !s.library, ai: !aiUnknown && !s.models.length };
  if (needs.library && !packs.some((p) => p.id === choice.pack)) choice.pack = (packs.find((p) => p.id === "lite") || packs[0])?.id || null;
  if (needs.ai && !models.some((m) => m.model === choice.model && m.pickable)) {
    choice.model = (models.find((m) => m.recommended && m.pickable) || models.find((m) => m.pickable))?.model || null;
  }
  const pack = needs.library ? packs.find((p) => p.id === choice.pack) : null;
  const model = needs.ai ? models.find((m) => m.model === choice.model && m.pickable) : null;
  const engineGB = needs.ai && !s.ollama_installed && s.engine?.downloadable ? s.engine.gb : 0;
  const modelGB = model && !model.installed ? model.gb : 0;
  const downloadGB = (pack?.gb || 0) + modelGB + engineGB;
  const diskGB = Math.ceil((pack?.disk_gb || 0) + modelGB + engineGB * 2.5 + 5);  // 5: room to spare afterwards

  let lib;
  if (!needs.library) lib = `<p class="ob-done">本机已有：${s.library.articles.toLocaleString("zh-CN")} 篇文章。</p>`;
  else if (packs.length) {
    lib = packs.map((p) => {
      const fits = p.disk_gb + 5 <= s.disk_free_gb;
      return option("pack", p.id, p.id === choice.pack, fits, `<span class="ob-name">${esc(p.name)}</span>
        <span class="ob-size">${sizeText(p.gb)}</span>
        <span class="ob-about">${esc(p.about)}。${p.articles ? ` ${p.articles.toLocaleString("zh-CN")} 篇文章。` : ""}</span>
        <span class="ob-meta">${fits ? `${cap(timeText((p.gb * 1e9) / TYPICAL_SPEED))}下载完 · 安装时需要 ${p.disk_gb} GB 可用空间`
          : `需要 ${p.disk_gb + 5} GB 可用磁盘空间；本机只有 ${s.disk_free_gb} GB`}</span>`);
    }).join("");
  } else {
    lib = s.packs_error === "unavailable"
      ? `<p>暂时拿不到知识库列表（下载站点有回应，但没有给出列表）。它会每分钟再检查一次。</p>`
      : s.packs_error === "offline"
      ? `<p>请连接互联网以下载知识库；页面会自己检测到你已联网。如果你已经有知识库文件夹（比如从 U 盘拷来的），用下面的“换个位置保存”来指定它。</p>`
      : `<p class="meta">正在获取知识库列表…</p>`;
  }

  let ai;
  if (aiUnknown) {
    ai = s.ollama_starting ? `<p class="meta">正在准备 AI 引擎…（几秒钟）</p>`
      : `<p>AI 引擎没有启动。<button class="ghost" type="button" id="start-ollama">重新启动</button></p>`;
  } else if (!needs.ai) {
    ai = `<p class="ob-done">本机已有：${esc(nameOf(currentModel || s.models[0].model))}。随时可以用顶部的“模型”更换。</p>`;
  } else {
    const modelOption = (m) => {
      const why = m.slow ? `需要 ${m.min_ram} GB 内存，而本机只有 ${s.machine.ram_gb} GB，所以回答会比较慢`
        : !m.fits ? `需要 ${m.min_ram} GB 内存（RAM）；本机只有 ${s.machine.ram_gb} GB`
        : !m.fits_disk && !m.installed ? `需要 ${m.gb + 5} GB 可用磁盘空间；本机只有 ${s.disk_free_gb} GB`
        : m.installed ? "本机已有" : `${cap(timeText((m.gb * 1e9) / TYPICAL_SPEED))}下载完`
          + (m.preview_cached ? "（此预览版只需几秒：它已经在这台 Mac 上）" : "");
      return option("model", m.model, m.model === choice.model && m.pickable, m.pickable, `<span class="ob-name">${esc(m.name)}</span>
        <span class="ob-size">${m.installed ? "" : sizeText(m.gb)}</span>${m.recommended ? ' <span class="badge">本机最佳</span>' : ""}
        <span class="ob-about">${esc(m.blurb)}</span>
        <span class="ob-meta">${why} · 来自 ${esc(m.maker)}</span>`);
    };
    // The best one for this computer, and the rest folded away (the ones that fit first), so the choice is easy.
    const best = models.find((m) => m.recommended && m.pickable) || models.find((m) => m.pickable);
    const others = [...models.filter((m) => m !== best && m.pickable), ...models.filter((m) => !m.pickable)];
    const open = moreModels || (best && choice.model !== best.model);
    ai = (best ? modelOption(best) : `<p class="error">没有一个 AI 模型适合这台电脑
        （${s.machine.ram_gb} GB 内存，${s.disk_free_gb} GB 可用磁盘空间）。你仍然可以下载知识库，自己搜索。</p>`)
      + (others.length ? `<details class="ob-more" id="ob-more"${open ? " open" : ""}><summary>${best ? "其他 AI 模型" : "AI 模型"}
          （${others.length}）</summary>${others.map(modelOption).join("")}</details>` : "");
    if (!s.ollama_installed && !s.engine?.downloadable) {
      ai = `<p>Survival LLM 用免费的 Ollama 应用在本机运行 AI。趁有网时安装：
        <a href="https://ollama.com/download" target="_blank" rel="noopener">ollama.com/download</a>。Ollama 运行起来后，设置会自动继续。</p>` + ai;
    } else if (engineGB) {
      ai += `<p class="meta">包含在本机运行它所需的 AI 引擎（${sizeText(engineGB)}）。</p>`;
    }
  }

  const waitEngine = aiUnknown && s.ollama_starting;
  const tooBig = downloadGB > 0 && diskGB > s.disk_free_gb;
  const ready = downloadGB > 0 && !tooBig && !waitEngine;  // either half alone, when the other can't be had
  const label = waitEngine ? "正在准备…" : downloadGB ? `下载 ${sizeText(downloadGB)}` : "下载";
  const note = tooBig
    ? `<p class="error">安装时需要约 ${diskGB} GB 可用磁盘空间，而本机只有 ${s.disk_free_gb} GB。${needs.library && pack?.id !== "lite" ? "改用必备包（Essentials），或" : ""}换一个更小的 AI，或者清理一些空间。</p>`
    : downloadGB ? `<p class="meta">按一般家庭宽带（50 Mb/s）估算，<strong>${cap(timeText((downloadGB * 1e9) / TYPICAL_SPEED))}</strong>。断网或电脑休眠后它还会继续。</p>` : "";
  if (needs.library) {
    lib += `<p class="ob-where meta">它会保存在 <code>${esc(s.library_dir)}</code>。
      <button class="link" type="button" id="ob-where">换个位置保存</button></p>`;
  }
  return `<div class="ob-hero"><h1>设置 Survival LLM</h1>
      <p>Survival LLM 是一个运行在这台电脑上的 AI。它从离线的医学、急救和操作指南知识库中查找答案，并告诉你每个回答来自哪里。趁有网时各下载一次，之后断网也能用。如果中途退出，下次打开会接着下载。</p></div>
    ${part(1, "知识库", needs.library ? "AI 查找资料的地方。你也可以自己阅读。" : "", lib, !needs.library)}
    ${part(2, "AI", needs.ai ? "在本机运行并撰写回答。越大知道得越多，出错也越少。" : "",
      ai, !needs.ai && !aiUnknown)}
    ${downloadGB || waitEngine ? `<div class="ob-go"><button class="primary big" type="button" id="ob-start"${ready ? "" : " disabled"}>${label}</button>${note}</div>` : ""}`;
}

// The setup's downloads, in order, with how far along each is.
function setupSteps(s) {
  const st = s.setup, steps = [];
  if (st.pack) {
    steps.push({ kind: "library", name: `知识库：${esc(packNames[st.pack]?.name || st.pack)}`, gb: packNames[st.pack]?.gb || 0,
      done: !!s.library && (!s.library.pack || s.library.pack === st.pack), job: jobFor(`library:${st.pack}`) });
  }
  if (st.model) {
    const engine = jobFor("engine");
    if (engine || (!s.ollama_installed && s.engine?.downloadable)) {
      steps.push({ kind: "engine", name: "AI 引擎", gb: s.engine?.gb || 0, done: s.ollama_installed, job: engine });
    }
    const entry = s.catalog.find((c) => bare(c.model) === bare(st.model));
    steps.push({ kind: "model", name: `AI：${esc(entry?.name || nameOf(st.model))}`, gb: entry?.gb || 0,
      done: hasModel(st.model), job: jobFor(`model:${st.model}`), cached: !!entry?.preview_cached });
  }
  let total = 0, done = 0, rate = 0, waiting = 0;  // waiting: bytes still to download, for the time left
  for (const step of steps) {
    step.bytes = step.job?.total || step.gb * 1e9;
    total += step.bytes;
    if (step.done) { done += step.bytes; continue; }
    const have = busyJob(step.job) ? step.job.completed : 0;
    if (busyJob(step.job)) { done += have; rate = step.job.rate || 0; step.active = true; }
    step.left = step.bytes - have;
    if (!step.cached) waiting += step.left;
  }
  return { steps, total, done, rate, waiting, pct: total ? Math.min(100, Math.floor((done / total) * 100)) : 0 };
}

function stepLine(s, step, first, rate) {
  const st = s.setup, job = step.job, here = st.step === step.kind || (st.step === "wait" && step.kind === "model");
  let icon = "", text;
  if (step.done) {
    icon = "✓";
    text = step.kind === "library" && s.library
      ? `就绪：${s.library.articles.toLocaleString("zh-CN")} 篇文章。<button class="link" type="button" id="ob-search">现在搜索</button>`
      : "就绪。";
  } else if (job?.status === "unpacking") {
    text = "正在解包…（需要几分钟）";
  } else if (busyJob(job)) {
    text = job.total ? `${gbText(job.completed)} / ${gbText(job.total)}${rate > 0 && !step.cached ? ` · 还剩 ${timeText(step.left / rate)}` : ""}`
      : "正在启动…";
  } else if (here && st.waiting === "retry") {
    text = `${esc(st.error || "下载中断了。")} ${st.retry_in} 秒后重试。
      <button class="link" type="button" id="ob-retry">立即重试</button>`;
  } else if (here && st.waiting === "stuck") {
    text = `<span class="error">${esc(st.error || "下载中断了。")}</span>
      <button class="ghost" type="button" id="ob-retry">重试</button>`;
  } else if (step.kind === "model" && st.waiting === "engine-starting") {
    text = "正在启动 AI 引擎…";
  } else if (step.kind === "model" && st.waiting === "install-engine") {
    text = `用它需要先安装免费的 Ollama 应用：<a href="https://ollama.com/download" target="_blank" rel="noopener">ollama.com/download</a>。Ollama 运行起来后，设置会自动继续。`;
  } else {
    text = `<span class="meta">${first ? "正在启动…" : rate > 0 && !step.cached ? `下一步：${gbText(step.left)}，${timeText(step.left / rate)}` : "下一步"}</span>`;
  }
  if (step.cached && !step.done) text += ` <span class="meta">（已经在这台 Mac 上，所以此预览版只需几秒）</span>`;
  const cls = step.done ? "done" : busyJob(job) ? "active" : here && st.waiting ? "problem" : "";
  return `<li class="${cls}"><span class="ob-icon" aria-hidden="true">${icon}</span><span><strong>${step.name}</strong> · ${text}</span></li>`;
}

function progressView(s) {
  const p = setupSteps(s);
  const left = p.rate > 0 && p.waiting > 0 ? ` · 总共还剩 ${timeText(p.waiting / p.rate)}` : "";
  const speed = p.rate > 0 ? ` · <span title="下载速度，单位为兆比特每秒（Mb/s），宽带套餐常用的单位">${speedText(p.rate)}</span>` : "";
  const library = p.steps.find((x) => x.kind === "library");
  const firstOpen = p.steps.find((x) => !x.done);
  const tip = library?.done && p.steps.some((x) => x.kind === "model" && !x.done)
    ? `<p class="ob-tip">知识库已就绪，AI 还在下载时你就可以自己搜索了。</p>` : "";
  return `<div class="ob-hero"><h1>正在设置 Survival LLM</h1></div>
    <section class="ob-part">
      <progress max="100" value="${p.pct}" aria-label="设置下载，${p.pct}%"></progress>
      <p class="ob-total"><strong>${p.pct}%</strong> · ${gbText(p.done)} / ${gbText(p.total)}${speed}${left}</p>
      <ul class="ob-steps">${p.steps.map((x) => stepLine(s, x, x === firstOpen, p.rate)).join("")}</ul>
    </section>
    ${tip}
    <p class="meta ob-foot">请保持 Survival LLM 打开，尽量接上电源。断网或电脑休眠时它会自己继续；如果退出，下次打开会从中断处接着下载。
      <button class="link" type="button" id="ob-change">${isArmed("change") ? "再点一次会停止下载并重新选择" : "更改要下载的内容"}</button></p>`;
}

function renderSetup() {
  const s = state;
  // A model that just finished downloading becomes the one in use if nothing is selected yet.
  for (const job of s.downloads.filter((d) => d.status === "done" && d.key.startsWith("model:"))) {
    if (doneJobs.has(job.key)) continue;
    doneJobs.add(job.key);
    const model = job.key.slice(6).replace(/:latest$/, "");
    if (!currentModel && s.models.some((m) => m.model === model)) selectModel(model);
  }
  for (const p of s.packs || []) packNames[p.id] = p;
  // The setup screen is for someone with no AI yet, or while setup runs. Not while the engine is only starting for
  // someone who has a library (an existing user, whose models aren't known yet); and someone with an AI but no
  // library (a download never finished, or the library is on a drive that's unplugged) gets the app with a note.
  const engineStarting = !s.ollama && s.ollama_installed;
  const show = !!s.setup || (!s.models.length && !(engineStarting && s.library));
  const firstRun = show && !s.models.length;  // nothing to chat with yet: no toolbar or question box
  const chatting = !!els.messages.querySelector(".msg");
  if (s.setup) sawSetup = true;
  document.body.classList.toggle("onboarding", firstRun);
  els.setup.hidden = !show;
  els.setup.classList.toggle("compact", show && chatting);
  els.welcome.hidden = show || chatting;
  renderLibraryMissing(show);
  const libraryNote = s.models.length && !s.library && chatting  // before a chat, the note at the top says it
    ? "知识库还没下载，所以回答只来自 AI 已知的内容，没有可核对的来源。" : "";
  if (libraryNote || els.composerNote.dataset.setup) {
    els.composerNote.textContent = libraryNote;
    els.composerNote.hidden = !libraryNote;
    if (libraryNote) els.composerNote.dataset.setup = "1"; else delete els.composerNote.dataset.setup;
  }
  if (!show) {
    if (sawSetup && isReady()) {  // a setup this page watched just finished
      $("ready-note").hidden = false;
      announce("设置完成。Survival LLM 现在不需要联网也能用了。");
      sawSetup = false;
    }
    setupSig = ""; els.setup.innerHTML = "";
    return;
  }
  const html = s.setup ? progressView(s) : chooseView(s);
  if (html === setupSig) return;  // rebuilding an unchanged screen would knock keyboard focus off its buttons
  setupSig = html;
  const focused = document.activeElement;
  const focusedId = focused?.id, focusedRadio = focused?.name?.startsWith("ob-") ? [focused.name, focused.value] : null;
  els.setup.innerHTML = html;
  for (const r of els.setup.querySelectorAll('input[name="ob-pack"]')) r.onchange = () => { choice.pack = r.value; renderSetup(); };
  for (const r of els.setup.querySelectorAll('input[name="ob-model"]')) r.onchange = () => { choice.model = r.value; renderSetup(); };
  if ($("ob-start")) $("ob-start").onclick = startSetup;
  if ($("ob-more")) $("ob-more").ontoggle = (e) => { moreModels = e.currentTarget.open; };
  if ($("ob-retry")) $("ob-retry").onclick = () => api("/api/setup/retry", { method: "POST", body: "{}" }).then(loadStatus);
  if ($("ob-change")) {
    $("ob-change").onclick = () => {
      if (isArmed("change")) { armedKey = ""; changeSetup(); } else arm("change", () => { setupSig = ""; renderSetup(); });
    };
  }
  if ($("ob-search")) $("ob-search").onclick = () => { showReader($("ob-search")); els.search.focus(); };
  if ($("start-ollama")) $("start-ollama").onclick = () => api("/api/start-ollama", { method: "POST", body: "{}" }).then(loadStatus);
  if ($("ob-where")) $("ob-where").onclick = () => moveLibrary();
  if (focusedId && $(focusedId)) $(focusedId).focus();
  else if (focusedRadio) els.setup.querySelector(`input[name="${focusedRadio[0]}"][value="${CSS.escape(focusedRadio[1])}"]`)?.focus();
}

async function startSetup(e) {
  e.currentTarget.disabled = true;
  const body = { pack: needs.library ? choice.pack : null, model: needs.ai ? choice.model : null };
  try {
    const resp = await api("/api/setup", { method: "POST", body: JSON.stringify(body) });
    if (!resp.ok) announce((await resp.json().catch(() => ({}))).error || "无法开始下载。");
    else announce("正在下载。本页会显示进度。");
  } catch { /* the status poll shows any problem */ }
  loadStatus();
}

async function changeSetup() {
  try { await api("/api/setup/cancel", { method: "POST", body: "{}" }); } catch { /* shown via status */ }
  setupSig = "";
  loadStatus();
}

// ---------- the Library window: which pack is installed, the other one, and where it's kept (#4, #9) ----------
const libraryDialog = $("library-dialog");
let librarySig = "", libraryNote = null;  // libraryNote: {text, error} about the last move
const packName = (id) => packNames[id]?.name || { lite: "必备包", full: "全量包" }[id] || id;

function openLibrary(keepNote = false) {
  if (!state) return;
  if (keepNote !== true) libraryNote = null;
  librarySig = "";
  renderLibrary();
  if (!libraryDialog.open) libraryDialog.showModal();
}

function renderLibrary() {
  const s = state, lib = s.library, move = jobFor("library-move");
  const otherBusy = activeJobs().some((j) => j.key.startsWith("library:") || j.key === "library-move");
  let html = lib
    ? `<h3>${lib.pack ? `已安装 ${esc(packName(lib.pack))}` : "你的知识库"}</h3>
       <p>${lib.articles.toLocaleString("zh-CN")} 篇文章，来自 ${lib.sources} 个来源。</p>`
    : `<h3>还没有知识库</h3><p>在下面选一个。在此之前，AI 只凭已知内容回答，没有可核对的来源。</p>`;
  html += `<p class="meta">保存在 <code>${esc(s.library_dir)}</code></p>`;
  if (busyJob(move)) {
    html += progressHTML(move, "正在把知识库移动到新文件夹…", "移动知识库");
  } else {
    if (move?.status === "error") html += `<p class="error">${esc(move.error)}</p>`;
    if (libraryNote) html += `<p class="${libraryNote.error ? "error" : "meta"}">${esc(libraryNote.text)}</p>`;
    html += `<p class="lib-actions">${lib ? `<button class="ghost" type="button" id="lib-show">显示文件夹</button> ` : ""}
      <button class="ghost" type="button" id="lib-move"${otherBusy ? " disabled" : ""}>${lib ? "移动…" : "换个位置保存…"}</button></p>
      <p class="meta">${lib ? "可以移动到另一个文件夹或外接硬盘。如果那个文件夹里已经有知识库，Survival LLM 会改用那个。" : "下载前先选好知识库的位置，比如外接硬盘。"}</p>`;
  }
  const others = (s.packs || []).filter((p) => p.id !== lib?.pack);
  for (const p of others) {
    const job = jobFor(`library:${p.id}`), fits = p.disk_gb + 5 <= s.disk_free_gb;
    html += `<h3>${lib ? "切换到" : "下载"} ${esc(p.name)}</h3>
      <p>${esc(p.about)}。${p.articles ? ` ${p.articles.toLocaleString("zh-CN")} 篇文章。` : ""}</p>`;
    if (busyJob(job)) {
      html += progressHTML(job, `正在下载 ${esc(p.name)}`, `${p.name} 下载`);
    } else {
      html += `${job?.status === "error" ? `<p class="error">${esc(job.error)}</p>` : ""}
        <p class="meta">下载量 ${sizeText(p.gb)}，按一般家庭宽带约 ${timeText((p.gb * 1e9) / TYPICAL_SPEED)}。安装时需要
          ${p.disk_gb} GB 可用空间；本机只有 ${s.disk_free_gb} GB。${lib ? " 新的知识库就绪前，当前知识库会继续可用，之后由新的替换它。" : ""}</p>
        <button class="${lib ? "ghost" : "primary"}" type="button" data-pack="${esc(p.id)}"${fits && !otherBusy ? "" : " disabled"}>
          ${isArmed(`switch:${p.id}`) ? "再点一次开始下载" : `${lib ? "切换到" : "下载"} ${esc(p.name)}（${sizeText(p.gb)}）`}</button>`;
    }
  }
  if (!(s.packs || []).length) {
    html += `<p class="meta">${s.packs_error === "offline" ? "连接互联网即可看到可下载的知识库。"
      : s.packs_error === "unavailable" ? "暂时拿不到知识库列表。它会每分钟再检查一次。"
      : "正在获取知识库列表…"}</p>`;
  }
  if (html === librarySig) return;  // rebuilding an unchanged window would knock keyboard focus off its buttons
  librarySig = html;
  const focusedId = document.activeElement?.id;
  $("library-body").innerHTML = html;
  if ($("lib-show")) $("lib-show").onclick = () => api("/api/library/open", { method: "POST", body: "{}" }).catch(() => {});
  if ($("lib-move")) $("lib-move").onclick = () => moveLibrary();
  for (const b of $("library-body").querySelectorAll("button[data-pack]")) {
    const key = `switch:${b.dataset.pack}`;
    b.onclick = () => {
      if (!state.library || isArmed(key)) { armedKey = ""; startLibraryDownload(b.dataset.pack); }
      else arm(key, () => { librarySig = ""; renderLibrary(); });
    };
  }
  if (focusedId && $(focusedId)) $(focusedId).focus();
}

function renderReaderLibrary() {
  const lib = state?.library, line = $("reader-lib");
  line.hidden = !lib;
  if (!lib) return;
  const html = `${lib.pack ? esc(packName(lib.pack)) : "知识库"}：${lib.articles.toLocaleString("zh-CN")} 篇文章 ·
    <button class="link" type="button" id="reader-manage">切换或移动知识库</button>`;
  if (line.dataset.sig === html) return;
  line.dataset.sig = html;
  line.innerHTML = html;
  $("reader-manage").onclick = () => openLibrary();
}

// The system's folder dialog; in a browser (no app window), a plain text box instead.
async function chooseFolder(start, question) {
  try {
    const resp = await api("/api/pick-folder", { method: "POST", body: JSON.stringify({ start }) });
    if (resp.status === 501) return window.prompt(question, start || "")?.trim() || null;
    return resp.ok ? (await resp.json()).path : null;
  } catch { return null; }
}

async function moveLibrary() {
  const folder = await chooseFolder(state.library_dir, "知识库要放在哪个文件夹？");
  if (!folder) return;
  libraryNote = null;
  try {
    const resp = await api("/api/library/move", { method: "POST", body: JSON.stringify({ folder }) });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) libraryNote = { text: out.error || "无法移动知识库。", error: true };
    else if (out.existing) libraryNote = { text: "那个文件夹里已经有知识库，Survival LLM 现在改用它。" };
    else if (out.same) libraryNote = { text: "知识库已经在那里了。" };
  } catch { return; }
  librarySig = setupSig = "";
  await loadStatus();
  if (libraryNote) { announce(libraryNote.text); if (!libraryDialog.open && libraryNote.error) openLibrary(true); }
}

$("close-library").onclick = () => libraryDialog.close();
libraryDialog.onclick = (e) => { if (e.target === libraryDialog) libraryDialog.close(); };
els.status.addEventListener("click", (e) => {
  if (e.target.id === "status-library") openLibrary();
  if (e.target.id === "status-start") api("/api/start-ollama", { method: "POST", body: "{}" }).then(loadStatus).catch(() => {});
});

// ---------- chat ----------
function addMessage(role, html) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.innerHTML = html;
  els.messages.appendChild(div);
  return div;
}
function scrollDown() {
  const m = els.messages;
  if (m.scrollHeight - m.scrollTop - m.clientHeight < 160) m.scrollTop = m.scrollHeight;
}
function setBusy(controller) {
  busy = controller;
  els.send.textContent = controller ? "停止" : "发送";
  els.send.classList.toggle("stop", !!controller);
  els.send.setAttribute("aria-label", controller ? "停止回答" : "发送问题");
}
function newChat() {
  if (busy) busy.abort();
  conversation = null;
  for (const m of [...els.messages.querySelectorAll(".msg")]) m.remove();
  els.welcome.hidden = false;
  if (!els.reader.hidden) hideReader();  // the article belonged to the old chat
}

function sourceButton(source, how, strong) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip" + (strong ? " read" : "");
  b.innerHTML = `${esc(source.title)} <span class="src">· ${esc(source.source)}</span>${source.official ? ' <span class="official" title="由政府或卫生机构发布。它们并不为这款应用背书。">官方</span>' : ""}`;
  b.onclick = () => openArticle(source.id, how, b);
  return b;
}

function needModel(text) {  // keep the question in the box so it can be sent once a model is ready
  els.input.value = text;
  autosize();
  els.composerNote.textContent = "请先下载一个 AI（在上面的设置里）。你的问题会留在这里。";
  els.composerNote.hidden = false;
  announce(els.composerNote.textContent);
  els.setup.scrollIntoView({ behavior: "smooth" });
}

async function ask(text) {
  text = text.trim();
  if (busy || !text) return;
  if (!currentModel) { await loadStatus(); if (!currentModel) { needModel(text); return; } }
  els.composerNote.hidden = true;
  const model = currentModel;
  const firstLoad = !isLoaded(model);
  els.welcome.hidden = true;
  addMessage("user", `<div class="bubble">${esc(text)}</div>`);
  const msg = addMessage("assistant", `<details class="how" open><summary>正在处理…</summary><div class="activity"></div></details>
    <div class="answer cursor"></div><div class="remembered"></div>
    <div class="answer-foot"><div class="meta"></div><button type="button" class="link reasoning-btn" aria-expanded="false">显示推理过程</button></div>
    <div class="reasoning" hidden><div class="reasoning-head"></div><div class="reasoning-note"></div><div class="reasoning-body"></div></div>
    <div class="sources"></div>`);
  const how = msg.querySelector(".how"), summary = how.querySelector("summary"), activity = how.querySelector(".activity");
  const answerEl = msg.querySelector(".answer"), meta = msg.querySelector(".meta"), sourcesEl = msg.querySelector(".sources");
  const started = Date.now();
  let answer = "", queued = false, steps = 0, failed = false, answered = false, stopped = false, unfinished = false;
  let thought = null, thoughts = 0, thoughtMs = 0, thinkSetting;  // thought: the stretch of reasoning streaming in now
  const remembered = msg.querySelector(".remembered"), changes = [];  // memory changes, announced together at the end
  const tick = setInterval(() => {
    summary.textContent = `${nameOf(model)} 正在处理… ${Math.round((Date.now() - started) / 1000)} 秒`;
  }, 1000);
  const render = () => { queued = false; answerEl.innerHTML = md(answer); scrollDown(); };
  const note = (label, id, howText) => {
    const el = document.createElement(id ? "button" : "div");
    el.textContent = label;
    if (id) { el.type = "button"; el.className = "linklike"; el.onclick = () => openArticle(id, howText, el); }
    activity.appendChild(el);
    steps += 1;
    scrollDown();
  };
  // Its reasoning, hidden until the person presses Show reasoning: a timeline of each stretch of thinking and the
  // lookups in between, in the order they happened. It streams in while hidden, so it can be opened at any point.
  const reasonBtn = msg.querySelector(".reasoning-btn"), reasoning = msg.querySelector(".reasoning");
  const reasonHead = reasoning.querySelector(".reasoning-head"), reasonBody = reasoning.querySelector(".reasoning-body");
  const duration = (ms) => `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const reasonStatus = (final) => {
    const who = nameOf(model);  // one title while it works (switching with each thought read as jumpy)
    // An unfinished answer (it never wrote one) gets no "before it answered".
    const until = answered && !unfinished ? "（回答之前）" : stopped ? "（你停止之前）" : answered ? "" : "（到目前为止）";
    reasonHead.textContent = !final ? (thoughts ? `${who} 目前的推理过程` : "还没有推理过程。")
      : thoughts ? `${who} 的推理过程${until} · 思考了 ${duration(thoughtMs)}`
      : thinkSetting === false ? `${who} 没有先推理就回答了，因为“推理”设为了关。提问前设为短或更高，它就会先思考。`
      : thinkSetting === null ? `${who} 回答前不会推理，所以没有可显示的内容。`
      : "这个回答没有推理过程可显示。";
    reasoning.querySelector(".reasoning-note").textContent = thoughts
      ? "回答之前，AI 会给自己写笔记来思考，中间会去查资料。它笔记里的“用户”指的就是你。"
        + "其中可能有它后来放弃的想法，所以以回答为准。" : "";
    reasonHead.classList.toggle("plain", !thoughts);  // a sentence saying why there is none, not a heading
    reasonBody.hidden = !thoughts;
  };
  const row = (kind, cls) => {  // one entry in the timeline: what kind of step, then what it was; returns the second
    const el = document.createElement("div");
    el.className = `r-row ${cls}`;
    el.innerHTML = `<div class="r-kind"></div><div class="r-what"></div>`;
    el.firstChild.textContent = kind;
    reasonBody.appendChild(el);
    return el.lastChild;
  };
  reasonBtn.onclick = () => {
    reasoning.hidden = !reasoning.hidden;
    reasonBtn.textContent = reasoning.hidden ? "显示推理过程" : "隐藏推理过程";
    reasonBtn.setAttribute("aria-expanded", String(!reasoning.hidden));
  };
  const paintThought = (t) => {
    t.queued = false;
    t.el.innerHTML = md(t.text.trim());  // models write their reasoning in Markdown too
    if (!reasoning.hidden) scrollDown();
  };
  const think = (text) => {
    if (!thought) {
      if (!text.trim()) return;  // blank lines before it starts
      thought = { el: row("思考", "r-thought"), text: "", started: Date.now(), queued: false };
      thoughts += 1;
      reasonStatus(false);
    }
    thought.text += text;
    if (!thought.queued) { thought.queued = true; const t = thought; requestAnimationFrame(() => paintThought(t)); }
  };
  const endThought = () => {
    if (!thought) return;
    thoughtMs += Date.now() - thought.started;
    paintThought(thought);
    thought = null;
    reasonStatus(false);
  };
  const reasonStep = (ev) => {  // a lookup between its thoughts; an article it read opens on a click, as above
    const what = row({ search: "搜索", read: "阅读", show: "打开" }[ev.type], "r-step");
    if (ev.type === "search") { what.textContent = `在知识库中搜索“${ev.query}”`; return; }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "linklike";
    b.textContent = `${ev.title} · ${ev.source}`;
    b.onclick = () => openArticle(ev.id, ev.type === "read" ? "回答引用了这一段" : "回答指向这里", b);
    what.appendChild(b);
  };
  const lookupLabel = (ev) => (ev.type === "search" ? `在知识库中搜索了“${ev.query}”`
    : ev.type === "read" ? `阅读：${ev.title} · ${ev.source}` : `为你打开：${ev.title}`);
  reasonStatus(false);
  if (firstLoad) note("正在把 AI 载入内存。第一次回答可能需要一分钟，风扇可能会转起来，这是正常的。");
  setBusy(new AbortController());
  scrollDown();
  try {
    if (!conversation) {
      conversation = (await (await api("/api/new", { method: "POST", body: "{}" })).json()).conversation;
    }
    const resp = await api("/api/chat", {
      method: "POST", signal: busy.signal,
      body: JSON.stringify({ conversation, model, message: text, reasoning: els.reasoning.value, length: els.length.value }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `错误 ${resp.status}`);
    for await (const ev of events(resp)) {
      if (ev.type !== "thinking") endThought();
      if (["search", "read", "show", "retry"].includes(ev.type)) {
        if (answer) { answer = ""; render(); }  // text before a lookup, or before it was asked again, is not the answer
        if (ev.type !== "retry") reasonStep(ev);
      }
      if (ev.type === "thinking") think(ev.text);
      else if (ev.type === "think_limit") {  // its reasoning reached the Reasoning limit; told to answer from what it had
        const said = `它的思考达到了上限（${Number(ev.limit).toLocaleString("zh-CN")} token），所以根据已有的内容作答。`;
        note(said);
        row("上限", "r-step").textContent = said;
      } else if (ev.type === "retry") {
        note(ev.why === "search" ? "它凭已知内容作答，所以按你的要求让它搜索了知识库。"
          : "它没有写出回答，所以把找到的最相关的文章交给它，让它再来一次。");
      } else if (ev.type === "memory_check") memoryChecking(msg, true);
      else if (ev.type === "memory") changes.push(showRemembered(remembered, ev));
      else if (ev.type === "memory_failed") memoryNote(remembered, "这次没能更新记忆。");
      else if (ev.type === "memory_unchanged") memoryNote(remembered, "记忆没有变化。你可以自己修改：", true);
      else if (ev.type === "search") note(lookupLabel(ev));
      else if (ev.type === "read") note(lookupLabel(ev), ev.id, "回答引用了这一段");
      else if (ev.type === "show") {
        note(lookupLabel(ev), ev.id, "回答指向这里");
        if (!narrow()) openArticle(ev.id, "回答指向这里");
      } else if (ev.type === "token") {
        answer += ev.text;
        if (!queued) { queued = true; requestAnimationFrame(render); }
      } else if (ev.type === "error" && answered) {
        memoryNote(remembered, "这次没能更新记忆。");  // the answer itself is fine
      } else if (ev.type === "error") {
        failed = true;
        meta.textContent = ev.message;
        meta.classList.add("error");
      } else if (ev.type === "done") {
        answered = true;  // a memory step may still follow
        unfinished = !!ev.unfinished;
        thinkSetting = ev.think;  // whether it was asked to reason first, for when it didn't
        reasonStatus(true);  // its reasoning for the answer is complete (the memory step's isn't shown)
        answer = ev.unfinished ? ev.answer || "" : ev.answer || answer;  // unfinished: what streamed isn't an answer
        render();
        showSources(sourcesEl, ev);
        const secs = Math.round((Date.now() - started) / 1000);
        meta.textContent = ev.cut_off
          ? `${nameOf(model)} 在 ${secs} 秒后被停止，因为回答达到了长度上限。可以点继续，或在下面调高上限。`
          : ev.unfinished
            ? (ev.sources?.length ? `${nameOf(model)} 没有写完回答。可以再问一次，或者打开下面它读过的文章。`
              : ev.seen?.length ? `${nameOf(model)} 没有写完回答。可以再问一次，或者打开下面的搜索结果之一。`
              : `${nameOf(model)} 没有写出回答。可以再问一次。`)
            : `由 ${nameOf(model)} 回答，用时 ${secs} 秒`;
        meta.title = ev.seconds ? `${ev.tokens} token，每秒 ${Math.round(ev.tokens / ev.seconds)} token` : "";
        if (ev.cut_off) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "ghost keep-going";
          more.textContent = "继续";
          more.onclick = () => { if (busy) return; more.remove(); ask("请从你中断的地方继续。"); };
          reasoning.after(more);
        }
        announce(`${nameOf(model)} 的回答已完成。`);
      }
    }
  } catch (err) {
    failed = true;
    if (err instanceof StaleTab) { /* banner shown */ }
    // Notes go in the meta line: a pending render() would wipe anything added to the answer itself.
    else if (err.name === "AbortError" && answered) {
      failed = false;
      if (remembered.querySelector(".memory-checking")) memoryNote(remembered, "已停止更新记忆。它已经保存的内容在“记忆”里。", true);
    } else if (err.name === "AbortError") { meta.textContent = "已停止。"; stopped = true; }
    else { meta.textContent = `没能得到回答：${err.message || err}`; meta.classList.add("error"); }
  } finally {
    clearInterval(tick);
    endThought();
    reasonStatus(true);
    memoryChecking(msg, false);
    if (changes.length) announce(changes.join(". "));
    summary.textContent = steps ? `查询过程（${steps} 步）` : "详情";
    how.open = false;
    if (!steps) how.hidden = true;
    answerEl.classList.remove("cursor");
    setBusy(null);
    if (failed) loadStatus();
    else if (!isLoaded(model)) state.loaded = [...(state.loaded || []), model.replace(/:latest$/, "")];
  }
}

function showSources(el, ev) {
  el.innerHTML = "";
  const read = ev.sources || [], seen = ev.seen || [];
  if (read.length) {
    el.insertAdjacentHTML("beforeend", `<div class="label">阅读过的来源 · 点击打开</div>`);
    for (const s of read) el.appendChild(sourceButton(s, "回答引用了这一段", true));
  } else if (seen.length) {
    el.insertAdjacentHTML("beforeend", `<div class="label">它搜索了，但没有打开其中任何一篇 · 点击阅读</div>`);
    for (const s of seen.slice(0, 5)) el.appendChild(sourceButton(s, "这条匹配了搜索", true));
  } else if (state?.library) {
    el.insertAdjacentHTML("beforeend", `<div class="memory-note">这个回答来自 AI 已知的内容，不是知识库，所以没有可核对的来源。想让它查来源，可以问“帮我查一下”。</div>`);
  } else {
    el.insertAdjacentHTML("beforeend", `<div class="memory-note">还没有安装知识库，所以这个回答来自 AI 已知的内容，没有可核对的来源。</div>`);
  }
  const rest = read.length ? seen : seen.slice(5);
  if (rest.length) {
    const more = document.createElement("details");
    more.className = "more";
    more.innerHTML = `<summary>其他搜索结果（${rest.length}）</summary>`;
    const wrap = document.createElement("div");
    wrap.className = "sources";
    for (const s of rest.slice(0, 15)) wrap.appendChild(sourceButton(s, "这条匹配了搜索", false));
    more.appendChild(wrap);
    el.appendChild(more);
  }
}

// After the answer, the AI takes a moment to update its notes about the person; Send waits for it.
function memoryChecking(msg, on) {
  msg.querySelector(".memory-checking")?.remove();
  if (on) msg.querySelector(".remembered").insertAdjacentHTML("beforeend", `<div class="memory-checking">正在更新记忆…</div>`);
}

function seeMemoryButton() {
  const see = document.createElement("button");
  see.type = "button";
  see.className = "link";
  see.textContent = "查看记忆";
  see.onclick = () => openMemory();
  return see;
}

// A short line about the memory step under the answer (it failed, or was stopped), optionally with See memory.
function memoryNote(el, text, withLink = false) {
  const row = document.createElement("div");
  row.className = "memory-saved";
  row.append(text);
  if (withLink) row.append(" ", seeMemoryButton());
  el.appendChild(row);
}

// A note the AI saved, changed or deleted after answering, with Undo and a way to see all of them. Returns its text.
function showRemembered(el, ev) {
  if (memoryDialog.open) memoryChangedWhileOpen();
  const row = document.createElement("div");
  row.className = "memory-saved";
  const text = document.createElement("span");
  const said = { add: `已记住：“${ev.note}”`, change: `已更新记忆：“${ev.note}”`, delete: `已忘记：“${ev.old}”`,
                 full: `记忆已满，没有保存“${ev.note}”。可以在“记忆”里删掉不需要的条目。` };
  text.textContent = said[ev.action] || "记忆已更改";
  if (ev.action === "full") {
    row.append(text, " ", seeMemoryButton());
    el.appendChild(row);
    return text.textContent;
  }
  const sep = document.createTextNode(" · ");
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "link";
  undo.textContent = "撤销";
  undo.onclick = async () => {
    undo.disabled = true;
    try {
      const resp = await api("/api/memory/undo", { method: "POST", body: JSON.stringify(ev) });
      if (!resp.ok) throw new Error();
      text.textContent = { add: `已撤销：它不会记住“${ev.note}”`, change: `已撤销：恢复为“${ev.old}”`,
                           delete: `已撤销：它重新记住了“${ev.old}”` }[ev.action];
      undo.remove();
      sep.remove();
    } catch (err) {
      if (!(err instanceof StaleTab)) {
        text.textContent = `${said[ev.action]}。这里无法撤销，可能是那条之后被改过；请在“记忆”里修改。`;
        undo.remove();
        sep.remove();
      } else undo.disabled = false;
    }
  };
  row.append(text, sep, undo, " · ", seeMemoryButton());
  el.appendChild(row);
  return text.textContent;
}

// ---------- reader ----------
function showReader(opener) {
  if (opener) lastFocus = opener;
  els.reader.hidden = false;
  els.layout.classList.add("with-reader");
}
function hideReader() {
  els.reader.hidden = true;
  els.layout.classList.remove("with-reader");
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

async function openArticle(id, how = "这条匹配了搜索", opener = null) {
  const request = ++readerRequest;
  showReader(opener);
  els.readerBody.innerHTML = `<p class="meta">正在打开…</p>`;
  let doc;
  try {
    const resp = await api(`/api/article?id=${encodeURIComponent(id)}`);
    if (!resp.ok) throw new Error();
    doc = await resp.json();
  } catch {
    if (request === readerRequest) els.readerBody.innerHTML = `<p class="error">无法打开那个来源。</p>`;
    return;
  }
  if (request !== readerRequest) return;  // a newer source was opened meanwhile
  let html = `<div class="doc-head"><h2 id="doc-title" tabindex="-1">${esc(doc.title)}</h2>
    <div class="src-line">${esc(doc.source)}${doc.official ? ' <span class="official" title="由政府或卫生机构发布。它们并不为这款应用背书。">官方</span>' : ""}${doc.url ? " · " + esc(doc.url) : ""}</div>
    ${doc.license ? `<div class="src-line license">许可协议：${linkify(doc.license)}</div>` : ""}</div>`;
  for (const part of doc.parts) {
    const cited = part.id === doc.focus;
    html += `<section class="${cited ? "cited" : ""}">${cited ? `<div class="cited-label">${esc(how)}</div>` : ""}${md(part.text)}</section>`;
  }
  els.readerBody.innerHTML = html;
  const target = els.readerBody.querySelector("section.cited");
  if (target && doc.parts[0].id !== doc.focus) {
    target.style.scrollMarginTop = `${els.readerBody.querySelector(".doc-head").offsetHeight + 8}px`;  // clear of the sticky title
    target.scrollIntoView({ block: "start" });
  }
  else els.readerBody.scrollTop = 0;
  if (opener) $("doc-title").focus({ preventScroll: true });
}

async function searchLibrary(q) {
  const request = ++readerRequest;
  showReader(els.search);
  els.readerBody.innerHTML = `<p class="meta">正在搜索…</p>`;
  let results = [];
  try { results = (await (await api(`/api/search?q=${encodeURIComponent(q)}`)).json()).results; } catch { /* below */ }
  if (request !== readerRequest) return;
  els.readerBody.innerHTML = results.length
    ? `<p class="meta">“${esc(q)}”的 ${results.length} 条结果</p>` + results.map((r) => `<button type="button" class="result" data-id="${r.id}">
        <span class="r-title">${esc(r.title)}</span><span class="r-src">${esc(r.source)}${r.official ? ' <span class="official" title="由政府或卫生机构发布。它们并不为这款应用背书。">官方</span>' : ""}</span>
        <span class="r-snip">${esc(r.snippet)}</span></button>`).join("")
    : `<p class="meta">没有找到与“${esc(q)}”相关的内容。试试更少或不同的词。</p>`;
  for (const el of els.readerBody.querySelectorAll(".result")) el.onclick = () => openArticle(+el.dataset.id, "这条匹配了你的搜索", el);
}

// ---------- wiring ----------
function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
}
els.composer.onsubmit = (e) => {
  e.preventDefault();
  if (busy) { busy.abort(); return; }  // the button reads "Stop" while an answer streams
  const text = els.input.value;
  els.input.value = "";
  autosize();
  ask(text);
};
els.input.onkeydown = (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (!busy) els.composer.requestSubmit();  // Enter never stops an answer; only the Stop button does
};
els.input.oninput = autosize;
for (const b of document.querySelectorAll(".example")) b.onclick = () => ask(b.textContent);
els.length.value = recall("length") || "normal";
els.reasoning.value = recall("reasoning") || "off";
if (!els.reasoning.value) els.reasoning.value = "off";  // a value saved by a version with other choices
const lengthNote = () => {  // warns when a limit is off: a stuck model then runs until Stop
  const lines = [];
  if (els.reasoning.value === "none") lines.push("不限制推理时，模型可能陷入循环思考，一直停不下来，直到你按停止。");
  if (els.length.value === "none") lines.push("不限制长度时，模型可能不断重复自己，一直停不下来，直到你按停止。");
  $("length-note").textContent = lines.join(" ");
  $("length-note").hidden = !lines.length;
};
els.length.onchange = () => { remember("length", els.length.value); lengthNote(); };
els.reasoning.onchange = () => { remember("reasoning", els.reasoning.value); lengthNote(); };
lengthNote();
els.searchForm.onsubmit = (e) => { e.preventDefault(); if (els.search.value.trim()) searchLibrary(els.search.value.trim()); };
els.libraryBtn.onclick = () => { showReader(els.libraryBtn); els.search.focus(); };
$("close-reader").onclick = hideReader;
els.reader.onkeydown = (e) => { if (e.key === "Escape") hideReader(); };
$("new-chat").onclick = () => { newChat(); els.input.focus(); };
$("model-btn").onclick = openModels;
$("close-models").onclick = () => els.dialog.close();

// ---------- the person's own files ----------
const FILE_TYPES = [".pdf", ".docx", ".odt", ".epub", ".html", ".htm", ".txt", ".md", ".markdown", ".csv"];
const CANT_READ = "Survival LLM 读不了这种文件。它能读 PDF、Word、EPUB、网页和纯文本文件。";
const filesDialog = $("files-dialog");
let myFiles = null;        // last /api/myfiles
let filesTimer = null, filesSig = "", filesChecks = 0, adding = 0;
let fileNotes = [];        // what happened to the files just added or removed: {text, error}
let addedNames = [];       // files added since the window opened, reported in one line
let fileAsks = [];         // files whose name is taken, waiting for Replace it or Keep both: {file, name}

const readable = (name) => FILE_TYPES.some((t) => name.toLowerCase().endsWith(t));
const trashName = () => (state?.machine.os === "Windows" ? "回收站" : "废纸篓");

function openFiles() {
  fileNotes = [];
  addedNames = [];
  filesSig = "";
  if (!filesDialog.open) filesDialog.showModal();
  refreshFiles(true);
}

async function refreshFiles(check = false) {
  clearTimeout(filesTimer);
  try { myFiles = await (await api(`/api/myfiles${check ? "?check=1" : ""}`)).json(); } catch { return; }
  if (check) filesChecks = 3;  // the check runs in the background, so look again a few times
  renderFiles();
  if (filesDialog.open && (myFiles.busy || adding || filesChecks-- > 0)) filesTimer = setTimeout(refreshFiles, 1000);
  else loadStatus();  // the count at the top
}

function renderFiles() {
  const f = myFiles || { items: [] };
  $("files-status").textContent = adding ? `正在添加 ${adding} 个文件…`
    : f.busy && f.doing ? `正在读取 ${f.doing}（第 ${f.done + 1}/${f.total} 个）… 大文件需要一两分钟。` : "";
  const added = addedNames.length > 3 ? `${addedNames.slice(0, 3).join("、")} 等另外 ${addedNames.length - 3} 个文件` : addedNames.join("、");
  $("files-notes").innerHTML = (added ? `<p class="meta">已添加 ${esc(added)}。</p>` : "")
    + fileNotes.map((n) => `<p class="${n.error ? "error" : "meta"}">${esc(n.text)}</p>`).join("");
  $("files-ask").hidden = !fileAsks.length;
  if (fileAsks.length) $("files-ask-text").textContent = `你已经有一个叫“${fileAsks[0].name}”的文件了。要用这个替换它吗？`;
  $("files-folder").textContent = f.folder
    ? `它们保存在 ${f.folder} 里。放进或改动那个文件夹的文件会被自动识别。` : "";
  const sig = JSON.stringify(f.items);
  if (sig === filesSig) return;  // rebuilding the list would undo a half-confirmed Remove
  filesSig = sig;
  $("files-list").innerHTML = f.items.length ? f.items.map((it) => `<li>
      <div class="f-main"><div class="f-title">${esc(it.title || it.name)}</div>
        <div class="meta">${it.title && it.title !== it.name ? `${esc(it.name)} · ` : ""}${it.status === "ready" ? "就绪：AI 会搜索它" : "AI 无法搜索这个文件"}</div>
        ${it.error ? `<div class="error">${esc(it.error)}</div>` : ""}</div>
      <button class="ghost" type="button" data-name="${esc(it.name)}">移除</button></li>`).join("")
    : `<li class="empty meta">还没有文件。</li>`;
  for (const b of $("files-list").querySelectorAll("button[data-name]")) b.onclick = () => removeFile(b.dataset.name, b);
}

async function sendFile(file, how = "") {  // how: "" (ask if the name is taken), "&keep=1" or "&replace=<name>"
  adding++;
  renderFiles();
  try {
    const resp = await api(`/api/myfiles/add?name=${encodeURIComponent(file.name)}${how}`,
      { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" } });
    const out = await resp.json();
    if (resp.status === 409) fileAsks.push({ file, name: out.name || file.name });
    else if (!resp.ok) fileNotes.push({ error: true, text: `${file.name}：${out.error || "无法添加。"}` });
    else if (out.duplicate || out.unchanged) fileNotes.push({ text: `${out.name} 已经在你的文件里了。` });
    else if (out.replaced) fileNotes.push({ text: `已用新版本替换 ${out.replaced}。旧文件在${trashName()}里。` });
    else addedNames.push(out.name);
  } catch (err) {
    if (!(err instanceof StaleTab)) fileNotes.push({ error: true, text: `${file.name}：无法添加。Survival LLM 还在运行吗？` });
  } finally {
    adding--;
    renderFiles();
  }
}

async function addFiles(list, notes = []) {
  const chosen = [...list];
  if (!filesDialog.open) openFiles();
  fileNotes.push(...notes);
  const taken = new Set((myFiles?.items || []).map((it) => it.name));
  for (const file of chosen) {
    if (!readable(file.name)) fileNotes.push({ error: true, text: `${file.name}: ${CANT_READ}` });
    else if (taken.has(file.name)) fileAsks.push({ file, name: file.name });
    else await sendFile(file);
  }
  renderFiles();
  refreshFiles(true);
}

async function answerAsk(how) {
  const ask = fileAsks.shift();
  renderFiles();
  if (ask && how) await sendFile(ask.file, how === "replace" ? `&replace=${encodeURIComponent(ask.name)}` : "&keep=1");
  refreshFiles(true);
}

async function removeFile(name, btn) {
  if (!confirmClick(btn, `再点一次会把它移到${trashName()}`)) return;
  try {
    const resp = await api("/api/myfiles/remove", { method: "POST", body: JSON.stringify({ name }) });
    fileNotes.push(resp.ok ? { text: `已移除 ${name}。它现在在${trashName()}里，需要的话可以取回。` }
      : { error: true, text: (await resp.json()).error });
  } catch { /* a stale page shows its own banner */ }
  refreshFiles(true);
}

$("files-btn").onclick = openFiles;
$("close-files").onclick = () => filesDialog.close();
filesDialog.onclick = (e) => { if (e.target === filesDialog) filesDialog.close(); };
filesDialog.addEventListener("close", () => clearTimeout(filesTimer));
$("choose-files").onclick = () => $("file-input").click();
$("file-input").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
$("open-folder").onclick = () => api("/api/myfiles/open", { method: "POST", body: "{}" }).catch(() => {});
$("files-move").onclick = async () => {
  const folder = await chooseFolder(myFiles?.folder || state?.files_dir, "你的文件在哪个文件夹里？");
  if (!folder) return;
  const resp = await api("/api/myfiles/folder", { method: "POST", body: JSON.stringify({ folder }) }).catch(() => null);
  const out = resp ? await resp.json().catch(() => ({})) : {};
  $("files-move-status").textContent = !resp ? "" : resp.ok
    ? "Survival LLM 现在会搜索那个文件夹里的文件。旧文件夹里的文件仍留在原处。"
    : out.error || "无法使用那个文件夹。";
  $("files-move-status").className = resp && !resp.ok ? "error" : "meta";
  filesSig = "";
  refreshFiles(true);
};
$("ask-replace").onclick = () => answerAsk("replace");
$("ask-keep").onclick = () => answerAsk("keep");
$("ask-skip").onclick = () => answerAsk(null);

// Files dropped anywhere on the window are added to Your files (instead of the window opening them).
const dragsFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
let dragDepth = 0;
function showDrop(on) {
  $("drop-overlay").hidden = !on || filesDialog.open;
  $("dropzone").classList.toggle("over", on && filesDialog.open);
}
document.addEventListener("dragenter", (e) => { if (dragsFiles(e)) { e.preventDefault(); dragDepth++; showDrop(true); } });
document.addEventListener("dragover", (e) => { if (dragsFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
document.addEventListener("dragleave", (e) => { if (dragsFiles(e) && --dragDepth <= 0) { dragDepth = 0; showDrop(false); } });
document.addEventListener("drop", (e) => {
  if (!dragsFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  showDrop(false);
  const folders = new Set([...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter((en) => en?.isDirectory).map((en) => en.name));
  addFiles([...e.dataTransfer.files].filter((f) => !folders.has(f.name)), [...folders].map((name) =>
    ({ error: true, text: `${name} 是个文件夹。要添加整个文件夹，请点“打开文件夹”并把文件放进去。` })));
});

// ---------- updates ----------
const updatesDialog = $("updates-dialog");
let updateReport = null, updateChecking = false, updatesSig = "";
const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("zh-CN", { dateStyle: "medium" });
const size = (gb) => (Number(gb) < 1 ? `${Math.round(Number(gb) * 1000)} MB` : `${Number(gb)} GB`);
let updateError = "";

function renderVersion() {
  $("version-line").hidden = !state.version;
  $("version-text").textContent = `Survival LLM ${state.version}` + (state.dev ? ` · 开发副本：${state.dev}` : "");
  $("dev-badge").hidden = !state.dev;  // a copy for trying changes before they ship (bin/dev)
  $("dev-badge").title = state.dev ? `开发副本：${state.dev}` : "";
  const app = state.update?.app, lib = state.update?.library;
  $("updates-btn").textContent = app || lib ? "有可用更新" : "检查更新";
  // A new version of the app first; after that (or once it's dismissed), a newer library, which is optional: the one
  // installed keeps working, and Not now hides the offer until the next library comes out.
  const showApp = app && recall("update-dismissed") !== app;
  const showLib = !showApp && lib && !busyJob(jobFor(`library:${lib.id}`)) && recall("library-dismissed") !== lib.version;
  $("update-banner").hidden = !showApp && !showLib;
  $("update-banner").dataset.kind = showApp ? "app" : showLib ? "library" : "";
  if (showApp) $("update-banner").querySelector(".update-text").textContent = `Survival LLM ${app} 已发布。`;
  if (showLib) {
    $("update-banner").querySelector(".update-text").textContent = `有更新版本的知识库。`
      + (lib.notes ? ` ${lib.notes}` : "") + ` 下载量 ${size(lib.gb)}，新的装好之前你现在这个继续可用。`;
  }
  if (updatesDialog.open) renderUpdates();
}

async function openUpdates(check) {
  updatesSig = "";
  if (!updatesDialog.open) updatesDialog.showModal();
  updateChecking = true;
  renderUpdates();
  try { updateReport = await (await api(`/api/updates${check ? "?check=1" : ""}`)).json(); } catch { /* shown below */ }
  updateChecking = false;
  renderUpdates();
  loadStatus();
}

function renderUpdates() {
  const r = updateReport;
  const busy = (job) => job && ["starting", "downloading", "unpacking"].includes(job.status);
  let html;
  if (updateChecking) html = `<p class="meta">正在检查更新…</p>`;
  else if (!r) html = `<p class="error">无法检查更新。Survival LLM 还在运行吗？</p>`;
  else {
    html = r.failed ? `<p class="error">上一次更新没能安装（${esc(r.failed)}）。你用的仍是 ${esc(r.version)} 版本。</p>` : "";
    const job = jobFor("app-update");
    if (r.app) {
      const a = r.app;
      html += `<h3>Survival LLM ${esc(a.version)} 已发布</h3>
        <p class="meta">你用的是 ${esc(r.version)}。${a.date ? `发布于 ${esc(day(a.date))}。` : ""}下载量 ${size(a.gb)}。</p>`;
      if (Array.isArray(a.notes) && a.notes.length) html += `<ul class="notes">${a.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
        + `<p class="meta">（发行说明为英文原文）</p>`;
      if (busy(job)) html += progressHTML(job, `正在下载 Survival LLM ${esc(a.version)}`, "更新下载");
      else if (job?.status === "done") html += `<p>已安装。Survival LLM 正在重启到新版本…</p>`;
      else if (a.blocker) html += `<p>${esc(a.blocker)}</p>
        <p><a href="${esc(r.download_page)}" target="_blank" rel="noopener">从网站获取新版本</a></p>`;
      else html += `${job?.status === "error" || updateError ? `<p class="error">${esc(updateError || job.error)}</p>` : ""}
        <button class="primary" type="button" id="install-update">立即更新</button>
        <p class="meta">Survival LLM 会下载新版本，关闭，几秒后重新打开。你的 AI 模型、知识库、文件和设置都保持不变。</p>`;
    } else if (r.error) {
      html += `<p>${r.error === "offline" ? "无法检查更新（可能是没有联网）。" : "暂时无法检查更新。"}
        没有更新也不影响 Survival LLM 使用。你用的是 ${esc(r.version)} 版本。</p>`;
    } else {
      html += `<p>你用的是最新版本（${esc(r.version)}）。</p>`;
    }
    if (r.library) {
      const lib = jobFor(`library:${r.library.id}`);
      html += `<h3>有更新版本的知识库</h3>${r.library.notes ? `<p>${esc(r.library.notes)}</p>` : ""}
        <p class="meta">${esc(packNames[r.library.id]?.name || r.library.label)}，发布于 ${esc(day(r.library.version))}。</p>`;
      if (busy(lib)) html += progressHTML(lib, "正在下载新的知识库", "知识库更新");
      else if (lib?.status === "done") html += `<p>你的知识库已是最新。</p>`;
      else html += `${lib?.status === "error" ? `<p class="error">${esc(lib.error)}</p>` : ""}
        <button class="ghost" type="button" id="update-library">更新知识库（${esc(size(r.library.gb))}）</button>
        <p class="meta">新的知识库就绪前，当前知识库继续可用，你自己的文件不受影响。</p>`;
    }
    if (state?.library) html += `<p class="meta">要在必备包（Essentials）和全量包（Everything）之间切换，或移动知识库：
      <button class="link" type="button" id="updates-library">知识库窗口</button>。</p>`;
    if (r.checked) html += `<p class="meta">上次检查：${esc(new Date(r.checked * 1000).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }))}。</p>`;
  }
  if (html === updatesSig) return;  // rebuilding an unchanged window would knock keyboard focus off its buttons
  updatesSig = html;
  $("updates-body").innerHTML = html;
  if ($("install-update")) $("install-update").onclick = installUpdate;
  if ($("update-library")) $("update-library").onclick = () => startLibraryDownload(r.library.id);
  if ($("updates-library")) $("updates-library").onclick = () => { updatesDialog.close(); openLibrary(); };
}

async function installUpdate() {
  updateError = "";
  try {
    const resp = await api("/api/update/app", { method: "POST", body: "{}" });
    if (resp.ok) restarting = true;
    else updateError = (await resp.json()).error || "更新无法开始。请重试。";
  } catch { return; }
  renderUpdates();
  loadStatus();
}

$("updates-btn").onclick = () => openUpdates(true);
$("close-updates").onclick = () => updatesDialog.close();
updatesDialog.onclick = (e) => { if (e.target === updatesDialog) updatesDialog.close(); };
$("banner-update").onclick = () => openUpdates(false);
$("banner-dismiss").onclick = () => {
  if ($("update-banner").dataset.kind === "library") remember("library-dismissed", state?.update?.library?.version || "");
  else remember("update-dismissed", state?.update?.app || "");
  $("update-banner").hidden = true;
  renderVersion();  // the library's offer can show next
};

// ---------- memory: the AI's notes about the person, viewable and editable ----------
const memoryDialog = $("memory-dialog");
let memoryBase = "", memoryMax = 6000;  // memoryBase: the notes as last loaded or saved
const noteLines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);

function memoryCount() {
  const lines = noteLines($("memory-text").value);
  const chars = lines.reduce((n, l) => n + l.length + 1, 0);
  const over = chars > memoryMax;
  $("memory-count").textContent = lines.length
    ? `${lines.length} 条 · ${chars.toLocaleString("zh-CN")} / ${memoryMax.toLocaleString("zh-CN")} 字符`
    : "";
  $("memory-count").classList.toggle("error", over);
  $("memory-save").disabled = over;
}

// Edits not yet saved are kept when the window closes, and are there again when it reopens.
const memoryEdited = () => $("memory-text").value.trim() !== memoryBase.trim();

async function openMemory() {
  $("memory-status").textContent = "";
  try {
    const m = await (await api("/api/memory")).json();
    memoryMax = m.max_chars;
    $("memory-writes").checked = m.ai_writes;
    if (memoryEdited()) {
      $("memory-status").textContent = "这些是你未保存的修改。保存会保留它们，同时保留 AI 在此期间所做的改动。";
    } else {
      memoryBase = m.text;
      $("memory-text").value = m.text;
    }
  } catch (err) {
    if (!(err instanceof StaleTab)) $("memory-status").textContent = "无法读取记忆。";
  }
  memoryCount();
  if (!memoryDialog.open) memoryDialog.showModal();
}

// The AI changed its notes while the window is open: show them if nothing was edited, else say Save will merge.
async function memoryChangedWhileOpen() {
  if (!memoryEdited()) return openMemory();
  $("memory-status").textContent = "AI 刚刚改动了条目。保存会同时保留你的修改和它的改动。";
}

async function saveMemory(text, done) {
  $("memory-status").textContent = "正在保存…";
  try {
    const resp = await api("/api/memory", { method: "POST", body: JSON.stringify({ text, base: memoryBase }) });
    const m = await resp.json();
    if (!resp.ok) { $("memory-status").textContent = m.error || "无法保存。"; return; }
    memoryBase = m.text;
    $("memory-text").value = m.text;
    const n = (k) => `${k} 条`;
    const kept = m.kept.length ? ` 同时保留了你编辑期间 AI 保存的 ${n(m.kept.length)}。` : "";
    const dropped = m.dropped.length ? ` 未包含 AI 在此期间删除或改动的 ${n(m.dropped.length)}。` : "";
    $("memory-status").textContent = done + kept + dropped;
  } catch (err) {
    $("memory-status").textContent = err instanceof StaleTab
      ? "未保存：Survival LLM 已重启。请先复制你的修改，然后重新加载页面。"
      : "无法保存。Survival LLM 还在运行吗？";
  }
  memoryCount();
}

$("memory-btn").onclick = openMemory;
$("close-memory").onclick = () => memoryDialog.close();
$("memory-text").oninput = memoryCount;
$("memory-save").onclick = () => saveMemory($("memory-text").value, "已保存。从你的下一个问题开始生效。");
$("memory-clear").onclick = (e) => {
  if (!confirmClick(e.currentTarget, "再点一次会删除所有条目")) return;
  saveMemory("", "已删除所有条目。");
};
$("memory-writes").onchange = async (e) => {
  const on = e.target.checked;
  try {
    const resp = await api("/api/memory/ai-writes", { method: "POST", body: JSON.stringify({ on }) });
    const m = await resp.json();
    if (!resp.ok) { e.target.checked = !on; $("memory-status").textContent = m.error || "无法更改。"; return; }
    e.target.checked = m.ai_writes;
    $("memory-status").textContent = m.ai_writes ? "AI 可以再次添加和修改条目了。"
      : "AI 现在不会添加或修改条目。它仍然会读取这里的条目。";
  } catch (err) {
    e.target.checked = !on;
    if (!(err instanceof StaleTab)) $("memory-status").textContent = "无法更改。Survival LLM 还在运行吗？";
  }
};

// ---------- the AI's instructions, viewable and editable ----------
let promptDefault = "";
$("prompt-btn").onclick = async () => {
  $("prompt-status").textContent = "";
  try {
    const p = await (await api("/api/prompt")).json();
    promptDefault = p.default;
    $("prompt-text").value = p.custom || p.default;
    $("prompt-status").textContent = p.custom ? "正在使用你修改过的指令。" : "正在使用原始指令。";
  } catch {
    $("prompt-status").textContent = "无法读取指令。";
  }
  $("prompt-dialog").showModal();
};
async function savePrompt(body, done) {
  try {
    const p = await (await api("/api/prompt", { method: "POST", body: JSON.stringify(body) })).json();
    $("prompt-text").value = p.custom || promptDefault;
    $("prompt-status").textContent = done;
  } catch {
    $("prompt-status").textContent = "无法保存。Survival LLM 还在运行吗？";
  }
}
$("prompt-save").onclick = () => {
  const text = $("prompt-text").value.trim();
  savePrompt(text === promptDefault.trim() ? { reset: true } : { text }, "已保存。从你的下一个问题开始生效。");
};
$("prompt-reset").onclick = () => savePrompt({ reset: true }, "已恢复为原始指令。");
$("close-prompt").onclick = () => $("prompt-dialog").close();
els.dialog.onclick = (e) => { if (e.target === els.dialog) els.dialog.close(); };  // click outside closes
$("quit").onclick = async (e) => {
  if (!confirmClick(e.currentTarget, "再点一次退出")) return;
  try { await api("/api/quit", { method: "POST", body: "{}" }); } catch { /* already stopped */ }
  clearTimeout(pollTimer);
  document.body.innerHTML = `<div class="welcome" style="max-width:640px;margin:10vh auto;padding:0 16px">
    <h1>Survival LLM 已停止。</h1><p>可以关闭这个窗口了。要再次使用，请重新打开 Survival LLM。</p></div>`;
};
loadStatus();
els.input.focus();
