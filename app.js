const DB_NAME = "life-workbench-local";
const DB_VERSION = 1;
const STORE_ENTRIES = "entries";
const STORE_RESUMES = "resumes";
const INSTALL_DISMISSED_KEY = "life-workbench-install-dismissed";

const modules = [
  { id: "daily", icon: "✓", title: "每日拾光印记", desc: "只记录已经完成的事" },
  { id: "inspiration", icon: "✦", title: "细碎灵感备忘录", desc: "快速抓住点子和素材" },
  { id: "metaphysics", icon: "☉", title: "玄学研习档案馆", desc: "学习、案例、塔罗/八字资料" },
  { id: "study", icon: "A", title: "全科精进学习库", desc: "学习时长、掌握情况、复习" },
  { id: "viral", icon: "🔥", title: "爆款内容解构库", desc: "离线模板拆钩子和结构" },
  { id: "resume", icon: "CV", title: "简历修改库", desc: "PDF/Word 解析与岗位定制" },
];

let db;
let tarotCards = [];
let baziSeed = null;
let activeLibrary = "tarot";
let deferredInstallPrompt = null;
let lastResumeText = "";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 2200);
}

function escapeHTML(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_ENTRIES)) {
        const store = database.createObjectStore(STORE_ENTRIES, { keyPath: "id" });
        store.createIndex("type", "type");
        store.createIndex("date", "date");
        store.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(STORE_RESUMES)) {
        const store = database.createObjectStore(STORE_RESUMES, { keyPath: "id" });
        store.createIndex("kind", "kind");
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readwrite").put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

function remove(storeName, id) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function saveEntry(type, title, payload = {}) {
  const entry = {
    id: uid(),
    type,
    title: title || "未命名记录",
    date: payload.date || todayISO(),
    createdAt: Date.now(),
    payload,
  };
  await put(STORE_ENTRIES, entry);
  toast("已保存");
  await renderAll();
  return entry;
}

function formToObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  $$("input[type='checkbox']", form).forEach(input => data[input.name] = input.checked);
  return data;
}

function resetForm(form) {
  form.reset();
  const dateInput = $("input[type='date']", form);
  if (dateInput) dateInput.value = todayISO();
}

async function loadStaticData() {
  const [tarot, bazi] = await Promise.all([
    fetch("assets/tarot-card-library.json").then(r => r.json()),
    fetch("assets/bazi-resource-seed.json").then(r => r.json()),
  ]);
  tarotCards = tarot.cards || [];
  baziSeed = bazi;
}

function setupNavigation() {
  const grid = $("#moduleGrid");
  grid.innerHTML = modules.map(m => `
    <button class="module-card" data-view="${m.id}" type="button">
      <span class="module-icon">${m.icon}</span>
      <strong>${m.title}</strong>
      <span>${m.desc}</span>
    </button>
  `).join("");

  $$("[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function switchView(viewId) {
  $$(".view").forEach(v => v.classList.toggle("active", v.id === viewId));
  $$(".bottom-nav button").forEach(b => b.classList.toggle("active", b.dataset.view === viewId));
  const title = $(`#${viewId}`)?.dataset.title || "生活学习工作台";
  document.title = `${title} · 生活学习工作台`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupForms() {
  $("#dailyForm").addEventListener("submit", async e => {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    await saveEntry("daily", d.title, d);
    resetForm(e.currentTarget);
  });

  $("#inspirationForm").addEventListener("submit", async e => {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    await saveEntry("inspiration", d.content.slice(0, 28) || "灵感", d);
    resetForm(e.currentTarget);
  });

  $("#metaLearnForm").addEventListener("submit", async e => {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    await saveEntry("meta-learn", d.topic, d);
    resetForm(e.currentTarget);
  });

  $("#tarotCaseForm").addEventListener("submit", async e => {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    await saveEntry("tarot-case", d.question, d);
    resetForm(e.currentTarget);
  });

  $("#studyForm").addEventListener("submit", async e => {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    await saveEntry("study", d.topic, d);
    if (d.syncDaily) {
      await saveEntry("daily", `学习：${d.topic}`, {
        title: `学习：${d.topic}`,
        category: "学习",
        importance: "中",
        result: `完成 ${d.category}「${d.topic}」学习 ${d.minutes || 0} 分钟，掌握情况：${d.mastery || "未填写"}`,
        materials: d.content || "",
        next: "由学习库自动同步",
      });
    }
    resetForm(e.currentTarget);
  });

  $("#viralForm").addEventListener("submit", async e => {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    await saveEntry("viral", d.title, d);
    resetForm(e.currentTarget);
  });

  $("#resumeVersionForm").addEventListener("submit", async e => {
    e.preventDefault();
    const d = formToObject(e.currentTarget);
    await generateResumeVersion(d);
    resetForm(e.currentTarget);
  });
}

function setupMetaTabs() {
  $$(".seg").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".seg").forEach(b => b.classList.toggle("active", b === btn));
      $$(".meta-pane").forEach(p => p.classList.toggle("active", p.dataset.metaPane === btn.dataset.metaTab));
      if (btn.dataset.metaTab === "library") renderLibrary();
    });
  });

  $$(".lib-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeLibrary = btn.dataset.lib;
      $$(".lib-tab").forEach(b => b.classList.toggle("active", b === btn));
      renderLibrary();
    });
  });
  $("#tarotSearch").addEventListener("input", () => renderLibrary());
  $("#addResourceBtn").addEventListener("click", addCustomResource);
}

