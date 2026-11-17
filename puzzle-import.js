// Import de conținut pentru puzzle-uri: citire .xlsx (fără biblioteci externe) și .csv, apoi validare.
// Validările sunt funcții pure (nu ating baza de date), ca să se poată verifica ușor.

// ---------- citire .xlsx ----------
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Un .xlsx este o arhivă zip: citim lista de fișiere din „directorul central”, apoi doar fișierele de care avem nevoie.
function zipEntries(d) {
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65557); i--) {
    if (u32(d, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Fișierul nu este un .xlsx valid.");
  const count = u16(d, eocd + 10);
  let p = u32(d, eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(d, p) !== 0x02014b50) throw new Error("Fișierul .xlsx este deteriorat.");
    const nameLen = u16(d, p + 28), extraLen = u16(d, p + 30), commentLen = u16(d, p + 32);
    const name = new TextDecoder().decode(d.subarray(p + 46, p + 46 + nameLen));
    out.set(name, { method: u16(d, p + 10), csize: u32(d, p + 20), offset: u32(d, p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function zipRead(d, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  const nameLen = u16(d, e.offset + 26), extraLen = u16(d, e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = d.subarray(start, start + e.csize);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
  if (!bytes) throw new Error("Fișierul .xlsx folosește o compresie neacceptată.");
  return new TextDecoder("utf-8").decode(bytes);
}

const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
const textOf = (el) => {
  // concatenează textele din <t>, fără cele fonetice (rPh)
  let s = "";
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === "rPh") continue;
      if (c.localName === "t") s += c.textContent;
      else walk(c);
    }
  };
  walk(el);
  return s;
};
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

async function readXlsx(buffer) {
  const d = new Uint8Array(buffer);
  const entries = zipEntries(d);
  const shared = [];
  const sst = await zipRead(d, entries, "xl/sharedStrings.xml");
  if (sst) for (const si of xml(sst).getElementsByTagName("si")) shared.push(textOf(si));

  // prima foaie a registrului de lucru
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await zipRead(d, entries, "xl/workbook.xml");
  const rels = await zipRead(d, entries, "xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName("sheet")[0];
    const rid = first && (first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
    for (const r of xml(rels).getElementsByTagName("Relationship")) {
      if (r.getAttribute("Id") === rid) {
        const t = r.getAttribute("Target");
        sheetPath = t.startsWith("/") ? t.slice(1) : "xl/" + t;
      }
    }
  }
  const sheet = await zipRead(d, entries, sheetPath);
  if (!sheet) throw new Error("Nu am găsit foaia de calcul în fișier.");

  const grid = [];
  let nextRow = 0;
  for (const row of xml(sheet).getElementsByTagName("row")) {
    const r = row.getAttribute("r") ? Number(row.getAttribute("r")) - 1 : nextRow;
    nextRow = r + 1;
    const cells = [];
    for (const c of row.getElementsByTagName("c")) {
      const ci = c.getAttribute("r") ? colIndex(c.getAttribute("r")) : cells.length;
      const t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let val = "";
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = textOf(c.getElementsByTagName("is")[0] || c);
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else val = v;
      cells[ci] = val;
    }
    grid[r] = cells;
  }
  return grid;
}

// ---------- citire .csv ----------
function readCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Citește un fișier .xlsx sau .csv și întoarce rândurile ca obiecte; cheile sunt antetele (litere mici). `_row` = numărul rândului din fișier.
export async function readTable(file) {
  const name = String(file.name || "").toLowerCase();
  let grid;
  if (name.endsWith(".xlsx")) grid = await readXlsx(await file.arrayBuffer());
  else if (name.endsWith(".csv") || name.endsWith(".txt")) grid = readCsv(await file.text());
  else throw new Error("Alege un fișier .xlsx sau .csv.");
  const head = (grid.find((r) => r && r.some((c) => String(c ?? "").trim())) || []).map((h) => String(h ?? "").trim().toLowerCase());
  const headRow = grid.findIndex((r) => r === grid.find((x) => x && x.some((c) => String(c ?? "").trim())));
  const rows = [];
  for (let i = headRow + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r) continue;
    const o = { _row: i + 1 };
    head.forEach((h, k) => {
      if (h) o[h] = String(r[k] ?? "").trim();
    });
    rows.push(o);
  }
  if (rows.length > 5000) throw new Error("Fișierul are prea multe rânduri (maximum 5000).");
  return { headers: head.filter(Boolean), rows };
}

// ---------- validare: categorii Connections ----------
const TIER_ALIAS = { yellow: "yellow", galben: "yellow", green: "green", verde: "green", blue: "blue", albastru: "blue", purple: "purple", mov: "purple" };

export function validateCategories(rows, existing = []) {
  const known = new Set(existing.map((c) => c.items.map((i) => i.toUpperCase()).sort().join("|")));
  const out = rows.map((r) => {
    const n = r._row;
    const tier = TIER_ALIAS[String(r.tier || "").trim().toLowerCase()];
    const title = String(r.title || "").trim();
    const items = [r.item1, r.item2, r.item3, r.item4].map((v) => String(v || "").trim());
    const explanation = String(r.explanation || "").trim();
    if (!r.tier && !title && items.every((i) => !i)) return { row: n, skip: true, errors: [], note: "rând gol" };
    const errors = [];
    if (!tier) errors.push(`nivel invalid: „${r.tier || ""}” (acceptat: yellow, green, blue, purple)`);
    if (!title) errors.push("lipsește titlul (title)");
    if (items.some((i) => !i)) errors.push("trebuie completate toate cele 4 iteme (item1–item4)");
    else if (new Set(items.map((i) => i.toUpperCase())).size !== 4) errors.push("cele 4 iteme trebuie să fie diferite");
    if (errors.length) return { row: n, errors };
    const key = items.map((i) => i.toUpperCase()).sort().join("|");
    if (known.has(key)) return { row: n, skip: true, errors: [], note: "există deja o categorie cu aceleași 4 iteme" };
    known.add(key);
    return { row: n, errors: [], value: { tier, title, items, explanation: explanation || null } };
  });
  // avertisment (nu blochează): același item în mai multe categorii ale lotului
  const seen = new Map();
  for (const o of out) for (const it of o.value?.items || []) seen.set(it.toUpperCase(), [...(seen.get(it.toUpperCase()) || []), o.row]);
  const warnings = [...seen].filter(([, rs]) => rs.length > 1).map(([it, rs]) => `„${it}” apare în rândurile ${rs.join(", ")}`);
  return { items: out, warnings };
}

// ---------- validare: scenarii Decision Lab ----------
const TRAITS = ["exploration", "execution", "analysis", "diplomacy", "investigation"];
const toBool = (v) => ["true", "1", "da", "yes", "adevarat", "adevărat"].includes(String(v ?? "").trim().toLowerCase());

export function validateScenarios(rows) {
  const rowErrors = [];
  const byScenario = new Map();
  for (const r of rows) {
    const n = r._row;
    const scenario = String(r.scenario || "").trim();
    const code = String(r.node_code || "").trim();
    const text = String(r.node_text || "").trim();
    if (!scenario && !code && !text) continue; // rând gol
    const errors = [];
    const isFinal = toBool(r.is_final);
    const choiceText = String(r.choice_text || "").trim();
    const next = String(r.next_node_code || "").trim();
    const trait = String(r.trait || "").trim().toLowerCase();
    const scoreRaw = String(r.score ?? "").trim();
    if (!scenario) errors.push("lipsește scenariul (scenario)");
    if (!code) errors.push("lipsește node_code");
    if (!text) errors.push("lipsește node_text");
    if (!isFinal && !choiceText) errors.push("lipsește choice_text (obligatoriu pentru un nod care nu e final)");
    if (!isFinal && !next) errors.push("lipsește next_node_code (obligatoriu pentru un nod care nu e final)");
    if (trait && !TRAITS.includes(trait)) errors.push(`trăsătură invalidă: „${r.trait}” (acceptat: ${TRAITS.join(", ")} sau gol)`);
    let score = 0;
    if (scoreRaw) {
      score = Number(scoreRaw.replace(",", "."));
      if (!Number.isInteger(score)) errors.push(`scor invalid: „${r.score}” (trebuie să fie un număr întreg)`);
    }
    if (scenario && !byScenario.has(scenario)) byScenario.set(scenario, { title: scenario, description: "", nodes: new Map(), choices: [], errors: [], warnings: [], badRows: 0 });
    if (errors.length) {
      rowErrors.push({ row: n, errors });
      if (scenario) byScenario.get(scenario).badRows++;
      continue;
    }
    const s = byScenario.get(scenario);
    if (!s.description && r.scenario_description) s.description = String(r.scenario_description).trim();
    const isRoot = toBool(r.is_root);
    const prev = s.nodes.get(code);
    if (!prev) s.nodes.set(code, { code, text, isRoot, isFinal });
    else {
      if (prev.text !== text) s.warnings.push(`nodul „${code}” are texte diferite pe rânduri diferite (se păstrează primul)`);
      if (isRoot) prev.isRoot = true;
      if (isFinal) prev.isFinal = true;
    }
    if (!isFinal) s.choices.push({ nodeCode: code, text: choiceText, nextCode: next, score, feedback: String(r.feedback || "").trim() || null, trait: trait || null, row: n });
  }

  // verificări de structură pentru fiecare scenariu
  const scenarios = [];
  for (const s of byScenario.values()) {
    const nodes = [...s.nodes.values()];
    // un rând cu erori ar lipsi din scenariu (o opțiune pierdută, un nod lipsă): scenariul nu se importă pe jumătate
    if (s.badRows) s.errors.push(`${s.badRows} ${s.badRows === 1 ? "rând cu erori" : "rânduri cu erori"} (vezi mai sus): scenariul ar fi incomplet`);
    const roots = nodes.filter((x) => x.isRoot);
    if (roots.length !== 1) s.errors.push(roots.length ? `are ${roots.length} noduri de start (is_root); trebuie exact unul` : "nu are niciun nod de start (is_root)");
    for (const c of s.choices) if (!s.nodes.has(c.nextCode)) s.errors.push(`rândul ${c.row}: next_node_code „${c.nextCode}” nu există printre noduri`);
    const withChoices = new Set(s.choices.map((c) => c.nodeCode));
    for (const nd of nodes) {
      if (!nd.isFinal && !withChoices.has(nd.code)) s.errors.push(`nodul „${nd.code}” nu e final, dar nu are nicio opțiune`);
      if (nd.isFinal && withChoices.has(nd.code)) s.warnings.push(`nodul final „${nd.code}” are și opțiuni (sunt ignorate)`);
    }
    if (!nodes.some((x) => x.isFinal)) s.errors.push("nu are niciun nod final (is_final)");
    // din nodul de start trebuie să se poată ajunge la un nod final
    if (!s.errors.length && roots.length === 1) {
      const next = new Map();
      for (const c of s.choices) next.set(c.nodeCode, [...(next.get(c.nodeCode) || []), c.nextCode]);
      const seen = new Set();
      const stack = [roots[0].code];
      let reachesFinal = false;
      while (stack.length) {
        const code = stack.pop();
        if (seen.has(code)) continue;
        seen.add(code);
        if (s.nodes.get(code)?.isFinal) reachesFinal = true;
        for (const nx of next.get(code) || []) stack.push(nx);
      }
      if (!reachesFinal) s.errors.push("din nodul de start nu se poate ajunge la un nod final");
      const unreachable = nodes.filter((x) => !seen.has(x.code)).map((x) => x.code);
      if (unreachable.length) s.warnings.push(`noduri la care nu se ajunge niciodată: ${unreachable.join(", ")}`);
    }
    scenarios.push({ title: s.title, description: s.description, nodes, choices: s.choices, errors: s.errors, warnings: s.warnings, ok: s.errors.length === 0 });
  }
  return { scenarios, rowErrors };
}
