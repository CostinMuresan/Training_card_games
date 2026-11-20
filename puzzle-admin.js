// Administrarea jocurilor de gândire critică: pentru traineri (orice cont autentificat din aplicație).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { readTable, validateCategories, validateScenarios } from "./puzzle-import.js";
import { TIERS, TIER_NAMES } from "./puzzle-shared.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let categories = [];
let scenarios = []; // [{ id, title, description, active, nodes, choices }]
let pendingCats = null;
let pendingScen = null;

// element nou, cu text sigur (nu HTML)
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
const gErr = (m) => ($("global-error").textContent = m || "");
const dbMsg = (e) => (/pz_|schema cache|does not exist|permission denied/i.test(e?.message || "") ? `${e.message} (ai rulat scriptul add-puzzles.sql în Supabase?)` : e?.message || "Eroare necunoscută.");

// ---------- autentificare ----------
async function enter(user) {
  $("auth-box").hidden = true;
  $("admin").hidden = false;
  window.TCTheme?.initTrainer(supabase, user.email);
  await loadAll();
}
async function init() {
  const { data } = await supabase.auth.getSession();
  const s = data?.session;
  // o sesiune anonimă nu este un trainer
  if (s && !s.user?.is_anonymous) return enter(s.user);
  $("auth-box").hidden = false;
  window.TCTheme?.useDefault();
}
async function login() {
  $("auth-error").textContent = "";
  const { data, error } = await supabase.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  if (error || !data?.user) return ($("auth-error").textContent = "Email sau parolă greșite.");
  await enter(data.user);
}
$("login").onclick = login;
$("password").addEventListener("keydown", (e) => e.key === "Enter" && login());

// ---------- încărcare ----------
// o modificare în baza de date: reîncarcă listele, apoi (dacă a eșuat) arată eroarea, ca reîncărcarea să nu o șteargă
async function mutate(promise) {
  gErr("");
  const { error } = await promise;
  await loadAll();
  if (error) gErr(dbMsg(error));
  return !error;
}
async function loadAll() {
  const [c, s, n, ch] = await Promise.all([
    supabase.from("pz_categories").select("*").order("created_at", { ascending: true }),
    supabase.from("pz_scenarios").select("*").order("created_at", { ascending: true }),
    supabase.from("pz_nodes").select("id, scenario_id"),
    supabase.from("pz_choices").select("id, node_id"),
  ]);
  const err = c.error || s.error || n.error || ch.error;
  if (err) return gErr(dbMsg(err));
  categories = c.data || [];
  const nodeScen = new Map((n.data || []).map((x) => [x.id, x.scenario_id]));
  scenarios = (s.data || []).map((sc) => ({
    ...sc,
    nodes: (n.data || []).filter((x) => x.scenario_id === sc.id).length,
    choices: (ch.data || []).filter((x) => nodeScen.get(x.node_id) === sc.id).length,
  }));
  renderConn();
  renderDec();
}

// ---------- file ----------
function tabs(which) {
  const conn = which === "conn";
  $("tab-conn").setAttribute("aria-selected", String(conn));
  $("tab-dec").setAttribute("aria-selected", String(!conn));
  $("pane-conn").hidden = !conn;
  $("pane-dec").hidden = conn;
}
$("tab-conn").onclick = () => tabs("conn");
$("tab-dec").onclick = () => tabs("dec");

// ---------- Connections ----------
function renderConn() {
  const counts = $("conn-counts");
  counts.innerHTML = "";
  const missing = [];
  for (const t of TIERS) {
    const all = categories.filter((c) => c.tier === t);
    const act = all.filter((c) => c.active).length;
    counts.append(h("span", { class: `pz-chip ${t}`, text: `${TIER_NAMES[t]}: ${act} active din ${all.length}` }));
    if (!act) missing.push(TIER_NAMES[t].toLowerCase());
  }
  $("conn-warn").innerHTML = "";
  if (missing.length) $("conn-warn").append(h("div", { class: "pz-warnbox", text: `Jocul nu poate porni: nu există nicio categorie activă pentru nivelul ${missing.join(", ")}.` }));

  const tier = $("f-tier").value;
  const q = $("f-q").value.trim().toUpperCase();
  const body = $("conn-table").querySelector("tbody");
  body.innerHTML = "";
  const list = categories.filter((c) => (!tier || c.tier === tier) && (!q || c.title.toUpperCase().includes(q) || c.items.some((i) => i.toUpperCase().includes(q))));
  for (const c of list) {
    const act = h("input", { type: "checkbox", "aria-label": `Activ: ${c.title}` });
    act.checked = c.active;
    act.onchange = () => mutate(supabase.from("pz_categories").update({ active: act.checked }).eq("id", c.id));
    const del = h("button", { class: "btn danger-outline sm", type: "button", text: "Șterge", "aria-label": `Șterge: ${c.title}` });
    del.onclick = async () => {
      if (!confirm(`Ștergi categoria „${c.title}”?`)) return;
      await mutate(supabase.from("pz_categories").delete().eq("id", c.id));
    };
    body.append(
      h("tr", { class: c.active ? "" : "off" },
        h("td", {}, h("span", { class: `pz-chip ${c.tier}`, text: TIER_NAMES[c.tier] })),
        h("td", { text: c.title }),
        h("td", { class: "items", text: c.items.join(" · ") }),
        h("td", { text: String(c.times_used) }),
        h("td", {}, act),
        h("td", {}, h("div", { class: "pz-row-actions" }, del))));
  }
  if (!list.length) body.append(h("tr", {}, h("td", { colspan: "6", text: categories.length ? "Nicio categorie nu se potrivește filtrului." : "Nu există categorii. Importă un fișier sau adaugă una." })));
}
$("f-tier").onchange = renderConn;
$("f-q").oninput = renderConn;

