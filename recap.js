import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { TEAMS, MAX_LEN, COOLDOWN_S, otherTeam, createArena, renderLists, createStore, STORE_COLS, createClock, timerInfo, fmtTime } from "./recap-shared.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const code = new URLSearchParams(location.search).get("s");

let session = null;
let me = null;
let store = null;
let arena = null;
let poll = null;
let busy = false;
const clock = createClock(supabase); // ora serverului: timpul rămas e același pe toate ecranele
let lastTimerState = null;
let endedShown = false; // nota de încheiere a fost deja adusă în vedere
let composerOpen = true; // telefon: panoul de scris e deschis sau strâns la o bară (se strânge singur după fiecare trimitere)
let myCount = 0; // cate intrebari am aruncat eu in aceasta sesiune (pentru limita stabilita de trainer)
let cooldownUntil = 0;
let cooldownTimer = null;
let newIds = new Set();
let returning = new Set(); // întrebări pe care tocmai le arunc înapoi (butonul se dezactivează până la răspuns)
let baseAlias = "";
let suggestedAlias = "";

const norm = (s) => s.trim().toLowerCase();

// pe telefon, ecranul de joc ocupa exact inaltimea ramasa sub antet: sus campul de lupta (deruleaza), jos campul de intrebare
function fitLayout() {
  const layout = document.querySelector(".recap-layout");
  if (!layout) return;
  if (window.matchMedia("(max-width: 800px)").matches && !$("game").hidden && session?.status === "play") {
    const top = layout.getBoundingClientRect().top + window.scrollY;
    layout.style.height = `${Math.max(320, window.innerHeight - top - 8)}px`;
  } else {
    layout.style.height = "";
  }
}
window.addEventListener("resize", fitLayout);

function show(id) {
  ["error", "join", "waiting", "game"].forEach((s) => ($(s).hidden = s !== id));
  document.body.classList.toggle("recap-playing", id === "game" && session?.status === "play" && window.matchMedia("(max-width: 800px)").matches);
  fitLayout();
}
function fail(msg) {
  $("error").textContent = msg;
  show("error");
}

// ---------------------------------------------------------------------
async function init() {
  if (!code) return fail("Link invalid.");
  const { data, error } = await supabase.from("recap_sessions").select("*").eq("session_code", code).maybeSingle();
  if (error) {
    console.error(error);
    return fail("Nu pot citi sesiunea: " + error.message);
  }
  if (!data) return fail("Sesiunea nu există.");
  session = data;
  window.TCTheme?.initParticipant(supabase, "recap", session.id); // tema trainerului
  await clock.sync();
  const saved = localStorage.getItem(`recap_${session.id}`);
  if (saved) {
    const { data: p } = await supabase.from("recap_participants").select("*").eq("id", saved).maybeSingle();
    me = p;
  }
  render();
  window.__recapReady = true;
  poll = setInterval(refresh, 2000);
  setInterval(renderTimer, 1000);
}

function render() {
  $("join-topic").textContent = session.topic ? `Tema: ${session.topic}` : "";
  if (session.status === "ended") {
    buildGame(); // doar citire: se vad intrebarile si campul de lupta
    return;
  }
  if (!me) return show("join");
  $("my-alias").textContent = me.alias;
  if (session.status === "lobby") {
    $("waiting-text").textContent = "Așteaptă ca trainerul să împartă echipele și să pornească recapitularea.";
    return show("waiting");
  }
  if (!me.team) {
    $("waiting-text").textContent = "Recapitularea a început. Se alocă echipa ta…";
    return show("waiting");
  }
  buildGame();
}

