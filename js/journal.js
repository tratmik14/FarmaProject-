// Журнал целостности: хэш-цепочка (SHA-256) + "подпись" оператора + внешний якорь.
// Хранится локально на устройстве (localStorage) — это демонстрация механизма,
// не замена серверному WORM-хранилищу из полной архитектуры.

const JOURNAL_KEY = "cip_journal_v1";
const ANCHOR_KEY = "cip_journal_anchors_v1";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadJournal() {
  try {
    return JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveJournal(entries) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable — journal still works for this page load */
  }
}
function loadAnchors() {
  try {
    return JSON.parse(localStorage.getItem(ANCHOR_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveAnchors(anchors) {
  try {
    localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchors));
  } catch {}
}

async function appendJournalEntry(payload, operator = "operator-demo") {
  const entries = loadJournal();
  const prevHash = entries.length ? entries[entries.length - 1].hash : "GENESIS";
  const seq = entries.length + 1;
  const record = { seq, ts: new Date().toISOString(), operator, payload, prevHash };
  const base = JSON.stringify(record);
  const hash = await sha256Hex(base);
  const signature = await sha256Hex("hmac-demo-key::" + hash + "::" + operator);
  const entry = { ...record, hash, signature };
  entries.push(entry);
  saveJournal(entries);
  return entry;
}

// Periodically "anchor" the current chain tip outside the main store, so
// truncating the tail of the journal (which doesn't break the hash chain
// itself) can still be detected against the last known anchor.
async function maybeAnchor(entries) {
  if (!entries.length) return;
  const anchors = loadAnchors();
  const last = anchors[anchors.length - 1];
  if (last && last.seq === entries.length) return;
  if (entries.length % 5 !== 0) return;
  const tip = entries[entries.length - 1];
  anchors.push({ seq: entries.length, hash: tip.hash, at: new Date().toISOString() });
  saveAnchors(anchors);
}

async function verifyJournal() {
  const entries = loadJournal();
  const anchors = loadAnchors();
  const problems = [];

  let prevHash = "GENESIS";
  for (const e of entries) {
    if (e.prevHash !== prevHash) {
      problems.push({ seq: e.seq, issue: "цепочка нарушена: prevHash не совпадает (правка, удаление или перестановка записи)" });
    }
    const recomputed = await sha256Hex(JSON.stringify({ seq: e.seq, ts: e.ts, operator: e.operator, payload: e.payload, prevHash: e.prevHash }));
    if (recomputed !== e.hash) {
      problems.push({ seq: e.seq, issue: "хэш записи не совпадает с её содержимым — payload изменён после записи" });
    }
    prevHash = e.hash;
  }

  // Anchor check: a later anchor pointing past the current chain tip
  // means the tail was truncated after the anchor was taken.
  for (const a of anchors) {
    if (a.seq > entries.length) {
      problems.push({ seq: a.seq, issue: `обнаружена обрезка хвоста журнала: якорь от записи №${a.seq} не находит её в текущей цепочке (сейчас записей: ${entries.length})` });
    } else {
      const e = entries[a.seq - 1];
      if (!e || e.hash !== a.hash) {
        problems.push({ seq: a.seq, issue: "якорь не совпадает с записью в этой позиции — журнал подменён" });
      }
    }
  }

  return { ok: problems.length === 0, problems, count: entries.length, anchors: anchors.length };
}

// --- demo tamper actions, exposed for the "Проверка журнала" panel ---
async function tamperEditEntry(seq) {
  const entries = loadJournal();
  const idx = entries.findIndex((e) => e.seq === seq);
  if (idx === -1) return false;
  entries[idx] = { ...entries[idx], payload: { ...entries[idx].payload, tampered: true, note: "значение подменено вручную" } };
  saveJournal(entries);
  return true;
}
async function tamperDeleteEntry(seq) {
  const entries = loadJournal().filter((e) => e.seq !== seq);
  saveJournal(entries);
  return true;
}
async function tamperTruncateTail(n = 2) {
  const entries = loadJournal();
  saveJournal(entries.slice(0, Math.max(0, entries.length - n)));
  return true;
}
function resetJournal() {
  saveJournal([]);
  saveAnchors([]);
}