$("c-add").onclick = async () => {
  $("c-error").textContent = "";
  const items = [1, 2, 3, 4].map((i) => $(`c-i${i}`).value.trim());
  const title = $("c-title").value.trim();
  if (!title) return ($("c-error").textContent = "Scrie titlul grupului.");
  if (items.some((i) => !i)) return ($("c-error").textContent = "Completează toate cele 4 iteme.");
  if (new Set(items.map((i) => i.toUpperCase())).size !== 4) return ($("c-error").textContent = "Cele 4 iteme trebuie să fie diferite.");
  const { error } = await supabase.from("pz_categories").insert({ tier: $("c-tier").value, title, items, explanation: $("c-expl").value.trim() || null });
  if (error) return ($("c-error").textContent = dbMsg(error));
  for (const id of ["c-title", "c-i1", "c-i2", "c-i3", "c-i4", "c-expl"]) $(id).value = "";
  await loadAll();
};

function previewBox(target, title, parts) {
  target.innerHTML = "";
  target.append(h("div", { class: "pz-preview" }, h("strong", { text: title }), ...parts));
}

$("conn-file").onchange = async (e) => {
  const file = e.target.files[0];
  pendingCats = null;
  $("conn-preview").innerHTML = "";
  if (!file) return;
  try {
    const { rows } = await readTable(file);
    const v = validateCategories(rows, categories);
    const good = v.items.filter((x) => x.value);
    const bad = v.items.filter((x) => x.errors.length);
    const skipped = v.items.filter((x) => x.skip && x.note !== "rând gol");
    pendingCats = good.map((x) => x.value);
    const parts = [h("p", { class: good.length ? "pz-ok" : "bad", text: `Gata de import: ${good.length} · cu erori: ${bad.length} · ignorate: ${skipped.length}` })];
    if (bad.length) parts.push(h("ul", {}, bad.map((x) => h("li", { class: "bad", text: `rândul ${x.row}: ${x.errors.join("; ")}` }))));
    if (skipped.length) parts.push(h("ul", {}, skipped.map((x) => h("li", { text: `rândul ${x.row}: ${x.note}` }))));
    if (v.warnings.length) parts.push(h("p", { class: "warn", text: "Atenție (nu blochează importul): aceleași iteme în mai multe categorii:" }), h("ul", {}, v.warnings.map((w) => h("li", { text: w }))));
    const go = h("button", { class: "btn", type: "button", text: `Importă ${good.length} ${good.length === 1 ? "categorie" : "categorii"}`, id: "conn-import" });
    go.disabled = !good.length;
    go.onclick = importCats;
    const cancel = h("button", { class: "btn outline u-ml-8", type: "button", text: "Renunță", id: "conn-cancel" });
    cancel.onclick = () => resetImport("conn");
    parts.push(h("p", {}, go, cancel));
    previewBox($("conn-preview"), "Previzualizare import", parts);
  } catch (err) {
    previewBox($("conn-preview"), "Nu am putut citi fișierul", [h("p", { class: "bad", text: err.message })]);
  }
};
function resetImport(kind) {
  if (kind === "conn") { pendingCats = null; $("conn-file").value = ""; $("conn-preview").innerHTML = ""; }
  else { pendingScen = null; $("dec-file").value = ""; $("dec-preview").innerHTML = ""; }
}
async function importCats() {
  if (!pendingCats?.length) return;
  gErr("");
  const { error } = await supabase.from("pz_categories").insert(pendingCats);
  if (error) return gErr(dbMsg(error));
  const n = pendingCats.length;
  resetImport("conn");
  await loadAll();
  $("conn-preview").append(h("p", { class: "pz-ok", text: `Am importat ${n} ${n === 1 ? "categorie" : "categorii"}.` }));
}

