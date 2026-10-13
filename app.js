// ---------- регистрация service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

// ---------- установка PWA ----------
let deferredInstallEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallEvent = e;
  document.getElementById("installBanner").classList.add("show");
});
document.getElementById("installBtn").addEventListener("click", async () => {
  if (!deferredInstallEvent) return;
  deferredInstallEvent.prompt();
  await deferredInstallEvent.userChoice;
  document.getElementById("installBanner").classList.remove("show");
  deferredInstallEvent = null;
});
window.addEventListener("appinstalled", () => {
  document.getElementById("installBanner").classList.remove("show");
  toast("Приложение установлено");
});

// ---------- табы ----------
const views = ["dashboard", "journal", "deviations", "about"];
document.querySelectorAll("nav.tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    views.forEach((v) => {
      document.getElementById("view-" + v).classList.toggle("active", v === btn.dataset.view);
    });
    document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    if (btn.dataset.view === "journal") renderJournalTable();
    if (btn.dataset.view === "deviations") renderDrafts();
  });
});

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- уведомления ----------
document.getElementById("notifyBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    document.getElementById("notifyStatus").textContent = "Браузер не поддерживает уведомления.";
    return;
  }
  const perm = await Notification.requestPermission();
  document.getElementById("notifyStatus").textContent =
    perm === "granted" ? "Уведомления разрешены." : "Уведомления не разрешены.";
});

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body, icon: "./icons/icon-192.png" }); } catch {}
  }
}

// ---------- сценарии ----------
const scenarioSelect = document.getElementById("scenarioSelect");
Object.entries(SCENARIOS).forEach(([key, s]) => {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = s.label + " — " + s.describe;
  scenarioSelect.appendChild(opt);
});
scenarioSelect.value = "pump_wear";

// ---------- мини-графики ----------
const channelGrid = document.getElementById("channelGrid");
const channelState = {};
CHANNELS.forEach((ch) => {
  const box = document.createElement("div");
  box.className = "chan";
  box.id = "chan-" + ch.key;
  box.innerHTML = `
    <div class="head"><span>${ch.label}</span><span class="z" id="z-${ch.key}">z=0.0</span></div>
    <canvas id="cv-${ch.key}" width="300" height="64"></canvas>
    <div class="val"><span id="val-${ch.key}">—</span> <span style="font-size:11px;color:var(--ink-faint)">${ch.unit}</span></div>
  `;
  channelGrid.appendChild(box);
  channelState[ch.key] = { history: [], golden: [] };
});

