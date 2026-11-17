// Connections: 16 cuvinte, 4 grupuri de câte 4, cel mult 4 greșeli. Soluțiile rămân pe server: browserul primește doar cuvintele
// amestecate și, după fiecare trimitere, răspunsul „corect / aproape / greșit”.
import { supabase, $, store, isUuid, friendly, shuffled, TIERS, TIER_NAMES } from "./puzzle-shared.js";

const KEY = "pz_connections_session";
const MAX = 4;

let sessionId = null;
let items = []; // cuvintele rămase în grilă, în ordinea afișată
let selected = [];
let solved = []; // [{ title, tier, items, explanation }]
let mistakes = 0;
let status = "in_progress";
let revealed = null;
let busy = false;
let shakeNow = false;

const fontClass = (word) => {
  const longest = String(word).split(/[\s-]+/).reduce((m, t) => Math.max(m, t.length), 0);
  return longest <= 7 ? "s1" : longest <= 10 ? "s2" : longest <= 13 ? "s3" : "s4";
};

function setMsg(text, ms) {
  $("msg").textContent = text || "";
  if (text && ms) setTimeout(() => $("msg").textContent === text && ($("msg").textContent = ""), ms);
}

function renderDots() {
  const box = $("dots");
  box.innerHTML = "";
  const label = document.createElement("span");
  label.textContent = "Greșeli:";
  box.append(label);
  for (let i = 0; i < MAX; i++) {
    const d = document.createElement("span");
    d.className = "pz-dot" + (i < mistakes ? " used" : "");
    box.append(d);
  }
  box.setAttribute("aria-label", `${mistakes} greșeli din ${MAX}`);
}

function banner(cat, missed) {
  const el = document.createElement("div");
  el.className = `pz-banner ${cat.tier}${missed ? " missed" : ""}`;
  const t = document.createElement("strong");
  t.textContent = cat.title;
  const w = document.createElement("span");
  w.textContent = (cat.items || []).join(" · ");
  el.append(t, w);
  if (cat.explanation) {
    const e = document.createElement("em");
    e.textContent = cat.explanation;
    el.append(e);
  }
  if (missed) el.setAttribute("aria-label", `${cat.title} (nedescoperit): ${(cat.items || []).join(", ")}`);
  return el;
}

function render() {
  renderDots();
  const grid = $("grid");
  grid.innerHTML = "";
  const over = status !== "in_progress";

  if (over && revealed) {
    // la final: toate categoriile, pe rândul lor, în ordinea nivelurilor
    for (const cat of revealed) grid.append(banner(cat, !cat.solved));
  } else {
    // câte un „rând” pentru fiecare nivel: cel rezolvat arată bannerul pe locul lui final, cele nerezolvate împart cuvintele rămase
    const byTier = new Map(solved.map((c) => [c.tier, c]));
    let cursor = 0;
    for (const tier of TIERS) {
      const cat = byTier.get(tier);
      if (cat) {
        grid.append(banner(cat, false));
        continue;
      }
      for (const word of items.slice(cursor, cursor + 4)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `pz-tile ${fontClass(word)}${shakeNow && selected.includes(word) ? " shake" : ""}`;
        b.textContent = word;
        b.dataset.word = word;
        b.setAttribute("aria-pressed", String(selected.includes(word)));
        b.disabled = busy || over;
        b.onclick = () => toggle(word);
        grid.append(b);
      }
      cursor += 4;
    }
  }
  shakeNow = false;
  $("controls").hidden = over;
  $("submit").disabled = busy || selected.length !== 4;
  $("end").hidden = !over;
  if (over) {
    $("end-title").textContent = status === "won" ? "Felicitări, ai găsit toate grupurile!" : "Partida s-a încheiat";
    $("end-text").textContent =
      status === "won"
        ? mistakes === 0
          ? "Fără nicio greșeală. Impresionant."
          : `Ai greșit de ${mistakes} ${mistakes === 1 ? "dată" : "ori"}.`
        : "Ai folosit toate încercările. Mai sus vezi toate grupurile; cele marcate cu linie întreruptă nu au fost găsite.";
  }
}

function toggle(word) {
  if (busy || status !== "in_progress") return;
  if (selected.includes(word)) selected = selected.filter((w) => w !== word);
  else if (selected.length < 4) selected = [...selected, word];
  render();
}

async function loadReveal() {
  const { data } = await supabase.rpc("pz_connections_reveal", { p_session: sessionId });
  revealed = data || null;
}

async function start() {
  $("err").textContent = "";
  $("loading").hidden = false;
  $("game").hidden = true;
  store.del(KEY);
  const { data, error } = await supabase.rpc("pz_connections_start");
  $("loading").hidden = true;
  if (error || !data?.session_id) {
    $("err").textContent = friendly(error, "Nu am putut porni puzzle-ul. Încearcă din nou.");
    $("game").hidden = true;
    return;
  }
  sessionId = data.session_id;
  store.set(KEY, sessionId);
  items = data.items;
  selected = [];
  solved = [];
  mistakes = 0;
  status = "in_progress";
  revealed = null;
  setMsg("");
  $("game").hidden = false;
  render();
}

async function resume() {
  const saved = store.get(KEY);
  if (!isUuid(saved)) return false;
  const { data, error } = await supabase.rpc("pz_connections_state", { p_session: saved });
  if (error || !data) return false;
  sessionId = saved;
  items = data.items;
  solved = data.solved;
  mistakes = data.mistakes;
  status = data.status;
  selected = [];
  revealed = null;
  if (status !== "in_progress") await loadReveal();
  $("loading").hidden = true;
  $("game").hidden = false;
  render();
  return true;
}

async function submit() {
  if (busy || selected.length !== 4 || status !== "in_progress") return;
  busy = true;
  setMsg("");
  $("err").textContent = "";
  render();
  const { data, error } = await supabase.rpc("pz_connections_guess", { p_session: sessionId, p_items: selected });
  busy = false;
  if (error || !data) {
    $("err").textContent = friendly(error, "Nu am putut trimite răspunsul. Încearcă din nou.");
    return render();
  }
  if (data.result === "correct") {
    solved = [...solved, data.category];
    items = items.filter((w) => !data.category.items.includes(w));
    selected = [];
    if (data.won) {
      status = "won";
      await loadReveal();
    }
  } else if (data.result === "one_away" || data.result === "wrong") {
    mistakes = data.mistakes;
    shakeNow = true;
    setMsg(data.result === "one_away" ? "Aproape! Un cuvânt nu se potrivește." : "Grupare greșită.", 2500);
    if (data.result === "wrong") selected = [];
    if (data.lost) {
      status = "lost";
      selected = [];
      await loadReveal();
    }
  } else if (data.result === "game_over") {
    status = data.status;
    await loadReveal();
  }
  render();
}

$("shuffle").onclick = () => {
  items = shuffled(items);
  render();
};
$("clear").onclick = () => {
  selected = [];
  render();
};
$("submit").onclick = submit;
$("again").onclick = start;

(async function init() {
  if (await resume()) return;
  await start();
})();