// ---------- Decision Lab ----------
function renderDec() {
  const body = $("dec-table").querySelector("tbody");
  body.innerHTML = "";
  for (const s of scenarios) {
    const act = h("input", { type: "checkbox", "aria-label": `Activ: ${s.title}` });
    act.checked = s.active;
    act.onchange = () => mutate(supabase.from("pz_scenarios").update({ active: act.checked }).eq("id", s.id));
    const del = h("button", { class: "btn danger-outline sm", type: "button", text: "Șterge", "aria-label": `Șterge: ${s.title}` });
    del.onclick = async () => {
      if (!confirm(`Ștergi scenariul „${s.title}”, cu toate nodurile, opțiunile și partidele lui?`)) return;
      await mutate(supabase.from("pz_scenarios").delete().eq("id", s.id));
    };
    body.append(
      h("tr", { class: s.active ? "" : "off" },
        h("td", {}, h("strong", { text: s.title }), h("div", { class: "items", text: s.description || "" })),
        h("td", { text: String(s.nodes) }),
        h("td", { text: String(s.choices) }),
        h("td", {}, act),
        h("td", {}, h("div", { class: "pz-row-actions" }, del))));
  }
  if (!scenarios.length) body.append(h("tr", {}, h("td", { colspan: "5", text: "Nu există scenarii. Importă un fișier." })));
}

$("dec-file").onchange = async (e) => {
  const file = e.target.files[0];
  pendingScen = null;
  $("dec-preview").innerHTML = "";
  if (!file) return;
  try {
    const { rows } = await readTable(file);
    const v = validateScenarios(rows);
    pendingScen = v.scenarios.filter((s) => s.ok);
    const parts = [h("p", { class: pendingScen.length ? "pz-ok" : "bad", text: `Pot fi importate: ${pendingScen.length} din ${v.scenarios.length} scenarii` })];
    if (v.rowErrors.length) parts.push(h("p", { class: "bad", text: "Rânduri cu erori (sunt ignorate):" }), h("ul", {}, v.rowErrors.map((x) => h("li", { class: "bad", text: `rândul ${x.row}: ${x.errors.join("; ")}` }))));
    for (const s of v.scenarios) {
      const dup = scenarios.some((x) => x.title.trim().toLowerCase() === s.title.trim().toLowerCase());
      const items = [
        h("li", { class: s.ok ? "" : "bad", text: `${s.title} — ${s.nodes.length} noduri, ${s.choices.length} opțiuni${s.ok ? "" : " — NU se importă"}` }),
      ];
      const sub = [...s.errors.map((m) => h("li", { class: "bad", text: m })), ...s.warnings.map((m) => h("li", { class: "warn", text: m }))];
      if (dup) sub.push(h("li", { class: "warn", text: "există deja un scenariu cu acest titlu (se va adăuga încă unul)" }));
      if (sub.length) items.push(h("ul", {}, sub));
      parts.push(h("ul", {}, items));
    }
    const go = h("button", { class: "btn", type: "button", text: `Importă ${pendingScen.length} ${pendingScen.length === 1 ? "scenariu" : "scenarii"}`, id: "dec-import" });
    go.disabled = !pendingScen.length;
    go.onclick = importScen;
    const cancel = h("button", { class: "btn outline u-ml-8", type: "button", text: "Renunță", id: "dec-cancel" });
    cancel.onclick = () => resetImport("dec");
    parts.push(h("p", {}, go, cancel));
    previewBox($("dec-preview"), "Previzualizare import", parts);
  } catch (err) {
    previewBox($("dec-preview"), "Nu am putut citi fișierul", [h("p", { class: "bad", text: err.message })]);
  }
};

async function importScen() {
  if (!pendingScen?.length) return;
  gErr("");
  let done = 0;
  const failed = [];
  for (const s of pendingScen) {
    // identificatoarele se aleg aici, ca opțiunile să poată indica nodul următor
    const scenId = crypto.randomUUID();
    const ids = new Map(s.nodes.map((n) => [n.code, crypto.randomUUID()]));
    let r = await supabase.from("pz_scenarios").insert({ id: scenId, title: s.title, description: s.description || null });
    if (!r.error) r = await supabase.from("pz_nodes").insert(s.nodes.map((n) => ({ id: ids.get(n.code), scenario_id: scenId, node_text: n.text, is_root: n.isRoot, is_final: n.isFinal })));
    if (!r.error) r = await supabase.from("pz_choices").insert(s.choices.map((c) => ({ node_id: ids.get(c.nodeCode), choice_text: c.text, next_node_id: ids.get(c.nextCode), score: c.score, feedback: c.feedback, trait: c.trait })));
    if (r.error) {
      await supabase.from("pz_scenarios").delete().eq("id", scenId); // nu lăsăm scenarii pe jumătate importate
      failed.push(`${s.title}: ${dbMsg(r.error)}`);
    } else done++;
  }
  resetImport("dec");
  await loadAll();
  const parts = [h("p", { class: done ? "pz-ok" : "bad", text: `Am importat ${done} ${done === 1 ? "scenariu" : "scenarii"}.` })];
  if (failed.length) parts.push(h("ul", {}, failed.map((m) => h("li", { class: "bad", text: m }))));
  previewBox($("dec-preview"), "Rezultatul importului", parts);
}

init();
