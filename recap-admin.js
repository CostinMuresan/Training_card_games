import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { TEAMS, otherTeam, createArena, renderLists, createStore, questionsAsText, leafOf, createClock, timerInfo, fmtTime } from "./recap-shared.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let user = null;
let session = null;
let store = null;
let arena = null;
let poll = null;
let busy = false;
const clock = createClock(supabase); // ora serverului
let expiring = false;
let tickCount = 0;
let lastStatus = null; // pentru a strânge „Setări sesiune” o singură dată, la start
let participants = [];
let newIds = new Set();

const code = () => Math.random().toString(36).slice(2, 8).toUpperCase();
// limita de intrebari pe participant: numar intreg intre 0 si 100 (0 = fara limita); nu coboara sub 0
const clampLimit = (v) => Math.min(100, Math.max(0, Math.floor(Number(v) || 0)));
function guardLimitInput(input, onCommit) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "-" || e.key === "+" || e.key === "e" || e.key === "E" || e.key === ".") e.preventDefault(); // doar cifre
  });
  input.addEventListener("input", () => {
    if (input.value !== "" && Number(input.value) < 0) input.value = "0";
  });
  const commit = () => {
    input.value = String(clampLimit(input.value));
    onCommit?.(Number(input.value));
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
}
const joinUrl = () => new URL(`recap.html?s=${session.session_code}`, location.href).href;
const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// deconectare din meniul „Contul meu”
$("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.TCTheme?.useDefault(); // următorul utilizator din același browser nu primește tema acestui trainer
  location.reload();
});

// ---------- autentificare + reluare ----------
async function init() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    user = data.session.user;
    await enterAdmin();
  } else {
    window.TCTheme?.useDefault(); // ecranul de autentificare: mereu tema implicită, la toți
  }
}
async function enterAdmin() {
  $("auth-box").hidden = true;
  window.TCTheme?.initTrainer(supabase, user.email); // tema salvată de trainer
  const { data } = await supabase
    .from("recap_sessions")
    .select("*")
    .eq("admin_email", user.email)
    .neq("status", "ended")
    .order("created_at", { ascending: false })
    .limit(1);
  if (data && data.length) openSession(data[0]);
  else $("creator").hidden = false;
}
$("login").onclick = async () => {
  const { data, error } = await supabase.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  if (error) return ($("auth-error").textContent = error.message);
  user = data.user;
  await enterAdmin();
};

$("create").onclick = async () => {
  $("create-error").textContent = "";
  const { data, error } = await supabase
    .from("recap_sessions")
    .insert({ session_code: code(), admin_email: user.email, topic: $("topic").value.trim(), max_questions: clampLimit($("max-questions").value) })
    .select()
    .single();
  if (error) return ($("create-error").textContent = error.message + " (ai rulat scriptul add-recap.sql în Supabase?)");
  openSession(data);
};

function openSession(s) {
  session = s;
  $("creator").hidden = true;
  $("live").hidden = false;
  $("join-link").textContent = joinUrl();
  $("copy").textContent = "Copiază";
  $("qr-img").style.display = "none";
  $("qr-btn").textContent = "Arată codul QR";
  arena = createArena($("arena"));
  store = createStore(supabase, session.id, { withAuthor: true });
  participants = [];
  render();
  clock.sync();
  tickNow();
  clearInterval(poll);
  poll = setInterval(tickNow, 2500);
}

// ---------- afisare ----------
const STATUS = { lobby: "Lobby", play: "În desfășurare", ended: "Încheiată" };
function render() {
  $("status-badge").textContent = STATUS[session.status];
  $("topic-title").textContent = session.topic || "Recapitulare";
  $("session-code").textContent = session.session_code; // participanții îl scriu pe pagina inițială
  $("code-hint").textContent = `Participanții intră pe ${new URL("index.html", location.href).href.replace(/index\.html$/, "")} și scriu acest cod.`;
  $("topic-line").textContent = session.topic ? `Tema: ${session.topic}` : "";
  if (document.activeElement !== $("max-live")) $("max-live").value = String(session.max_questions || 0);
  $("max-live").disabled = session.status === "ended";
  $("delete-session").hidden = session.status === "play";
  $("delete-session").textContent = session.status === "lobby" ? "Anulează sesiunea" : "Închide de tot";
  $("start-box").hidden = session.status !== "lobby";
  $("resplit").hidden = session.status !== "play";
  $("end").hidden = session.status === "ended";
  $("new-session").hidden = session.status !== "ended";
  $("controls-hint").textContent =
    session.status === "lobby"
      ? "Așteaptă să intre participanții, apoi alege „Start cu timp” sau „Start fără timp”. Cine intră mai târziu este pus automat în echipa mai mică."
      : session.status === "play"
        ? "Participanții își aruncă întrebările. Poți ascunde o întrebare nepotrivită (se ascunde și din ecranele lor) sau poți folosi „Mod proiector” pentru ecranul din sală."
        : "Recapitularea s-a încheiat: nu se mai pot arunca întrebări, iar participanții văd în continuare câmpul de luptă. Copiază întrebările dacă vrei să le păstrezi, apoi „Închide de tot” (șterge sesiunea și oprește linkul) sau „Sesiune nouă”.";
  renderParticipants();
  renderAllowPanel();
  renderTimerPanel();
  // „Setări sesiune” (link, QR, limită) sunt deschise în Lobby și se strâng când începe jocul; rezumatul arată limita curentă
  if (session.status !== lastStatus) {
    $("setup-details").open = session.status === "lobby";
    lastStatus = session.status;
  }
  updateSetupSummary();
}
function updateSetupSummary() {
  $("setup-summary").textContent = `⚙️ Setări sesiune: link, cod QR, limită de întrebări (${session.max_questions ? session.max_questions + " pe participant" : "nelimitat"})`;
}