function drawChannel(ch) {
  const cv = document.getElementById("cv-" + ch.key);
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const hist = channelState[ch.key].history;
  const gold = channelState[ch.key].golden;
  if (hist.length < 2) return;
  const all = hist.concat(gold.flat());
  const min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.15 || 1;
  const lo = min - pad, hi = max + pad;
  const sx = (i) => (i / (CYCLE_MINUTES - 1)) * W;
  const sy = (v) => H - ((v - lo) / (hi - lo)) * H;

  // golden band
  ctx.beginPath();
  gold.forEach((g, i) => { const x = sx(i); const y = sy(g[0] + g[1]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  for (let i = gold.length - 1; i >= 0; i--) { const x = sx(i); const y = sy(gold[i][0] - gold[i][1]); ctx.lineTo(x, y); }
  ctx.closePath();
  ctx.fillStyle = "rgba(46,132,104,0.16)";
  ctx.fill();

  // golden line
  ctx.beginPath();
  gold.forEach((g, i) => { const x = sx(i); const y = sy(g[0]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.strokeStyle = "#2E8468"; ctx.lineWidth = 1.5; ctx.stroke();

  // actual line
  ctx.beginPath();
  hist.forEach((v, i) => { const x = sx(i); const y = sy(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.strokeStyle = "#C2672B"; ctx.lineWidth = 2; ctx.stroke();
}

// ---------- симуляция ----------
let sim = null;
let timer = null;
let cycleJournalled = false;
let draftIssuedThisCycle = false;

function resetDashboard() {
  CHANNELS.forEach((ch) => { channelState[ch.key] = { history: [], golden: [] }; });
  document.getElementById("delayMid").textContent = "—";
  document.getElementById("delayRange").textContent = "нет данных";
  document.getElementById("obsMinute").textContent = "0";
  document.getElementById("causeBox").style.display = "none";
  document.getElementById("warnBanner").style.display = "none";
  document.getElementById("cycleClock").textContent = "Цикл не запущен";
  setStatus("ok", "норма");
  CHANNELS.forEach((ch) => document.getElementById("chan-" + ch.key).classList.remove("flag"));
}

function setStatus(level, label) {
  const pill = document.getElementById("statusPill");
  const dot = document.getElementById("statusDot");
  pill.className = "pill" + (level === "warn" ? " warn" : level === "crit" ? " crit" : "");
  pill.textContent = label;
  dot.style.background = level === "crit" ? "#8A2E12" : level === "warn" ? "#C2672B" : "#2E8468";
}

document.getElementById("startBtn").addEventListener("click", startCycle);
document.getElementById("pauseBtn").addEventListener("click", pauseCycle);
document.getElementById("resetBtn").addEventListener("click", () => { pauseCycle(); resetDashboard(); sim = null; });

function startCycle() {
  if (!sim) {
    sim = createCycleSimulator(scenarioSelect.value);
    resetDashboard();
    cycleJournalled = false;
    draftIssuedThisCycle = false;
  }
  document.getElementById("startBtn").disabled = true;
  document.getElementById("pauseBtn").disabled = false;
  scenarioSelect.disabled = true;
  timer = setInterval(stepCycle, TICK_MS);
}
function pauseCycle() {
  clearInterval(timer);
  timer = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("pauseBtn").disabled = true;
}

async function stepCycle() {
  const { t, readings, done } = sim.tick();
  document.getElementById("obsMinute").textContent = String(t);
  document.getElementById("cycleClock").textContent = `Минута ${t} из ${CYCLE_MINUTES} · сценарий: ${sim.scenario.label}`;

  CHANNELS.forEach((ch) => {
    const r = readings[ch.key];
    channelState[ch.key].history.push(r.value);
    channelState[ch.key].golden.push([r.golden, r.sigma]);
    document.getElementById("val-" + ch.key).textContent = r.value.toFixed(1);
    document.getElementById("z-" + ch.key).textContent = "z=" + r.z.toFixed(1);
    document.getElementById("chan-" + ch.key).classList.toggle("flag", Math.abs(r.z) > 2);
    drawChannel(ch);
  });

  const assessment = assessTick(t, readings);

  if (assessment.predictedDelay) {
    document.getElementById("delayMid").textContent = assessment.predictedDelay.mid + " мин";
    document.getElementById("delayRange").textContent =
      `интервал 10–90%: ${assessment.predictedDelay.low}–${assessment.predictedDelay.high} мин`;
  }
  if (assessment.likelyCause) {
    const box = document.getElementById("causeBox");
    box.style.display = "block";
    document.getElementById("causeChips").innerHTML =
      assessment.likelyCause.map((c) => `<span>${c.name} — ${c.pct}%</span>`).join("");
  }

  const warnBanner = document.getElementById("warnBanner");
  if (assessment.worst > 2.2) {
    setStatus("crit", "критично");
    warnBanner.className = "banner crit";
    warnBanner.style.display = "flex";
    warnBanner.textContent = `⚠ Сильное отклонение на минуте ${t}: вероятная задержка ${assessment.predictedDelay ? assessment.predictedDelay.mid : "?"} мин.`;
    if (!draftIssuedThisCycle) {
      draftIssuedThisCycle = true;
      issueDraft(t, readings, assessment);
      notify("CIP: раннее предупреждение", `Минута ${t}: вероятная задержка ~${assessment.predictedDelay?.mid ?? "?"} мин`);
    }
  } else if (assessment.worst > 1.3) {
    setStatus("warn", "наблюдение");
    warnBanner.className = "banner warn";
    warnBanner.style.display = "flex";
    warnBanner.textContent = `Отклонение от золотого профиля на минуте ${t} — наблюдаем.`;
  } else {
    setStatus("ok", "норма");
    warnBanner.style.display = "none";
  }

  if (!cycleJournalled && t % 5 === 0) {
    const entry = await appendJournalEntry({ t, cycle: "demo", channels: Object.fromEntries(Object.entries(readings).map(([k, v]) => [k, Math.round(v.value * 100) / 100])) });
    await maybeAnchor(loadJournal());
  }

  if (done) {
    pauseCycle();
    document.getElementById("cycleClock").textContent = `Цикл завершён (сценарий: ${sim.scenario.label}). Нажмите «Сброс», чтобы начать новый.`;
    const finalEntry = await appendJournalEntry({ t, cycle: "demo", event: "cycle_complete", scenario: sim.scenarioKey });
    await maybeAnchor(loadJournal());
    scenarioSelect.disabled = false;
  }
}

// ---------- журнал ----------
async function renderJournalTable() {
  const entries = loadJournal();
  const tbody = document.querySelector("#journalTable tbody");
  tbody.innerHTML = "";
  entries.slice().reverse().forEach((e) => {
    const tr = document.createElement("tr");
    const label = e.payload.event === "cycle_complete" ? "Завершение цикла" : `Показания (мин ${e.payload.t})`;
    tr.innerHTML = `<td>${e.seq}</td><td class="mono">${new Date(e.ts).toLocaleTimeString()}</td><td>${label}</td><td class="mono">${e.hash.slice(0, 10)}…</td><td>—</td>`;
    tbody.appendChild(tr);
  });
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="small">Журнал пуст — запустите симуляцию на вкладке «Дашборд».</td></tr>`;
  }
}

document.getElementById("verifyBtn").addEventListener("click", async () => {
  const result = await verifyJournal();
  const out = document.getElementById("verifyResult");
  const tbody = document.querySelector("#journalTable tbody");
  const rows = [...tbody.querySelectorAll("tr")];
  if (result.ok) {
    out.textContent = `✓ Цепочка цела: ${result.count} записей, ${result.anchors} якорей, нарушений не найдено.`;
    out.style.color = "var(--accent)";
    rows.forEach((r) => { r.classList.remove("bad-row"); r.classList.add("ok-row"); if (r.children[4]) r.children[4].textContent = "ок"; });
  } else {
    out.innerHTML = `✗ Обнаружено ${result.problems.length} нарушени(е/я):<br>` + result.problems.map((p) => `№${p.seq}: ${p.issue}`).join("<br>");
    out.style.color = "var(--crit)";
    const badSeqs = new Set(result.problems.map((p) => p.seq));
    rows.forEach((r) => {
      const seq = Number(r.children[0]?.textContent);
      if (badSeqs.has(seq)) { r.classList.add("bad-row"); if (r.children[4]) r.children[4].textContent = "подделка"; }
      else { r.classList.remove("bad-row"); if (r.children[4]) r.children[4].textContent = "ок"; }
    });
  }
});

document.getElementById("clearJournalBtn").addEventListener("click", () => {
  resetJournal();
  renderJournalTable();
  document.getElementById("verifyResult").textContent = "";
  toast("Журнал очищен");
});

document.getElementById("tamperEditBtn").addEventListener("click", async () => {
  const entries = loadJournal();
  if (!entries.length) return toast("Журнал пуст");
  await tamperEditEntry(entries[Math.floor(entries.length / 2)].seq);
  renderJournalTable();
  toast("Запись изменена — нажмите «Проверить цепочку»");
});
document.getElementById("tamperDeleteBtn").addEventListener("click", async () => {
  const entries = loadJournal();
  if (!entries.length) return toast("Журнал пуст");
  await tamperDeleteEntry(entries[Math.floor(entries.length / 2)].seq);
  renderJournalTable();
  toast("Запись удалена — нажмите «Проверить цепочку»");
});
document.getElementById("tamperTruncateBtn").addEventListener("click", async () => {
  await tamperTruncateTail(2);
  renderJournalTable();
  toast("Хвост журнала обрезан — нажмите «Проверить цепочку»");
});

// ---------- черновики отклонений (QA) ----------
const DRAFTS_KEY = "cip_drafts_v1";
function loadDrafts() { try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]"); } catch { return []; } }
function saveDrafts(d) { try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(d)); } catch {} }

function issueDraft(t, readings, assessment) {
  const drafts = loadDrafts();
  const id = "DEMO-" + Date.now().toString().slice(-6);
  drafts.push({
    id, t, scenario: sim.scenario.label,
    delay: assessment.predictedDelay,
    cause: assessment.likelyCause,
    flow: readings.flow.value.toFixed(1), flowZ: readings.flow.z.toFixed(1),
    decision: "pending",
    createdAt: new Date().toISOString(),
  });
  saveDrafts(drafts);
  renderDrafts();
}

function renderDrafts() {
  const drafts = loadDrafts().slice().reverse();
  const list = document.getElementById("draftsList");
  const empty = document.getElementById("noDrafts");
  list.innerHTML = "";
  empty.style.display = drafts.length ? "none" : "block";
  drafts.forEach((d) => {
    const div = document.createElement("div");
    div.className = "draft";
    div.innerHTML = `
      <h3>Отклонение № ${d.id}</h3>
      <div class="meta">Сценарий «${d.scenario}» · момент предупреждения: минута ${d.t} · ${new Date(d.createdAt).toLocaleString()}</div>
      <div>Прогноз задержки: <b>${d.delay ? d.delay.mid + " мин" : "—"}</b>${d.delay ? ` (10–90%: ${d.delay.low}–${d.delay.high} мин)` : ""}</div>
      <div>Расход: ${d.flow} м³/ч (z=${d.flowZ})</div>
      ${d.cause ? `<div class="causes" style="margin-top:6px">${d.cause.map((c) => `<span>${c.name} — ${c.pct}%</span>`).join("")}</div>` : ""}
      <div class="decision ${d.decision}">${d.decision === "pending" ? "Ожидает решения QA" : d.decision === "approved" ? "Решение QA: партия подтверждена" : "Решение QA: отклонено, разбор инцидента"}</div>
      ${d.decision === "pending" ? `
        <div class="row" style="margin-top:8px">
          <button class="primary" data-approve="${d.id}">Подтвердить</button>
          <button class="danger" data-reject="${d.id}">Отклонить</button>
        </div>` : ""}
    `;
    list.appendChild(div);
  });
  list.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.approve, "approved")));
  list.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.reject, "rejected")));
}
function decide(id, decision) {
  const drafts = loadDrafts();
  const d = drafts.find((x) => x.id === id);
  if (d) d.decision = decision;
  saveDrafts(drafts);
  renderDrafts();
}

// ---------- init ----------
resetDashboard();
renderDrafts();