async function addCustomResource() {
  const title = prompt("资料标题");
  if (!title) return;
  const category = prompt("资料分类（如紫薇斗数 / 风水研习 / 星盘解读）", "风水研习") || "未分类";
  const summary = prompt("简化解释或原文摘录") || "";
  await saveEntry("custom-resource", title, { title, category, summary });
  activeLibrary = "custom";
  $$(".lib-tab").forEach(b => b.classList.toggle("active", b.dataset.lib === "custom"));
  renderLibrary();
}

async function setupResumeTools() {
  $("#parseResumeBtn").addEventListener("click", async () => {
    const file = $("#resumeFile").files?.[0];
    if (!file) {
      toast("请先选择 PDF 或 Word 文件");
      return;
    }
    toast("正在解析简历...");
    try {
      const text = await parseResumeFile(file);
      $("#resumeText").value = text;
      await saveRawResume(text, file.name);
      toast("原始简历已解析并保存");
    } catch (err) {
      console.error(err);
      toast("解析失败，可复制文本后手动保存");
    }
  });

  $("#saveRawResumeBtn").addEventListener("click", async () => {
    const text = $("#resumeText").value.trim();
    if (!text) {
      toast("请先粘贴或解析简历文本");
      return;
    }
    await saveRawResume(text, "手动文本");
    toast("原始简历已保存");
  });

  $("#downloadResumeBtn").addEventListener("click", () => {
    if (!lastResumeText) {
      toast("请先选择或生成一个简历版本");
      return;
    }
    downloadText(`定制简历-${todayISO()}.txt`, lastResumeText);
  });
}

async function parseResumeFile(file) {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdfText(buffer);
  }
  if (name.endsWith(".docx")) {
    if (!window.mammoth) throw new Error("Word 解析库未加载");
    const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
    return (result.value || "").trim();
  }
  if (name.endsWith(".txt") || file.type.startsWith("text/")) {
    return new TextDecoder("utf-8").decode(buffer).trim();
  }
  throw new Error("当前浏览器端仅稳定支持 PDF、docx 和 txt");
}

async function extractPdfText(buffer) {
  const pdfjs = await import("./vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  const maxPages = Math.min(pdf.numPages, 30);
  for (let i = 1; i <= maxPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(" "));
  }
  return pages.join("\n\n").trim();
}

async function saveRawResume(text, fileName) {
  await put(STORE_RESUMES, {
    id: uid(),
    kind: "raw",
    title: `原始简历｜${fileName}`,
    text,
    fileName,
    createdAt: Date.now(),
  });
  await renderAll();
}