// ---------- „Permite aruncarea” ----------
function renderAllowPanel() {
  const play = session?.status === "play";
  $("live-bar").hidden = !play; // bara live (aruncare + cronometru) apare doar cât jocul rulează
  $("allow-panel").hidden = !play;
  if (!play) return;
  const on = session.throw_allowed !== false;
  if (document.activeElement !== $("allow-throw")) $("allow-throw").checked = on;
  $("allow-label").textContent = on ? "Aruncare permisă" : "Aruncare oprită";
  $("allow-status").textContent = on
    ? "Aruncarea e permisă: la fiecare întrebare primită apare butonul „Aruncă înapoi”."
    : "Aruncarea e oprită: participanții trimit întrebări, dar fără butonul „Aruncă înapoi” la cele primite.";
}
let allowToastTimer = null;
function allowToast(text) {
  $("allow-toast").textContent = text;
  clearTimeout(allowToastTimer);
  allowToastTimer = setTimeout(() => ($("allow-toast").textContent = ""), 3200);
}
$("allow-throw").onchange = async (e) => {
  const on = e.target.checked;
  const { data, error } = await supabase.from("recap_sessions").update({ throw_allowed: on }).eq("id", session.id).select().single();
  if (error) {
    e.target.checked = !on;
    return alert(error.message + (/throw_allowed|schema|column/i.test(error.message) ? "\n\n(ai rulat scriptul add-recap.sql în Supabase?)" : ""));
  }
  session = data;
  render();
  allowToast(on ? "✔ Participanții pot arunca acum" : "Aruncarea e oprită: întrebările rămân unde sunt");
};

// ---------- cronometru ----------
const minSecToSeconds = (minId, secId) => (Math.max(0, parseInt($(minId).value, 10) || 0) * 60) + Math.min(59, Math.max(0, parseInt($(secId).value, 10) || 0));

function renderTimerPanel() {
  const play = session?.status === "play";
  const info = timerInfo(session, clock.now());
  $("timer-panel").hidden = !play;
  if (!play) {
    $("proj-timer").hidden = true;
    return;
  }
  const none = info.state === "none";
  $("timer-none-box").hidden = !none;
  $("timer-running-box").hidden = none;
  if (!none) {
    $("timer-setup-box").hidden = true;
    const low = info.state === "running" && info.remaining <= 10;
    $("timer-display").textContent = fmtTime(info.remaining);
    $("timer-display").className = `timer-display ${info.state}${low ? " low" : ""}`;
    $("timer-status-label").textContent =
      info.state === "running" ? "Cronometru pornit: vizibil live la participanți" : info.state === "paused" ? "Pauză: participanții văd timpul înghețat și nu pot arunca întrebări" : "⏰ Timpul a expirat: participanții nu mai pot arunca întrebări. Adaugă timp sau încheie sesiunea.";
    $("timer-status-label").className = `timer-status ${info.state === "expired" ? "expired" : ""}`;
    $("timer-pause-btn").textContent = info.state === "paused" ? "Reia" : "Pauză";
    $("timer-pause-btn").hidden = info.state === "expired";
  }
  // același timp, mare, pentru ecranul din sală (mod proiector)
  $("proj-timer").hidden = none;
  if (!none) {
    $("proj-timer").textContent = fmtTime(info.remaining);
    $("proj-timer").className = `proj-timer ${info.state}${info.state === "running" && info.remaining <= 10 ? " low" : ""}`;
  }
}

async function timerAction(action, seconds = 0) {
  const { data, error } = await supabase.rpc("recap_timer", { p_session: session.id, p_action: action, p_seconds: seconds });
  if (error) {
    alert(error.message + (/recap_timer|function|schema/i.test(error.message) ? "\n\n(ai rulat scriptul add-recap.sql în Supabase?)" : ""));
    return null;
  }
  session = data;
  render();
  return data;
}