// ---------------------------------------------------------------------
//  Ecranul de joc
// ---------------------------------------------------------------------
async function buildGame() {
  const ended = session.status === "ended";
  $("game").classList.toggle("ended", ended);
  $("ended-note").hidden = !ended; // mesaj vizibil: trainerul a încheiat sesiunea
  if (ended && !endedShown) {
    endedShown = true;
    $("ended-note").scrollIntoView?.({ block: "nearest" });
  }
  show("game");
  $("topic-line").innerHTML = "";
  if (session.topic) {
    const b = document.createElement("b");
    b.textContent = session.topic;
    $("topic-line").append("Tema: ", b);
  }
  if (!arena) {
    arena = createArena($("arena"));
    store = createStore(supabase, session.id);
  } else if (store) {
    drawAll(); // starea s-a schimbat (de ex. „Încheie”): butoanele „Aruncă înapoi” dispar imediat, nu abia la următoarea sincronizare
  }
  const t = me?.team;
  const banner = $("team-banner");
  banner.hidden = ended || !t;
  if (t) {
    banner.className = `team-banner team-${t}`;
    banner.textContent = `Ești în echipa ${TEAMS[t].name}`;
    $("q-label").textContent = `Întrebare pentru echipa ${TEAMS[otherTeam(t)].name}`;
  }
  await loadMyCount();
  renderTimer();
  updateThrowButton();
  await syncQuestions();
}

async function loadMyCount() {
  if (!me?.team) return;
  const { data } = await supabase.from("recap_questions").select("id, parent_id").eq("session_id", session.id).eq("participant_id", me.id);
  myCount = (data || []).filter((q) => !q.parent_id).length; // întrebările returnate nu se numără la limita personală
}

async function syncQuestions() {
  if (!store || busy) return;
  busy = true;
  try {
    const r = await store.sync();
    r.added.filter((q) => !q.hidden).forEach((q) => {
      arena.fly(q.team); // intrebare noua a altcuiva: bulgare in zbor
      newIds.add(q.id);
    });
    drawAll();
    setTimeout(() => {
      newIds = new Set();
    }, 2300);
  } catch (e) {
    console.error(e);
  } finally {
    busy = false;
  }
}

function drawAll() {
  const all = store.all();
  const c = store.visibleCounts();
  arena.setTotals(c[1], c[2]);
  renderLists($("qlists"), all, {
    newIds,
    myTeam: me?.team,
    returning,
    // „Aruncă înapoi” APARE doar cât timp trainerul a bifat „Permite aruncarea” (și cronometrul nu e oprit); altfel, niciun buton în dreptul întrebărilor
    onReturn: session.status === "play" && me?.team && !timerBlocked() && throwAllowed() ? returnQuestion : null,
  });
}

// ---------------------------------------------------------------------
//  Aruncarea întrebării
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
//  Cronometrul
// ---------------------------------------------------------------------
function timerState() {
  return session?.status === "play" ? timerInfo(session, clock.now()).state : "none";
}
const timerBlocked = () => ["paused", "expired"].includes(timerState());

function renderTimer() {
  if (!session) return;
  const bar = $("timer-bar");
  const info = timerInfo(session, clock.now());
  const show = session.status === "play" && info.state !== "none";
  bar.hidden = !show;
  if (show) {
    const low = info.state === "running" && info.remaining <= 10;
    $("timer-display").textContent = fmtTime(info.remaining);
    $("timer-display").className = `timer-display ${info.state}${low ? " low" : ""}`;
    $("timer-label").textContent = info.state === "expired" ? "Timpul a expirat" : info.state === "paused" ? "Pauză" : "Timp rămas";
    $("timer-note").textContent =
      info.state === "expired"
        ? "⏰ Aruncatul de întrebări s-a oprit. Așteaptă instrucțiunile trainerului."
        : info.state === "paused"
          ? "⏸ Pauză: timpul e oprit, iar aruncatul de întrebări așteaptă trainerul."
          : "Poți arunca întrebări până expiră timpul.";
  }
  const st = session.status === "play" ? info.state : "none";
  if (st !== lastTimerState) {
    lastTimerState = st; // s-a schimbat starea (pornit, pauză, expirat): se actualizează câmpul și butoanele „Aruncă înapoi”
    if (!$("game").hidden) {
      updateThrowButton();
      if (store && arena) drawAll();
    }
  }
}

