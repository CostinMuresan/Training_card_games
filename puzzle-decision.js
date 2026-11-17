// Decision Lab: o situație, 4 opțiuni, consecința, apoi pasul următor; la final profil, debrief și (opțional) feedback AI.
// Scorurile și consecințele rămân pe server până după ce alegi.
import { supabase, $, store, isUuid, friendly, FUNCTIONS_URL, SUPABASE_ANON_KEY } from "./puzzle-shared.js";

const KEY = "pz_decision_session";

let sessionId = null;
let step = 1;
let busy = false;
let last = null; // ultima stare primită: { node_text, choices, is_final, total_score, profile, debrief }

const show = (name) => {
  for (const id of ["pick", "play", "feedback", "done"]) $(id).hidden = id !== name;
  $("loading").hidden = true;
};

async function loadList() {
  $("err").textContent = "";
  store.del(KEY);
  sessionId = null;
  $("loading").hidden = false;
  for (const id of ["pick", "play", "feedback", "done"]) $(id).hidden = true;
  const { data, error } = await supabase.rpc("pz_catalog");
  $("loading").hidden = true;
  if (error || !data) {
    $("err").textContent = friendly(error, "Nu am putut încărca scenariile. Încearcă din nou.");
    return;
  }
  const list = $("scen-list");
  list.innerHTML = "";
  if (!(data.scenarios || []).length) {
    $("err").textContent = "Încă nu există scenarii disponibile.";
    return;
  }
  for (const s of data.scenarios) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pz-scen";
    const t = document.createElement("strong");
    t.textContent = s.title;
    const d = document.createElement("span");
    d.textContent = s.description || "";
    b.append(t, d);
    b.onclick = () => startScenario(s.id);
    list.append(b);
  }
  show("pick");
}

function renderPlay(state) {
  last = state;
  $("score").textContent = `Pas ${step} · scor: ${state.total_score}`;
  $("step-label").textContent = `Situația · pasul ${step}`;
  $("situation").textContent = state.node_text;
  const box = $("choices");
  box.innerHTML = "";
  for (const c of state.choices) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pz-choice";
    b.textContent = c.choice_text;
    b.disabled = busy;
    b.onclick = () => choose(c.id);
    box.append(b);
  }
  show("play");
  $("situation").scrollIntoView?.({ block: "nearest" });
}

function renderDone(state) {
  last = state;
  $("profile").textContent = `Profilul tău: ${state.profile}`;
  $("debrief").textContent = state.debrief || "";
  $("final-score").textContent = `Scor final: ${state.total_score}`;
  $("ai-err").textContent = "";
  const ai = state.ai_feedback;
  $("ai-box").hidden = !ai;
  $("ai-text").textContent = ai || "";
  $("ai-btn").hidden = !!ai;
  $("ai-note").hidden = !!ai;
  show("done");
}

async function startScenario(id) {
  $("err").textContent = "";
  const { data, error } = await supabase.rpc("pz_decision_start", { p_scenario: id });
  if (error || !data?.session_id) {
    $("err").textContent = friendly(error, "Nu am putut porni scenariul. Încearcă din nou.");
    return;
  }
  sessionId = data.session_id;
  store.set(KEY, sessionId);
  step = 1;
  renderPlay(data);
}

async function choose(choiceId) {
  if (busy || !sessionId) return;
  busy = true;
  $("err").textContent = "";
  for (const b of $("choices").querySelectorAll("button")) b.disabled = true;
  const { data, error } = await supabase.rpc("pz_decision_choose", { p_session: sessionId, p_choice: choiceId });
  busy = false;
  if (error || !data) {
    $("err").textContent = friendly(error, "Nu am putut înregistra alegerea. Încearcă din nou.");
    return renderPlay(last);
  }
  step += 1;
  $("fb-text").textContent = data.feedback || "";
  const d = data.score_delta;
  const el = $("fb-delta");
  el.className = "delta " + (d > 0 ? "pos" : d < 0 ? "neg" : "zero");
  el.textContent = `${d > 0 ? "+" : ""}${d} puncte (total: ${data.total_score})`;
  last = data;
  show("feedback");
  $("next").focus();
}

$("next").onclick = () => {
  if (last?.is_final) renderDone(last);
  else renderPlay(last);
};

async function requestAi() {
  $("ai-err").textContent = "";
  const btn = $("ai-btn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = '<span class="pz-spin" aria-hidden="true"></span> Se generează…';
  try {
    const resp = await fetch(`${FUNCTIONS_URL}/pz-ai-debrief`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.feedback) throw new Error(body.error || `HTTP ${resp.status}`);
    $("ai-text").textContent = body.feedback;
    $("ai-box").hidden = false;
    $("ai-btn").hidden = true;
    $("ai-note").hidden = true;
  } catch (e) {
    console.error("pz-ai-debrief:", e);
    // jucătorul vede un mesaj simplu, fără detalii tehnice (model, cotă, cod HTTP)
    $("ai-err").textContent = "Momentan nu putem genera feedbackul personalizat cu AI. Poți încerca din nou peste câteva minute; rezultatul tău de mai sus rămâne valabil.";
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
$("ai-btn").onclick = requestAi;
$("again").onclick = loadList;

(async function init() {
  const saved = store.get(KEY);
  if (isUuid(saved)) {
    const { data } = await supabase.rpc("pz_decision_state", { p_session: saved });
    if (data) {
      sessionId = saved;
      step = data.step || 1;
      if (data.status === "completed") return renderDone(data);
      return renderPlay(data);
    }
  }
  await loadList();
})();