async function getLatestRawResume() {
  const all = (await getAll(STORE_RESUMES))
    .filter(r => r.kind === "raw")
    .sort((a, b) => b.createdAt - a.createdAt);
  return all[0];
}

function extractKeywords(jd) {
  const stop = new Set(["负责", "岗位", "要求", "工作", "能力", "相关", "优先", "具备", "熟悉", "以及", "进行", "可以", "需要", "以上"]);
  const words = jd
    .replace(/[，。；、,.！!？?（）()【】\[\]\n\r]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !stop.has(w));
  const count = new Map();
  words.forEach(w => count.set(w, (count.get(w) || 0) + 1));
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);
}

async function generateResumeVersion(job) {
  const raw = await getLatestRawResume();
  const manualText = $("#resumeText").value.trim();
  const sourceText = raw?.text || manualText;
  if (!sourceText) {
    toast("请先保存一份原始简历");
    return;
  }
  const keywords = extractKeywords(job.jd);
  const matched = keywords.filter(k => sourceText.includes(k));
  const missing = keywords.filter(k => !sourceText.includes(k));
  const company = job.company ? `｜${job.company}` : "";
  const title = `${job.role}${company}｜${todayISO()}｜v1`;
  const revised = [
    title,
    "",
    "【岗位定制摘要】",
    `目标岗位：${job.role}${company}`,
    `匹配关键词：${matched.length ? matched.join("、") : "暂无明显命中关键词"}`,
    `建议补强关键词：${missing.length ? missing.join("、") : "暂无"}`,
    "",
    "【建议突出能力】",
    buildStrengthBullets(keywords, sourceText),
    "",
    "【修改原则】",
    "不虚构经历；优先调整表达顺序、关键词密度和成果表达。将经历尽量改成“动作 + 方法 + 结果”的句式。",
    "",
    "【定制简历正文】",
    sourceText,
    "",
    "【投递前自检】",
    "1. 是否把最匹配岗位的经历放在前半部分。",
    "2. 是否把岗位 JD 中高频关键词自然放进经历描述。",
    "3. 是否把“负责/参与”改成更具体的动作和结果。",
  ].join("\n");

  const item = {
    id: uid(),
    kind: "version",
    title,
    text: revised,
    role: job.role,
    company: job.company || "",
    jd: job.jd,
    keywords,
    matched,
    missing,
    status: "可投递",
    createdAt: Date.now(),
  };
  await put(STORE_RESUMES, item);
  lastResumeText = revised;
  toast("已生成并保存定制简历");
  await renderAll();
}

function buildStrengthBullets(keywords, resumeText) {
  if (!keywords.length) return "- 请补充岗位 JD 后生成更精准的修改建议。";
  const lines = keywords.slice(0, 6).map(k => {
    const hit = resumeText.includes(k);
    return `- ${k}：${hit ? "原简历已有相关表达，可前置或加粗突出。" : "原简历未明显出现，若经历真实相关，建议补充具体项目或成果。"}`;
  });
  return lines.join("\n");
}

async function renderAll() {
  const [entries, resumes] = await Promise.all([getAll(STORE_ENTRIES), getAll(STORE_RESUMES)]);
  const sorted = entries.sort((a, b) => b.createdAt - a.createdAt);
  renderStats(sorted, resumes);
  renderEntries(sorted);
  renderResumes(resumes.sort((a, b) => b.createdAt - a.createdAt));
  renderLibrary();
}