// „Permite aruncarea” (bifa trainerului) controlează DOAR „Aruncă înapoi”; întrebările noi se trimit oricând (în limita permisă și cât timp rulează cronometrul)
const throwAllowed = () => session?.throw_allowed !== false;

function updateThrowButton() {
  const text = $("q-text").value;
  $("q-count").textContent = `${text.length}/${MAX_LEN}`;
  const limit = session?.max_questions || 0; // 0 = fara limita
  const reached = limit > 0 && myCount >= limit;
  const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
  const playing = session?.status === "play" && !!me?.team;
  const tState = timerState();
  const tBlocked = tState === "paused" || tState === "expired";
  $("q-text").disabled = reached || tBlocked;
  $("q-left").textContent = limit > 0 ? (reached ? `Ai folosit toate întrebările (${myCount}/${limit}).` : `Întrebări rămase: ${limit - myCount} din ${limit}`) : "";
  $("throw-btn").disabled = !playing || reached || tBlocked || !text.trim() || left > 0;
  $("throw-btn").textContent = tBlocked
    ? tState === "paused" ? "Pauză" : "Timpul a expirat"
    : reached ? "Limita de întrebări atinsă" : left > 0 ? `Aruncă întrebarea (${left})` : "Aruncă întrebarea";

  // Telefon: panoul de scris se strânge la o singură bară, ca să rămână loc pentru lista de întrebări.
  // Se strânge singur după fiecare trimitere și cât nu se poate scrie (limită atinsă, pauză, timp expirat, sesiune nepornită).
  const writable = playing && !reached && !tBlocked;
  const collapsed = isPhone() && (!composerOpen || !writable);
  $("composer").classList.toggle("collapsed", collapsed);
  $("composer-bar").disabled = !writable;
  $("composer-bar").setAttribute("aria-expanded", String(!collapsed));
  $("composer-bar-chev").textContent = collapsed ? "▴" : "▾";
  $("composer-bar-title").textContent = collapsed && text.trim() ? "✏️ Continuă întrebarea" : "✏️ Scrie o întrebare";
  $("composer-bar-info").textContent = tBlocked
    ? tState === "paused" ? "Pauză" : "Timpul a expirat"
    : reached ? `Limita atinsă (${myCount}/${limit})`
    : !playing ? ""
    : collapsed && text.trim() ? `${text.length}/${MAX_LEN}`
    : left > 0 ? `⏱ ${left} s`
    : limit > 0 ? `${limit - myCount} rămase din ${limit}` : "";
}

const isPhone = () => window.matchMedia("(max-width: 800px)").matches;
window.matchMedia("(max-width: 800px)").addEventListener("change", () => {
  autoGrow();
  updateThrowButton();
});
// câmpul de scris pornește mic pe telefon și crește singur, până la ~5 rânduri
function autoGrow() {
  const t = $("q-text");
  if (!isPhone()) {
    t.style.height = "";
    return;
  }
  t.style.height = "auto";
  t.style.height = `${Math.min(Math.max(t.scrollHeight, 64), 132)}px`;
}
$("q-text").addEventListener("input", autoGrow);
$("composer-bar").onclick = () => {
  if ($("composer-bar").disabled) return;
  composerOpen = !composerOpen;
  updateThrowButton();
  if (composerOpen && isPhone()) $("q-text").focus();
};

function startCooldown(seconds) {
  cooldownUntil = Date.now() + seconds * 1000;
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    updateThrowButton();
    if (Date.now() >= cooldownUntil) clearInterval(cooldownTimer);
  }, 250);
  updateThrowButton();
}