// la fiecare secundă: afișajul + marcarea expirării (baza de date oprește oricum întrebările după ora de expirare)
setInterval(async () => {
  if (!session) return;
  renderTimerPanel();
  const info = timerInfo(session, clock.now());
  if (session.status === "play" && session.timer_status === "running" && info.state === "expired" && !expiring) {
    expiring = true;
    await timerAction("expire");
    expiring = false;
  }
}, 1000);

function renderParticipants() {
  $("participants-count").textContent = `(${participants.length})`;
  const box = (title, cls, list) => {
    const d = document.createElement("div");
    d.className = `team-box ${cls}`;
    const h = document.createElement("h4");
    h.textContent = `${title} (${list.length})`;
    d.append(h);
    list.forEach((p) => {
      const r = document.createElement("div");
      r.textContent = p.alias;
      d.append(r);
    });
    return d;
  };
  const t1 = participants.filter((p) => p.team === 1);
  const t2 = participants.filter((p) => p.team === 2);
  const t0 = participants.filter((p) => !p.team);
  $("team-boxes").replaceChildren(
    ...(session.status === "lobby" ? [box("În așteptare", "team-0", t0)] : [box(`Echipa ${TEAMS[1].name}`, "team-1", t1), box(`Echipa ${TEAMS[2].name}`, "team-2", t2), ...(t0.length ? [box("Fără echipă", "team-0", t0)] : [])])
  );
}

function drawAll() {
  const aliasById = Object.fromEntries(participants.map((p) => [p.id, p.alias]));
  const all = store.all();
  const c = store.visibleCounts();
  arena.setTotals(c[1], c[2]);
  renderLists($("qlists"), all, {
    showHidden: true,
    newIds,
    author: (q) => aliasById[q.participant_id] || null,
    onToggle: async (q) => {
      // „Ascunde” / „Arată” lucrează pe ultima aruncare din lanț, chiar dacă întrebarea tocmai a fost aruncată înapoi și lista ta nu s-a reîmprospătat încă
      const { data } = await supabase.from("recap_questions").select("id, parent_id, hidden").eq("session_id", session.id);
      const leaf = leafOf(data || [], q.id) || q;
      await supabase.from("recap_questions").update({ hidden: !leaf.hidden }).eq("id", leaf.id);
      await syncQuestions();
    },
  });
}

async function syncQuestions() {
  if (!store || busy) return;
  busy = true;
  try {
    const r = await store.sync();
    r.added.filter((q) => !q.hidden).forEach((q) => {
      arena.fly(q.team);
      newIds.add(q.id);
    });
    drawAll();
    setTimeout(() => (newIds = new Set()), 2300);
  } catch (e) {
    console.error(e);
  } finally {
    busy = false;
  }
}

// ---------- reimprospatare periodica ----------
async function tickNow() {
  if (!session) return;
  if (++tickCount % 12 === 0) clock.sync(); // ceasul serverului se reverifică din când în când
  const [{ data: s }, { data: parts }] = await Promise.all([
    supabase.from("recap_sessions").select("*").eq("id", session.id).maybeSingle(),
    supabase.from("recap_participants").select("id, alias, team, joined_at").eq("session_id", session.id).order("joined_at"),
  ]);
  if (s) session = s;
  participants = parts || [];
  if (session.status === "play") await assignLateJoiners();
  render();
  if (session.status !== "lobby") await syncQuestions();
  else drawAll();
}

// ---------- echipe ----------
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
async function setTeam(ids, team) {
  for (const c of chunk(ids, 50)) await supabase.from("recap_participants").update({ team }).in("id", c);
}
// impartire aleatorie, cat mai egala (la numar impar, echipa mai mare se alege la intamplare)
async function assignTeams(ids) {
  const s = shuffle(ids);
  const n1 = Math.floor(s.length / 2) + (s.length % 2 && Math.random() < 0.5 ? 1 : 0);
  await setTeam(s.slice(0, n1), 1);
  await setTeam(s.slice(n1), 2);
}
async function assignLateJoiners() {
  const un = participants.filter((p) => !p.team);
  if (!un.length) return;
  const count = { 1: participants.filter((p) => p.team === 1).length, 2: participants.filter((p) => p.team === 2).length };
  for (const p of un) {
    const t = count[1] === count[2] ? (Math.random() < 0.5 ? 1 : 2) : count[1] < count[2] ? 1 : 2;
    count[t]++;
    p.team = t;
    await setTeam([p.id], t);
  }
}