function renderStats(entries, resumes) {
  $("#todayText").textContent = new Date().toLocaleDateString("zh-CN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  $("#statToday").textContent = entries.filter(e => e.date === todayISO()).length;
  const studyMinutes = entries
    .filter(e => e.type === "study" && e.date === todayISO())
    .reduce((sum, e) => sum + Number(e.payload.minutes || 0), 0);
  $("#statStudy").textContent = `${(studyMinutes / 60).toFixed(1)}h`;
  $("#statResume").textContent = resumes.filter(r => r.kind === "version").length;
}

function renderEntries(entries) {
  const recent = entries.slice(0, 8);
  $("#recentList").innerHTML = recent.length ? recent.map(recordHTML).join("") : "暂无记录";
  $("#recentList").classList.toggle("empty", !recent.length);
  renderTypeList("dailyList", entries, ["daily"]);
  renderTypeList("inspirationList", entries, ["inspiration"]);
  renderTypeList("metaList", entries, ["meta-learn", "tarot-case", "custom-resource"]);
  renderTypeList("studyList", entries, ["study"]);
  renderTypeList("viralList", entries, ["viral"]);
  $$(".delete-entry").forEach(btn => btn.addEventListener("click", async () => {
    await remove(STORE_ENTRIES, btn.dataset.id);
    toast("已删除");
    await renderAll();
  }));
}

function renderTypeList(elId, entries, types) {
  const list = entries.filter(e => types.includes(e.type)).slice(0, 30);
  const el = $(`#${elId}`);
  if (!el) return;
  el.innerHTML = list.length ? list.map(recordHTML).join("") : `<div class="record-list empty">暂无记录</div>`;
}

function recordHTML(entry) {
  const p = entry.payload || {};
  const body = p.result || p.content || p.reading || p.formula || p.summary || p.question || "";
  const typeMap = {
    daily: "拾光", inspiration: "灵感", "meta-learn": "玄学学习", "tarot-case": "塔罗案例",
    study: "学习", viral: "爆款拆解", "custom-resource": "我的资料",
  };
  return `
    <article class="record">
      <h3>${escapeHTML(entry.title)}</h3>
      <p>${escapeHTML(String(body).slice(0, 220))}</p>
      <div class="record-meta">
        <span class="tag">${typeMap[entry.type] || entry.type}</span>
        <span class="tag">${escapeHTML(entry.date || "")}</span>
        <button class="text-btn delete-entry" data-id="${entry.id}" type="button">删除</button>
      </div>
    </article>
  `;
}

function renderLibrary() {
  const el = $("#libraryList");
  if (!el) return;
  if (activeLibrary === "tarot") {
    const q = ($("#tarotSearch").value || "").trim().toLowerCase();
    const filtered = tarotCards.filter(card => {
      const hay = [
        card.name_zh, card.name_en, card.arcana, card.suit, card.astrology, card.element,
        ...(card.keywords || []),
        card.upright, card.reversed,
      ].join(" ").toLowerCase();
      return !q || hay.includes(q);
    });
    el.innerHTML = filtered.slice(0, 78).map(card => `
      <details class="library-card">
        <summary>${escapeHTML(card.name_zh)} <span class="tag">${escapeHTML(card.arcana)}</span></summary>
        <dl>
          <dt>关键词</dt><dd>${escapeHTML((card.keywords || []).join("、"))}</dd>
          <dt>正位</dt><dd>${escapeHTML(card.upright || "")}</dd>
          <dt>逆位</dt><dd>${escapeHTML(card.reversed || "")}</dd>
          <dt>占星</dt><dd>${escapeHTML(card.astrology || "")}</dd>
          <dt>元素</dt><dd>${escapeHTML(card.element || "")}</dd>
          <dt>卡巴拉</dt><dd>${escapeHTML(Object.values(card.kabbalah || {}).join("；"))}</dd>
        </dl>
      </details>
    `).join("");
  } else if (activeLibrary === "bazi") {
    el.innerHTML = (baziSeed?.categories || []).map(cat => `
      <details class="library-card">
        <summary>${escapeHTML(cat.name)}</summary>
        <dl><dt>包含</dt><dd>${escapeHTML((cat.items || []).join("、"))}</dd></dl>
      </details>
    `).join("");
  } else {
    getAll(STORE_ENTRIES).then(entries => {
      const custom = entries.filter(e => e.type === "custom-resource").sort((a, b) => b.createdAt - a.createdAt);
      el.innerHTML = custom.length ? custom.map(e => `
        <details class="library-card">
          <summary>${escapeHTML(e.title)} <span class="tag">${escapeHTML(e.payload.category || "自定义")}</span></summary>
          <dl><dt>内容</dt><dd>${escapeHTML(e.payload.summary || "")}</dd></dl>
        </details>
      `).join("") : `<div class="record-list empty">暂无自定义资料，点击“新增资料”添加。</div>`;
    });
  }
}

function renderResumes(resumes) {
  const el = $("#resumeList");
  const list = resumes.slice(0, 30);
  el.innerHTML = list.length ? list.map(r => `
    <article class="record">
      <h3>${escapeHTML(r.title)}</h3>
      <p>${escapeHTML((r.text || "").slice(0, 260))}</p>
      <div class="record-meta">
        <span class="tag">${r.kind === "raw" ? "原始简历" : "定制版本"}</span>
        <span class="tag">${new Date(r.createdAt).toLocaleDateString("zh-CN")}</span>
        <button class="text-btn use-resume" data-id="${r.id}" type="button">查看/下载</button>
        <button class="text-btn delete-resume" data-id="${r.id}" type="button">删除</button>
      </div>
    </article>
  `).join("") : `<div class="record-list empty">暂无简历</div>`;
  $$(".use-resume").forEach(btn => btn.addEventListener("click", async () => {
    const all = await getAll(STORE_RESUMES);
    const item = all.find(r => r.id === btn.dataset.id);
    if (!item) return;
    lastResumeText = item.text || "";
    $("#resumeText").value = lastResumeText;
    toast("已载入到文本框，可下载或继续生成版本");
  }));
  $$(".delete-resume").forEach(btn => btn.addEventListener("click", async () => {
    await remove(STORE_RESUMES, btn.dataset.id);
    toast("已删除简历记录");
    await renderAll();
  }));
}

function setupBackup() {
  $("#exportBtn").addEventListener("click", async () => {
    const data = {
      exportedAt: nowText(),
      entries: await getAll(STORE_ENTRIES),
      resumes: await getAll(STORE_RESUMES),
    };
    downloadText(`生活学习工作台备份-${todayISO()}.json`, JSON.stringify(data, null, 2));
  });
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    for (const entry of data.entries || []) await put(STORE_ENTRIES, entry);
    for (const resume of data.resumes || []) await put(STORE_RESUMES, resume);
    toast("备份已导入");
    await renderAll();
  });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setupInstallPrompt() {
  const hint = $("#installHint");
  const installText = $("#installText");
  const installBtn = $("#installBtn");
  const installClose = $("#installClose");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;

  if (!hint || !installText || !installBtn || !installClose || isStandalone || localStorage.getItem(INSTALL_DISMISSED_KEY) === "1") {
    if (hint) hint.hidden = true;
    return;
  }

  installBtn.disabled = false;
  installBtn.textContent = "知道了";
  installText.textContent = "如需添加到手机桌面，请用浏览器菜单里的“添加到主屏幕”。";

  const showHint = () => {
    if (localStorage.getItem(INSTALL_DISMISSED_KEY) !== "1") hint.hidden = false;
  };

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.disabled = false;
    installBtn.textContent = "安装";
    installText.textContent = "可添加到安卓手机桌面，像 APP 一样独立打开";
    showHint();
  });

  installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
      hint.hidden = true;
      toast("请点浏览器菜单，选择“添加到主屏幕”");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    hint.hidden = true;
  });

  installClose.addEventListener("click", () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    hint.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    deferredInstallPrompt = null;
    hint.hidden = true;
  });

  window.setTimeout(() => {
    if (!deferredInstallPrompt) showHint();
  }, 1200);
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (err) {
      console.warn("Service Worker 注册失败", err);
    }
  }
}

async function init() {
  db = await openDB();
  await loadStaticData();
  setupNavigation();
  setupForms();
  setupMetaTabs();
  await setupResumeTools();
  setupBackup();
  setupInstallPrompt();
  resetForm($("#tarotCaseForm"));
  await registerServiceWorker();
  await renderAll();
}

init().catch(err => {
  console.error(err);
  toast("应用初始化失败，请刷新重试");
});