const THROW_ERRORS = {
  recap_rate_limit: "Așteaptă câteva secunde înainte de următoarea întrebare.",
  recap_not_playing: "Recapitularea nu este activă acum.",
  recap_team_mismatch: "Echipa ta s-a schimbat. Reîncarcă pagina.",
  recap_limit_reached: "Ai folosit toate întrebările permise de trainer.",
  recap_time_up: "Timpul a expirat: nu se mai pot arunca întrebări.",
  recap_timer_paused: "Pauză: aruncatul de întrebări e oprit până reia trainerul cronometrul.",
};
// ---------------------------------------------------------------------
//  Aruncare / pregătire
// ---------------------------------------------------------------------
async function sendQuestion(body) {
  const { data, error } = await supabase
    .from("recap_questions")
    .insert({ session_id: session.id, participant_id: me.id, team: me.team, body })
    .select(STORE_COLS)
    .single();
  if (error) {
    const key = Object.keys(THROW_ERRORS).find((k) => (error.message || "").includes(k));
    $("q-msg").textContent = key ? THROW_ERRORS[key] : error.message;
    if (key === "recap_limit_reached") myCount = Math.max(myCount, session.max_questions || 0);
    startCooldown(key === "recap_rate_limit" ? 3 : 1);
    return { ok: false, key };
  }
  myCount++;
  store.remember(data);
  arena.fly(me.team); // bulgarele pleaca imediat, fara sa astepte reimprospatarea
  drawAll();
  startCooldown(COOLDOWN_S);
  return { ok: true };
}

async function throwQuestion() {
  const body = $("q-text").value.trim().slice(0, MAX_LEN);
  if (!body || $("throw-btn").disabled) return;
  $("throw-btn").disabled = true;
  $("q-msg").textContent = "";
  const r = await sendQuestion(body);
  if (r.ok) {
    $("q-text").value = "";
    autoGrow();
    composerOpen = false; // restrângere automată: după trimitere vezi imediat lista de întrebări
  }
  updateThrowButton();
}

// „Aruncă înapoi”: aceeași întrebare, trimisă înapoi echipei care a pus-o. O singură returnare pe întrebare (primul coleg care apasă);
// poate continua în lanț (ping-pong), iar returnările nu consumă din limita personală de întrebări.
const RETURN_ERRORS = {
  uq_recap_return_once: "Un coleg de-al tău a aruncat deja această întrebare.",
  recap_parent_hidden: "Întrebarea a fost ascunsă de trainer.",
  recap_return_own_team: "Nu poți returna întrebările echipei tale.",
  recap_not_playing: "Recapitularea nu este activă acum.",
  recap_time_up: "Timpul a expirat: nu se mai pot arunca întrebări.",
  recap_timer_paused: "Pauză: aruncatul de întrebări e oprit până reia trainerul cronometrul.",
  recap_throw_off: "Aruncarea nu este permisă acum. Trainerul o va permite.",
};
async function returnQuestion(q) {
  if (returning.has(q.id) || !me?.team || timerBlocked() || !throwAllowed()) return;
  returning.add(q.id);
  $("q-msg").textContent = "";
  drawAll();
  const { data, error } = await supabase
    .from("recap_questions")
    .insert({ session_id: session.id, participant_id: me.id, team: me.team, body: q.body, parent_id: q.id })
    .select(STORE_COLS)
    .single();
  returning.delete(q.id);
  if (error) {
    const key = Object.keys(RETURN_ERRORS).find((k) => (error.message || "").includes(k)) || (error.code === "23505" ? "uq_recap_return_once" : null);
    $("q-msg").textContent = key ? RETURN_ERRORS[key] : error.message;
    await syncQuestions(); // se vede starea reala: cine a returnat-o deja
    return;
  }
  store.remember(data);
  arena.fly(me.team); // bulgarele pleaca imediat inapoi
  drawAll();
}

$("q-text").addEventListener("input", updateThrowButton);
$("q-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) throwQuestion();
});
$("throw-btn").onclick = throwQuestion;