// Start: împarte participanții în echipe și pornește (cu timp sau fără timp)
async function startPlay(seconds) {
  const { data: parts } = await supabase.from("recap_participants").select("id").eq("session_id", session.id);
  if (!parts || parts.length < 2) return alert("Sunt necesari cel puțin 2 participanți pentru a forma două echipe.");
  if (seconds !== null && seconds <= 0) return alert("Setează o durată mai mare de 0.");
  await assignTeams(parts.map((p) => p.id));
  const ok = await timerAction(seconds === null ? "play_untimed" : "play_timed", seconds || 0);
  if (ok) await tickNow();
}
$("start").onclick = () => startPlay(null);
$("start-timed").onclick = () => startPlay(minSecToSeconds("start-min", "start-sec"));
$("timer-enable-btn").onclick = () => {
  $("timer-enable-btn").hidden = true;
  $("timer-setup-box").hidden = false;
};
$("timer-cancel-btn").onclick = () => {
  $("timer-setup-box").hidden = true;
  $("timer-enable-btn").hidden = false;
};
$("timer-start-btn").onclick = async () => {
  const sec = minSecToSeconds("timer-min", "timer-sec");
  if (sec <= 0) return alert("Setează o durată mai mare de 0.");
  await timerAction("start", sec);
  $("timer-enable-btn").hidden = false;
};
$("copy-code").onclick = async (e) => {
  await navigator.clipboard.writeText(session.session_code);
  e.target.textContent = "Copiat!";
  setTimeout(() => (e.target.textContent = "Copiază codul"), 1500);
};
$("timer-plus1").onclick = () => timerAction("extend", 60); // adaugă rapid un minut
$("timer-pause-btn").onclick = () => timerAction(session.timer_status === "paused" ? "resume" : "pause");
$("timer-extend-btn").onclick = async () => {
  const sec = minSecToSeconds("timer-extend-min", "timer-extend-sec");
  if (sec <= 0) return;
  await timerAction("extend", sec);
};
$("resplit").onclick = async () => {
  if (!confirm("Reîmpărți aleatoriu participanții în echipe? Întrebările deja aruncate rămân la echipa care le-a aruncat.")) return;
  await assignTeams(participants.map((p) => p.id));
  await tickNow();
};
$("end").onclick = async () => {
  if (!confirm("Închei recapitularea? Participanții nu vor mai putea arunca întrebări.")) return;
  const { data, error } = await supabase.from("recap_sessions").update({ status: "ended" }).eq("id", session.id).select().single();
  if (error) return alert(error.message);
  session = data;
  render();
};
guardLimitInput($("max-questions"));
guardLimitInput($("max-live"), async (v) => {
  if (!session || session.status === "ended" || v === session.max_questions) return;
  const { error } = await supabase.from("recap_sessions").update({ max_questions: v }).eq("id", session.id);
  if (error) return alert(error.message);
  session.max_questions = v;
  updateSetupSummary(); // confirmarea se vede imediat
});
$("delete-session").onclick = async () => {
  const msg =
    session.status === "lobby"
      ? "Anulezi sesiunea? Participanții înscriși vor fi scoși, iar linkul nu va mai funcționa."
      : "Închizi de tot recapitularea?\n\nSe șterg definitiv sesiunea, participanții și întrebările, iar linkul nu va mai funcționa. Dacă vrei să păstrezi întrebările, apasă mai întâi „Copiază întrebările”.";
  if (!confirm(msg)) return;
  const { error } = await supabase.from("recap_sessions").delete().eq("id", session.id);
  if (error) return alert(error.message);
  clearInterval(poll);
  session = null;
  $("live").hidden = true;
  $("creator").hidden = false;
};
$("new-session").onclick = () => {
  clearInterval(poll);
  $("live").hidden = true;
  $("creator").hidden = false;
  session = null;
};

// ---------- cod QR / link / export / proiector ----------
$("copy").onclick = async () => {
  await navigator.clipboard.writeText(joinUrl());
  $("copy").textContent = "Copiat ✓";
};
$("qr-btn").onclick = () => {
  const img = $("qr-img");
  if (img.style.display === "none") {
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl())}`;
    img.style.display = "block";
    $("qr-btn").textContent = "Ascunde codul QR";
  } else {
    img.style.display = "none";
    $("qr-btn").textContent = "Arată codul QR";
  }
};
$("qr-dl-btn").onclick = async () => {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&format=png&data=${encodeURIComponent(joinUrl())}`;
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qr-recapitulare-${session.session_code}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, "_blank");
  }
};
$("copy-questions").onclick = async () => {
  await navigator.clipboard.writeText(questionsAsText(store.all(), session.topic));
  $("copy-questions").textContent = "Copiat ✓";
  setTimeout(() => ($("copy-questions").textContent = "Copiază întrebările"), 2000);
};
$("projector").onclick = () => document.body.classList.add("projector");
$("projector-exit").onclick = () => document.body.classList.remove("projector");

init();