// ---------------------------------------------------------------------
//  Reîmprospătare periodică (ușoară: doar starea sesiunii, echipa și întrebările schimbate)
// ---------------------------------------------------------------------
let tick = 0;
async function refresh() {
  tick++;
  const { data, error } = await supabase.from("recap_sessions").select("status, topic, max_questions, throw_allowed, timer_status, timer_total_seconds, timer_remaining_seconds, timer_ends_at").eq("id", session.id).maybeSingle();
  if (!error && !data) {
    // trainerul a inchis de tot recapitularea (sesiunea a fost stearsa)
    clearInterval(poll);
    clearInterval(cooldownTimer);
    document.body.classList.remove("recap-playing");
    return fail("Recapitularea a fost închisă de trainer. Mulțumim pentru participare!");
  }
  if (!data) return;
  const changed = data.status !== session.status || data.topic !== session.topic;
  const limitChanged = data.max_questions !== session.max_questions;
  const allowChanged = data.throw_allowed !== session.throw_allowed; // trainerul a bifat / debifat „Permite aruncarea”
  session = { ...session, ...data };
  if (tick % 15 === 0) clock.sync(); // ceasul serverului se reverifică din când în când
  renderTimer();
  if (limitChanged && !$("game").hidden) updateThrowButton(); // trainerul a schimbat limita
  if (allowChanged && !$("game").hidden && store && arena) drawAll(); // butonul „Aruncă înapoi” apare / dispare în dreptul întrebărilor primite
  if (me && !me.team && session.status !== "lobby") {
    const { data: p } = await supabase.from("recap_participants").select("team").eq("id", me.id).maybeSingle();
    if (p?.team) {
      me = { ...me, team: p.team };
      return render();
    }
  }
  // trainerul a reimpartit echipele: echipa participantului se poate schimba
  if (me?.team && session.status === "play" && tick % 4 === 0) { // verificare mai rara: echipa se schimba doar daca trainerul reimparte
    const { data: p } = await supabase.from("recap_participants").select("team").eq("id", me.id).maybeSingle();
    if (p?.team && p.team !== me.team) {
      me = { ...me, team: p.team };
      return render();
    }
  }
  if (changed) return render();
  if (!$("game").hidden) await syncQuestions();
}

// ---------------------------------------------------------------------
//  Înscrierea
// ---------------------------------------------------------------------
async function takenAliases() {
  const { data, error } = await supabase.from("recap_participants").select("alias").eq("session_id", session.id);
  return error ? null : new Set((data || []).map((p) => norm(p.alias)));
}
async function nextFreeAlias(base) {
  const taken = (await takenAliases()) || new Set();
  let n = 2;
  while (taken.has(norm(`${base} (${n})`))) n++;
  return `${base} (${n})`;
}
function hideSuggestion() {
  $("alias-suggest").hidden = true;
}
async function offerSuffix(base) {
  baseAlias = base;
  suggestedAlias = await nextFreeAlias(base);
  $("alias-suggest-text").textContent = `Aliasul „${base}” e deja folosit. Vrei să apari ca „${suggestedAlias}”?`;
  $("alias-yes").textContent = `Da, apar ca „${suggestedAlias}”`;
  $("alias-suggest").hidden = false;
}
async function register(alias, base) {
  const taken = await takenAliases();
  if (taken && taken.has(norm(alias))) return offerSuffix(base);
  const { data, error } = await supabase.from("recap_participants").insert({ session_id: session.id, alias }).select().single();
  if (error) {
    if (error.code === "23505" || /duplicate key|unique/i.test(error.message)) return offerSuffix(base);
    $("join-error").textContent = error.message;
    return;
  }
  me = data;
  localStorage.setItem(`recap_${session.id}`, me.id);
  hideSuggestion();
  render();
}
$("join-btn").onclick = async () => {
  const alias = $("alias").value.trim();
  hideSuggestion();
  $("join-error").textContent = "";
  if (!alias) return ($("join-error").textContent = "Introdu un alias.");
  await register(alias, alias);
};
$("alias-yes").onclick = () => register(suggestedAlias, baseAlias);
$("alias-no").onclick = () => {
  hideSuggestion();
  $("alias").focus();
  $("alias").select();
};

init();
