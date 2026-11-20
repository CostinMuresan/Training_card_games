import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ACTIVITIES, debriefFor, hasCustomDebrief, DEBRIEF, DEBRIEF_MODEL_SHORT_TIME, getRounds, randomVariant, variantLabel, stagesFor, stageLabel, baseClientScenarios, roundOf, parseStatus, MAX_ROUNDS } from "./communication-data.js";
import { compareModel, gridHtml, scoreText, parseSteps, stepsHtml, hydrateOverlays, escapeText, gridFrame, modelRoundSummary, summaryHtml, loadDrawThumbs, fetchFullDrawing, enableLightbox } from "./communication-shared.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

let session = null;
let user = null;
let poll = null;
let lastPromptHtml = "";
let showModel = false; // desenul de referinta: ascuns in timpul rundei, vizibil la reveal
let overlayOn = false; // suprapunere model peste desenele participantilor
let lastStatus = null;
let showPreview = false; // previzualizarea modelelor in lobby: ascunsa implicit (ecranul poate fi proiectat)

function code() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// deconectare din meniul „Contul meu”
$("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.TCTheme?.useDefault(); // următorul utilizator din același browser nu primește tema acestui trainer
  location.reload();
});

// ---------- autentificare + reluare sesiune ----------
async function init() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    user = data.session.user;
    await enterAdmin();
  } else {
    window.TCTheme?.useDefault(); // ecranul de autentificare: mereu tema implicită, la toți
  }
}

function setCreator(visible) {
  $("creator").hidden = !visible;
  $("scenarios").hidden = !visible;
}

async function enterAdmin() {
  $("auth-box").hidden = true;
  window.TCTheme?.initTrainer(supabase, user.email); // tema salvată de trainer
  setCreator(true);
  await loadScenarios();
  await resumeActiveSession();
}

// Dupa refresh / inchiderea tab-ului, reia ultima sesiune neincheiata a acestui trainer
async function resumeActiveSession() {
  const { data } = await supabase
    .from("communication_sessions")
    .select("*")
    .eq("admin_email", user.email)
    .neq("status", "ended")
    .order("created_at", { ascending: false })
    .limit(1);
  if (data && data.length > 0) openSession(data[0]);
}

$("login").onclick = async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (error) {
    $("auth-error").textContent = error.message;
    return;
  }
  user = data.user;
  await enterAdmin();
};

// ---------- creare / deschidere sesiune ----------
document.querySelectorAll("[data-mode]").forEach((b) => {
  b.onclick = () => createSession(b.dataset.mode);
});

async function createSession(mode) {
  let scenario = null;
  if (mode === "draw") {
    const sc = pickScenario();
    if (!sc) {
      setTab("draw"); // (ascunde indicatia, de aceea se afiseaza dupa)
      $("scenario-hint").textContent = "Ca să pornești „Desenează după instrucțiuni”, creează mai întâi un scenariu propriu.";
      $("scenario-hint").hidden = false;
      openScenarioForm();
      $("scenarios").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    scenario = snapshot(sc);
  }
  let promptIndex = randomVariant(mode);
  if (mode === "client") ({ scenario, prompt_index: promptIndex } = pickClientDefault());
  const { data, error } = await supabase
    .from("communication_sessions")
    .insert({ session_code: code(), admin_email: user.email, mode, prompt_index: promptIndex, scenario })
    .select()
    .single();
  if (error) {
    alert(error.message);
    return;
  }
  openSession(data);
}

function openSession(s) {
  session = s;
  setCreator(false);
  $("live").hidden = false;
  $("copy").textContent = "Copiază linkul";
  resetQr();
  startWatch();
  render();
}

function joinUrl() {
  return new URL(`communication.html?s=${session.session_code}`, location.href).href;
}

$("copy").onclick = async () => {
  await navigator.clipboard.writeText(joinUrl());
  $("copy").textContent = "Copiat ✓";
};

// ---------- cod QR (acelasi serviciu si aceleasi butoane ca la celelalte activitati) ----------
function resetQr() {
  $("qr-img").style.display = "none";
  $("qr-btn").textContent = "Cod QR";
}

$("qr-btn").onclick = () => {
  const img = $("qr-img");
  if (img.style.display === "none") {
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl())}`;
    img.style.display = "block";
    $("qr-btn").textContent = "Ascunde codul QR";
  } else {
    resetQr();
  }
};

async function downloadQr(filename, format, triggerBtn) {
  const original = triggerBtn.textContent;
  triggerBtn.textContent = "Se descarcă...";
  triggerBtn.disabled = true;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&format=${format}&data=${encodeURIComponent(joinUrl())}`;
  try {
    const res = await fetch(qrUrl);
    if (!res.ok) throw new Error("Serviciul de QR nu a răspuns");
    const objUrl = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = objUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objUrl);
  } catch (err) {
    // fallback: deschide imaginea intr-un tab nou, ca sa poata fi salvata manual
    window.open(qrUrl, "_blank");
  } finally {
    triggerBtn.textContent = original;
    triggerBtn.disabled = false;
  }
}

$("qr-dl-png-btn").onclick = (e) => downloadQr(`qr-${session.session_code}.png`, "png", e.target);
$("qr-dl-jpg-btn").onclick = (e) => downloadQr(`qr-${session.session_code}.jpg`, "jpg", e.target);

// pătrățele de reper (cu numerotare) peste modelul din „Instrucțiuni trainer” și peste desenele din „Rezultate”.
// Trainerul are nevoie de coordonate ca să dea și să verifice indicații precise, deci grila e PORNITĂ implicit; o poate opri (alegerea rămâne pe dispozitiv).
const GRID_KEY = "comm_grid_admin";
const gridOnAdmin = () => {
  try {
    return localStorage.getItem(GRID_KEY) !== "0";
  } catch {
    return true;
  }
};
function setGridAdmin(on) {
  try {
    localStorage.setItem(GRID_KEY, on ? "1" : "0");
  } catch {
    /* mod privat */
  }
  document.body.classList.toggle("grid-on", on);
  document.querySelectorAll(".grid-check-admin").forEach((c) => (c.checked = on)); // bifa din „Rezultate” și cea de lângă model rămân la fel
}
setGridAdmin(gridOnAdmin());
document.addEventListener("change", (e) => {
  if (e.target.matches?.(".grid-check-admin")) setGridAdmin(e.target.checked);
});

$("overlay-toggle").onchange = (e) => {
  overlayOn = e.target.checked;
  $("results").classList.toggle("show-overlay", overlayOn);
};

// ---------- schimbare varianta (doar in lobby, inainte sa porneasca activitatea) ----------
// Verifica daca baza de date accepta raspunsuri pentru runda `n` (constrangerea veche permitea doar rundele 1 si 2).
// Se incearca o inserare cu identificatori inexistenti: daca esueaza din cauza constrangerii pe runda (23514), baza nu e actualizata;
// altfel esueaza oricum din alt motiv (cheie externa) si nu ramane nimic salvat.
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const roundsProbe = new Map(); // n -> { state: "ok" | "blocked" | "pending", at }
function probeRounds(n) {
  if (n <= 2) return;
  const cur = roundsProbe.get(n);
  if (cur && (cur.state === "ok" || cur.state === "pending" || Date.now() - cur.at < 15000)) return;
  roundsProbe.set(n, { state: "pending", at: Date.now() });
  supabase
    .from("communication_submissions")
    .insert({ session_id: ZERO_UUID, participant_id: ZERO_UUID, round: n, payload: {} })
    .then(async ({ error }) => {
      const blocked = error?.code === "23514";
      if (!error) await supabase.from("communication_submissions").delete().eq("session_id", ZERO_UUID); // (nu ar trebui sa se intample)
      roundsProbe.set(n, { state: blocked ? "blocked" : "ok", at: Date.now() });
      if (session && session.status === "lobby") render();
    });
}
const roundsBlocked = (n) => roundsProbe.get(n)?.state === "blocked";
const ROUNDS_WARNING =
  "Baza de date nu acceptă încă răspunsuri pentru mai mult de 2 runde: rulează o singură dată în Supabase scriptul add-communication-more-rounds.sql, apoi reîncarcă această pagină.";

async function changeScenario(value) {
  if (!session || session.status !== "lobby") return;
  let patch;
  if (session.mode === "client") {
    // „base:N” = scenariu de baza din cod; „custom:ID” = scenariu propriu (se copiaza in sesiune)
    if (value.startsWith("base:")) {
      patch = { scenario: null, prompt_index: Number(value.slice(5)) || 0 };
    } else {
      const sc = myScenarios.find((x) => x.id === value.slice(7));
      if (!sc) return;
      patch = { scenario: snapshot(sc) };
    }
    localStorage.setItem(lastKey("client"), value);
  } else {
    const sc = myScenarios.find((x) => x.id === value);
    if (!sc) return;
    patch = { scenario: snapshot(sc) };
    localStorage.setItem(lastKey("draw"), value);
  }
  const { data, error } = await supabase.from("communication_sessions").update(patch).eq("id", session.id).select().single();
  if (error) return alert(error.message);
  session = data;
  render();
}

async function reroll() {
  if (!session || session.status !== "lobby") return;
  const { data, error } = await supabase
    .from("communication_sessions")
    .update({ prompt_index: randomVariant(session.mode, session.prompt_index) })
    .eq("id", session.id)
    .select()
    .single();
  if (error) return alert(error.message);
  session = data;
  render();
}

// ---------- navigare intre etape ----------
$("next").onclick = () => move(1);
$("back").onclick = () => move(-1);

$("end").onclick = async () => {
  if (!(await TCUI.confirm("Sigur închei sesiunea? Participanții nu vor mai putea continua și nu se poate relua.", { title: "Încheie sesiunea", confirmLabel: "Încheie sesiunea", danger: true }))) return;
  await supabase.from("communication_sessions").update({ status: "ended" }).eq("id", session.id);
  session.status = "ended";
  render();
};

async function move(delta) {
  if (delta > 0 && session.status === "lobby" && (session.mode === "draw" || session.mode === "model")) {
    const n = getRounds(session.mode, session.prompt_index, session.scenario).length;
    if (roundsBlocked(n)) return alert(ROUNDS_WARNING);
  }
  const stages = stagesFor(session.mode, session);
  const i = Math.max(0, stages.indexOf(session.status)); // o sesiune veche cu etapa necunoscuta porneste de la inceput
  const next = stages[Math.max(0, Math.min(stages.length - 1, i + delta))];
  const { data, error } = await supabase
    .from("communication_sessions")
    .update({ status: next })
    .eq("id", session.id)
    .select()
    .single();
  if (error) {
    // constrangerea veche din baza de date nu accepta etapele noi („Răspunsurile tuturor”)
    const old = error.code === "23514" || /check constraint|violates check/i.test(error.message || "");
    alert(
      old
        ? "Etapa nu poate fi salvată: baza de date nu cunoaște încă etapele noi (de ex. pașii „Răspunsurile/Desenele tuturor” sau runda 3 și următoarele). Rulează o singură dată în Supabase scriptul add-communication-more-rounds.sql."
        : error.message
    );
    return;
  }
  session = data;
  render();
}

// ---------- afisare ----------
const targetHtml = gridHtml;

async function render() {
  if (!session) return;
  const a = ACTIVITIES[session.mode];
  const ended = session.status === "ended";

  $("mode-badge").textContent = stageLabel(session.mode, session.status, session);
  $("activity-title").textContent = a.name;
  $("join-link").textContent = joinUrl();
  $("session-code").textContent = session.session_code; // participanții îl scriu pe pagina inițială
  $("code-hint").textContent = `Participanții intră pe ${new URL("index.html", location.href).href.replace(/index\.html$/, "")} și scriu acest cod.`;
  $("copy-code").onclick = async (e) => {
    await navigator.clipboard.writeText(session.session_code);
    e.target.textContent = "Copiat!";
    setTimeout(() => (e.target.textContent = "Copiază codul"), 1500);
  };
  $("status-line").textContent = `Etapa curentă: ${stageLabel(session.mode, session.status, session)}`;
  $("back").disabled = session.status === "lobby" || ended;
  $("next").disabled = ended;
  $("end").disabled = ended;
  // hint deasupra fiecarui buton: etapa la care se ajunge cu click pe butonul de dedesubt
  {
    const stages = stagesFor(session.mode, session);
    const idx = Math.max(0, stages.indexOf(session.status));
    const name = (st) => `<b>${escapeHtml(stageLabel(session.mode, st, session))}</b>`;
    $("back-hint").innerHTML = ended ? "" : idx > 0 ? `Înapoi la: ${name(stages[idx - 1])}` : "Ești la începutul sesiunii.";
    const nxt = stages[idx + 1];
    $("next-hint").innerHTML = ended
      ? "Sesiunea s-a încheiat."
      : !nxt
        ? ""
        : nxt === "ended"
          ? `Urmează: ${name(nxt)} (sesiunea se închide)`
          : `Urmează: ${name(nxt)}`;
  }
  $("link-area").hidden = ended;
  $("ended-note").hidden = !ended;

  // dupa incheiere oprim verificarea periodica si permitem crearea unei sesiuni noi
  if (ended) {
    clearInterval(poll);
    setCreator(true);
  }

  const isModel = session.mode === "model";
  const rounds_n = getRounds(session.mode, session.prompt_index, session.scenario).length;
  const r = roundOf(session.status) - 1;
  const p = getRounds(session.mode, session.prompt_index, session.scenario)[r];
  let html = "";
  if (session.status !== lastStatus) {
    lastStatus = session.status;
    showPreview = false;
    showModel = session.status.includes("reveal") || session.status.endsWith("_results");
  }

  if (session.status === "lobby") {
    if (session.mode === "draw") {
      const current = session.scenario;
      const nRounds = getRounds(session.mode, session.prompt_index, session.scenario).length;
      const options = [...scenariosOf("draw")];
      if (current && !options.some((o) => o.id === current.id)) options.unshift(current); // scenariu sters intre timp: ramane in sesiune
      html = `<p>Distribuie linkul. Pornește când participanții au intrat.</p>
        <p><b>Scenariu:</b> <select id="scenario-select">${options
          .map((o) => `<option value="${escapeHtml(o.id)}"${current && o.id === current.id ? " selected" : ""}>${escapeHtml(o.title)}</option>`)
          .join("")}</select></p>
        <p class="hint">${nRounds} ${nRounds === 1 ? "rundă" : "runde"}. Scenariile se gestionează mai jos, la „Scenariile mele”.</p>
        ${roundsBlocked(nRounds) ? `<p class="error-msg">${ROUNDS_WARNING}</p>` : ""}`;
      probeRounds(nRounds);
    } else if (session.mode === "client") {
      const cur = session.scenario;
      const base = baseClientScenarios();
      const baseSel = cur ? -1 : (Number(session.prompt_index) || 0) % base.length;
      const mine = [...scenariosOf("client")];
      if (cur && !mine.some((o) => o.id === cur.id)) mine.unshift(cur); // scenariu sters intre timp: ramane in sesiune
      const nRounds = getRounds(session.mode, session.prompt_index, session.scenario).length;
      html = `<p>Distribuie linkul. Pornește când participanții au intrat.</p>
        <p><b>Scenariu:</b> <select id="scenario-select">
          ${mine.length ? `<optgroup label="Scenariile mele">${mine.map((o) => `<option value="custom:${escapeHtml(o.id)}"${cur && o.id === cur.id ? " selected" : ""}>${escapeHtml(o.title)}</option>`).join("")}</optgroup>` : ""}
          <optgroup label="Scenarii de bază">${base.map((b) => `<option value="base:${b.index}"${b.index === baseSel ? " selected" : ""}>${escapeHtml(b.title)}</option>`).join("")}</optgroup>
        </select></p>
        <p class="hint">${nRounds} ${nRounds === 1 ? "rundă" : "runde"}. Scenariile tale se gestionează mai jos, la „Scenariile mele” → „Ce ai înțeles?”.</p>`;
    } else {
      const nRounds = getRounds(session.mode, session.prompt_index, session.scenario).length;
      html = `<p>Distribuie linkul. Pornește când participanții au intrat.</p>
        <p><b>Variantă:</b> ${escapeHtml(variantLabel(session.mode, session.prompt_index, session.scenario))}</p>
        <p class="hint">${nRounds} runde: descriere interpretabilă → descriere stufoasă → descriere exactă, cu sistem de referință. Fiecare rundă are alt model.</p>
        ${roundsBlocked(nRounds) ? `<p class="error-msg">${ROUNDS_WARNING}</p>` : ""}
        <button class="btn outline" id="reroll" data-icon="shuffle">Altă variantă</button>
        <button class="btn outline" id="toggle-preview" data-icon="eye">${showPreview ? "Ascunde previzualizarea" : "Previzualizează modelele"}</button>
        ${
          showPreview
            ? `<div class="preview-row">${getRounds(session.mode, session.prompt_index, session.scenario)
                .map(
                  (r, i) => `<figure><figcaption><b>Runda ${i + 1}</b> · ${escapeHtml(r.styleLabel)}</figcaption>${gridHtml(r.target, {}, { axes: r.axes })}
                    <details><summary>Descrierea de citit</summary><div class="preview-guide">${escapeHtml(r.guide).replace(/\n/g, "<br>")}</div></details></figure>`
                )
                .join("")}</div>
              <p class="hint">Previzualizarea e vizibilă doar pe ecranul tău. Dacă îl proiectezi, ascunde-o înainte ca participanții să vadă ecranul.</p>`
            : `<p class="hint">Previzualizarea modelelor este ascunsă, ca să nu apară pe ecranul proiectat.</p>`
        }`;
      probeRounds(nRounds);
    }
  } else if (session.status === "debrief") {
    html = `<ol>${debriefFor(session.mode, session.scenario).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol>`;
    if (hasCustomDebrief(session.scenario)) html = `<p class="hint">Întrebările de debrief ale scenariului „${escapeHtml(session.scenario.title || "")}”.</p>` + html;
    if (session.mode === "model") html += `<div id="debrief-summary"></div><p class="hint">${DEBRIEF_MODEL_SHORT_TIME}</p>`;
  } else if (isModel && !ended) {
    const { kind, n } = parseStatus(session.status);
    const head = `<p><b>Runda ${n} din ${rounds_n} · ${escapeHtml(p.styleLabel)}</b></p>`;
    if (kind === "round") {
      html = `${head}<p>${escapeHtml(p.tip)}</p>
        <div class="rule"><b>Descriere de citit:</b><br>${escapeHtml(p.guide).replace(/\n/g, "<br>")}</div>
        <p class="hint">Nu arăta grila și nu răspunde la întrebări. Participanții așază piesele; când treci la pasul următor, ce au pe grilă se trimite automat.</p>`;
    } else if (kind === "reveal") {
      html = `${head}<p><b>Reveal individual</b></p>
        <p>Fiecare participant vede, pe ecranul lui, modelul și ce a realizat (verde = piesă la locul ei, roșu = greșită sau în plus). Lasă-le timp, apoi treci la pasul următor.</p>`;
    } else {
      html = `${head}<p><b>Rezultatele tuturor</b></p>
        <p>Participanții văd acum rezultatele tuturor colegilor (anonim), alături de model. Discutați de ce descrierea a dus la aceste așezări${n < rounds_n ? ", apoi treceți la runda următoare" : ", apoi la debrief"}.</p>`;
    }
  } else if (!ended) {
    html = `<p><b>${escapeHtml(p.title)}</b></p><p>${escapeHtml(p.rule)}</p>`;
    if (session.mode === "draw" && session.status.endsWith("_results")) {
      html += `<p class="rule"><b>Desenele tuturor.</b> Participanții văd acum, pe ecranul lor, modelul, desenul propriu (primul) și desenele celorlalți colegi, anonim. Discutați diferențele.</p>`;
    }
    if (session.mode === "draw") {
      html += `<div class="rule"><b>Instrucțiuni de rostit:</b>${stepsHtml(p.steps)}</div>`;
    }
    if (session.mode === "draw" && p.image) {
      html += `<div class="model-fig-block">
        <button class="btn outline" id="toggle-model">${showModel ? "Ascunde modelul" : "Arată modelul"}</button>
        <label class="overlay-control grid-control-inline"><input type="checkbox" class="grid-check-admin"> Pătrățele (reper: coloane A–L, rânduri 1–9)</label>
        <p class="hint">Cu pătrățelele pornite poți da și verifica indicații precise, cu coordonate: „începe în C4”, „cercul în F6”. Participanții își pornesc grila din butonul „▦ Grilă” de pe canvas.</p>
        ${showModel ? gridFrame(`<div class="model-fig"><img src="${escapeHtml(p.image)}" alt="Modelul"></div>`, "model") : ""}
      </div>`;
    }
    if (session.mode === "model") {
      html += `<div class="rule"><b>Descriere pentru ghid:</b><br>${escapeHtml(p.guide).replace(/\n/g, "<br>")}</div>`;
    }
    if (session.mode === "client") {
      if (session.status.endsWith("_results")) {
        html += `<p class="rule"><b>Răspunsurile tuturor.</b> Participanții văd acum, pe ecranul lor, răspunsurile tuturor colegilor (anonim), cu al lor primul. Informația lipsă nu li se mai afișează. Discutați diferențele de interpretare.</p>`;
      }
      html += `<div class="rule"><b>Mesaj:</b> ${escapeHtml(p.message)}</div>`;
      if (session.status.includes("reveal") || session.status.endsWith("_results")) {
        html += `<p><b>Informația lipsă</b> (doar pentru trainer): ${escapeHtml(p.detail)}</p>`;
      }
    }
  }
  if (html !== lastPromptHtml) {
    $("trainer-prompt").innerHTML = html;
    lastPromptHtml = html;
    document.querySelectorAll(".grid-check-admin").forEach((c) => (c.checked = gridOnAdmin()));
    if ($("reroll")) $("reroll").onclick = reroll;
    if ($("toggle-preview")) {
      $("toggle-preview").onclick = () => {
        showPreview = !showPreview;
        render();
      };
    }
    if ($("scenario-select")) $("scenario-select").onchange = (e) => changeScenario(e.target.value);
    if ($("toggle-model")) {
      $("toggle-model").onclick = () => {
        showModel = !showModel;
        render();
      };
    }
  }

  // comutatorul de suprapunere apare doar la desen, dupa lobby
  $("overlay-control").hidden = !(session.mode === "draw" && p.image && session.status !== "lobby");
  $("grid-control").hidden = !(session.mode === "draw" && session.status !== "lobby");

  $("target").innerHTML =
    isModel && parseStatus(session.status).n > 0
      ? `<h4>Model-țintă · runda ${r + 1}</h4>${targetHtml(p.target, {}, { axes: p.axes })}`
      : "";

  await loadData();
}

async function loadData() {
  const isDraw = session.mode === "draw";
  // la desen NU se aduc imaginile la fiecare reimprospatare: doar lista (cateva zeci de octeti pe raspuns);
  // miniaturile se cer numai pentru desenele noi sau schimbate si se tin in memorie
  const subsQuery = isDraw
    ? supabase.from("communication_submissions").select("id, participant_id, round, submitted_at, kind:payload->>type").eq("session_id", session.id)
    : supabase.from("communication_submissions").select("*").eq("session_id", session.id);
  const [{ data: parts }, { data: subsRaw }] = await Promise.all([
    supabase.from("communication_participants").select("*").eq("session_id", session.id).order("joined_at"),
    subsQuery,
  ]);

  $("participants-count").textContent = `(${(parts || []).length})`; // câți participanți s-au înscris
  $("participants").innerHTML =
    (parts || []).map((p) => `<div>✓ ${escapeHtml(p.alias)}</div>`).join("") || "Niciun participant încă.";

  const ended = session.status === "ended";
  const isModel = session.mode === "model";
  const rounds = getRounds(session.mode, session.prompt_index, session.scenario);
  const round = session.status === "debrief" ? rounds.length : roundOf(session.status); // la debrief: ultima runda
  let subs = subsRaw || [];
  if (isDraw) {
    const wanted = subs.filter((s) => s.kind === "draw" && (ended ? true : s.round === round));
    const thumb = await loadDrawThumbs(supabase, wanted);
    subs = wanted.map((s) => ({ ...s, payload: { type: "draw", image: thumb(s) } })).filter((s) => s.payload.image);
  }
  const aliasById = Object.fromEntries((parts || []).map((p) => [p.id, p.alias]));
  $("results").innerHTML =
    (subs || [])
      .filter((s) => (ended ? true : s.round === round))
      .sort((x, y) => x.round - y.round)
      .map((s) =>
        resultCard(
          (aliasById[s.participant_id] || "Participant") + (ended ? ` · runda ${s.round}` : ""),
          s.payload,
          rounds[s.round - 1]?.image,
          rounds[s.round - 1]?.target,
          rounds[s.round - 1]?.axes,
          s.id
        )
      )
      .join("") || (ended ? "Niciun răspuns trimis în această sesiune." : "Niciun răspuns pentru această rundă.");
  hydrateOverlays($("results"));
  if (isModel && session.status === "debrief" && $("debrief-summary")) {
    $("debrief-summary").innerHTML = summaryHtml(modelRoundSummary(subs, rounds), false);
  }
  $("results").classList.toggle("is-draw", session.mode === "draw");
  $("results").classList.toggle("show-overlay", overlayOn);
}

function resultCard(alias, p, refImage, target, axes, sid) {
  let body = "";
  if (p.type === "draw") {
    body = gridFrame(`<div class="draw-wrap"><img src="${p.image}" alt="Desen"${sid ? ` data-sid="${escapeHtml(String(sid))}"` : ""}>${refImage ? `<div class="model-overlay" data-src="${escapeHtml(refImage)}"></div>` : ""}</div>`);
  }
  if (p.type === "model") {
    const cmp = target ? compareModel(target, p.positions || []) : null;
    body = targetHtml(p.positions || [], cmp?.marks, { axes }) + (cmp ? `<p class="hint">${scoreText(cmp)}</p>` : "");
  }
  if (p.type === "client") {
    body =
      (p.assumption ? `<p><b>Interpretare:</b> ${escapeHtml(p.assumption)}</p>` : "") +
      (p.question ? `<p><b>Clarificare:</b> ${escapeHtml(p.question)}</p>` : "") +
      `<p><b>Răspuns:</b> ${escapeHtml(p.answer)}</p>`;
  }
  return `<article class="result-card"><b>${escapeHtml(alias)}</b>${body}</article>`;
}

function startWatch() {
  clearInterval(poll);
  poll = setInterval(async () => {
    const { data } = await supabase.from("communication_sessions").select("*").eq("id", session.id).single();
    if (data) session = data;
    render();
  }, 3000);
}

// =====================================================================
//  „Scenariile mele” (desen + „Ce ai înțeles?”): fiecare trainer își creează scenariile; ale altora nu se văd
// =====================================================================
let myScenarios = []; // toate scenariile mele (ambele moduri)
let scenarioTab = "draw"; // fila activă din panou
let form = null; // starea formularului: { id, mode, title, rounds: [...] }

const lastKey = (m = "draw") => `comm_last_${m === "client" ? "client_" : ""}scenario_${(user?.email || "").toLowerCase()}`;
const snapshot = (sc) => ({ id: sc.id, title: sc.title, rounds: sc.rounds, debrief: hasCustomDebrief(sc) ? sc.debrief : null }); // copia din sesiune: și întrebările de debrief ale scenariului
const scenariosOf = (m) => myScenarios.filter((s) => s.mode === m);

async function loadScenarios() {
  const { data, error } = await supabase
    .from("communication_scenarios")
    .select("*")
    .eq("owner_email", user.email.toLowerCase())
    .order("created_at", { ascending: false });
  if (error) {
    $("scenario-list").innerHTML = `<p class="error-msg">Nu pot citi scenariile: ${escapeHtml(error.message)}. Ai rulat scriptul SQL pentru scenarii?</p>`;
    myScenarios = [];
    return;
  }
  myScenarios = data || [];
  renderScenarioList();
}

function pickScenario() {
  const mine = scenariosOf("draw");
  const last = localStorage.getItem(lastKey("draw"));
  return mine.find((s) => s.id === last) || mine[0] || null;
}

// „Ce ai înțeles?”: implicit ultimul scenariu folosit (propriu sau de bază); altfel unul de bază, aleatoriu
function pickClientDefault() {
  const last = localStorage.getItem(lastKey("client")) || "";
  if (last.startsWith("custom:")) {
    const sc = scenariosOf("client").find((s) => s.id === last.slice(7));
    if (sc) return { scenario: snapshot(sc), prompt_index: 0 };
  }
  if (last.startsWith("base:")) return { scenario: null, prompt_index: Number(last.slice(5)) || 0 };
  return { scenario: null, prompt_index: randomVariant("client") };
}

function setTab(tab) {
  scenarioTab = tab;
  closeScenarioForm();
  $("scenario-hint").hidden = true;
  renderScenarioList();
}

function renderScenarioList() {
  for (const t of ["draw", "client"]) {
    $(`sc-tab-${t}`).setAttribute("aria-selected", String(scenarioTab === t));
  }
  const n = (s) => `${s.rounds.length} ${s.rounds.length === 1 ? "rundă" : "runde"}`;
  $("scenario-list").innerHTML =
    scenariosOf(scenarioTab)
      .map(
        (s) => `<div class="sc-item"><b>${escapeHtml(s.title)}</b>
          <span class="hint">${n(s)}${scenarioTab === "draw" && s.rounds.some((r) => r.image_url) ? " · cu imagine" : ""}${hasCustomDebrief(s) ? " · debrief propriu" : ""}</span>
          <button class="btn outline" data-sc-edit="${escapeHtml(s.id)}">Editează</button>
          <button class="btn outline" data-sc-del="${escapeHtml(s.id)}">Șterge</button></div>`
      )
      .join("") || `<p class="hint">Nu ai niciun scenariu încă.</p>`;
  $("base-scenarios").innerHTML =
    scenarioTab === "client"
      ? `<h3>Scenarii de bază</h3>
         <p class="hint">Sunt puncte de pornire, comune tuturor trainerilor, și nu se pot modifica. Copiază unul în „Scenariile mele” ca să-l editezi.</p>` +
        baseClientScenarios()
          .map(
            (b) => `<div class="sc-item"><b>${escapeHtml(b.title)}</b><span class="hint">${n(b)} · de bază</span>
              <button class="btn outline" data-sc-copy="${b.index}">Copiază în scenariile mele</button></div>`
          )
          .join("")
      : "";
  document.querySelectorAll("[data-sc-edit]").forEach((b) => (b.onclick = () => openScenarioForm(b.dataset.scEdit)));
  document.querySelectorAll("[data-sc-del]").forEach((b) => (b.onclick = () => deleteScenario(b.dataset.scDel)));
  document.querySelectorAll("[data-sc-copy]").forEach((b) => (b.onclick = () => copyBaseScenario(Number(b.dataset.scCopy))));
}

function blankRound(i, mode) {
  return mode === "client"
    ? { title: "", message: "", detail: "" }
    : { title: "", stepsText: "", image_url: null, blob: null, blobUrl: null, questions: i >= 1 };
}

function openScenarioForm(id = null) {
  const sc = id ? myScenarios.find((s) => s.id === id) : null;
  const mode = sc?.mode || scenarioTab;
  form = {
    id: sc?.id || null,
    mode,
    title: sc?.title || "",
    debrief: (sc?.debrief || []).join("\n"),
    hadDebrief: hasCustomDebrief(sc), // scenariul avea deja întrebări proprii (deci coloana există): se poate și goli
    rounds: sc
      ? sc.rounds.map((r) =>
          mode === "client"
            ? { title: r.title || "", message: r.message || "", detail: r.detail || "" }
            : { title: r.title || "", stepsText: (r.steps || []).join("\n"), image_url: r.image_url || null, blob: null, blobUrl: null, questions: !!r.questions }
        )
      : [blankRound(0, mode)],
  };
  $("scenario-form-title").textContent = sc ? "Editează scenariul" : "Scenariu nou";
  $("sc-title").value = form.title;
  $("sc-debrief").value = form.debrief;
  updateDebriefPreview();
  $("sc-error").textContent = "";
  renderFormRounds();
  $("scenario-form").hidden = false;
  $("scenario-new").hidden = true;
  $("sc-title").focus();
}

function closeScenarioForm() {
  form?.rounds.forEach((r) => r.blobUrl && URL.revokeObjectURL(r.blobUrl));
  form = null;
  $("scenario-form").hidden = true;
  $("scenario-new").hidden = false;
}

function renderFormRounds() {
  if (form.mode === "client") {
    $("sc-rounds").innerHTML = form.rounds
      .map(
        (r, i) => `<fieldset class="sc-round">
          <legend>Runda ${i + 1} · ${i === 0 ? "fără clarificări" : "cu clarificări"}</legend>
          <label for="sc-r${i}-title">Titlul rundei (opțional)</label>
          <input id="sc-r${i}-title" type="text" maxlength="80" placeholder="implicit: numele scenariului" value="${escapeHtml(r.title)}">
          <label for="sc-r${i}-message">Mesajul clientului (îl văd participanții)</label>
          <textarea id="sc-r${i}-message" rows="3" placeholder="ex. Mi-ați blocat cardul exact când aveam nevoie de el.">${escapeHtml(r.message)}</textarea>
          <label for="sc-r${i}-detail">Informația lipsă (o vezi doar tu, ca trainer; se dezvăluie la Reveal)</label>
          <textarea id="sc-r${i}-detail" rows="3" placeholder="ex. Cardul este activ. Tranzacția a fost refuzată doar la un comerciant online.">${escapeHtml(r.detail)}</textarea>
        </fieldset>`
      )
      .join("");
    updateRoundButtons();
    return;
  }
  $("sc-rounds").innerHTML = form.rounds
    .map(
      (r, i) => `<fieldset class="sc-round">
        <legend>Runda ${i + 1}</legend>
        <label for="sc-r${i}-title">Titlul rundei (opțional)</label>
        <input id="sc-r${i}-title" type="text" maxlength="80" placeholder="implicit: numele scenariului" value="${escapeHtml(r.title)}">
        <label for="sc-r${i}-steps">Instrucțiunile pe care le rostește trainerul (câte una pe rând; se numerotează automat)</label>
        <p class="hint">Canvasul are pătrățele: <b>12 coloane (A–L)</b> și <b>9 rânduri (1–9)</b>, pe care participantul le pornește din butonul „Grilă” (nu apar în desenul trimis). Poți scrie instrucțiuni precum „Începe în C4” sau „Desenează un cerc în pătrățelul F6”.</p>
        <textarea id="sc-r${i}-steps" rows="6" placeholder="Desenează un pătrat mare în centru&#10;În interior, un cerc mic sus-stânga&#10;Sub cerc, un triunghi">${escapeHtml(r.stepsText)}</textarea>
        <div class="sc-preview"><b>Previzualizare:</b><div id="sc-r${i}-preview"></div></div>
        <label for="sc-r${i}-image">Imagine de referință (opțional): PNG, JPG sau BMP</label>
        <input type="file" id="sc-r${i}-image" accept=".png,.jpg,.jpeg,.bmp,.webp,image/*">
        <div class="sc-img-preview" id="sc-r${i}-img"></div>
        <button class="btn outline" id="sc-r${i}-img-remove" hidden>Elimină imaginea</button>
        <label class="check"><input type="checkbox" id="sc-r${i}-q"${r.questions ? " checked" : ""}> Participanții pot pune întrebări de clarificare în această rundă</label>
      </fieldset>`
    )
    .join("");
  form.rounds.forEach((r, i) => {
    const refreshPreview = () => {
      $(`sc-r${i}-preview`).innerHTML = stepsHtml(parseSteps($(`sc-r${i}-steps`).value)) || `<span class="hint">Scrie instrucțiunile, câte una pe rând.</span>`;
    };
    $(`sc-r${i}-steps`).oninput = refreshPreview;
    refreshPreview();
    const showImage = () => {
      const src = r.blobUrl || r.image_url;
      $(`sc-r${i}-img`).innerHTML = src ? `<img src="${escapeHtml(src)}" alt="Imagine de referință">` : "";
      $(`sc-r${i}-img-remove`).hidden = !src;
    };
    showImage();
    $(`sc-r${i}-image`).onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const blob = await prepareImage(file);
        if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
        r.blob = blob;
        r.blobUrl = URL.createObjectURL(blob);
        $("sc-error").textContent = "";
        showImage();
      } catch (err) {
        $("sc-error").textContent = err.message;
        e.target.value = "";
      }
    };
    $(`sc-r${i}-img-remove`).onclick = () => {
      if (r.blobUrl) URL.revokeObjectURL(r.blobUrl);
      r.blob = null;
      r.blobUrl = null;
      r.image_url = null;
      $(`sc-r${i}-image`).value = "";
      showImage();
    };
  });
  updateRoundButtons();
}

// butoanele de adaugare/eliminare runda: desen pana la MAX_ROUNDS, „Ce ai inteles?” pana la 2
function updateRoundButtons() {
  const max = form.mode === "client" ? 2 : MAX_ROUNDS;
  const n = form.rounds.length;
  $("sc-add-round").hidden = n >= max;
  $("sc-add-round").textContent = `Adaugă runda ${n + 1}`;
  $("sc-remove-round").hidden = n < 2;
  $("sc-remove-round").textContent = `Elimină runda ${n}`;
}

// citeste valorile din campuri in starea formularului
const MAX_DEBRIEF = 10;
const MAX_DEBRIEF_LEN = 300;
function updateDebriefPreview() {
  const qs = parseSteps($("sc-debrief").value);
  $("sc-debrief-preview").innerHTML = stepsHtml(qs) || '<span class="hint">Nicio întrebare proprie: se folosesc cele standard.</span>';
  $("sc-debrief-count").textContent = qs.length ? `(${qs.length} din cel mult ${MAX_DEBRIEF})` : "";
}
$("sc-debrief").addEventListener("input", updateDebriefPreview);
$("sc-debrief-defaults").onclick = () => {
  $("sc-debrief").value = DEBRIEF.join("\n");
  updateDebriefPreview();
  $("sc-debrief").focus();
};

function syncForm() {
  form.title = $("sc-title").value.trim();
  form.debrief = $("sc-debrief").value;
  form.rounds.forEach((r, i) => {
    r.title = $(`sc-r${i}-title`).value.trim();
    if (form.mode === "client") {
      r.message = $(`sc-r${i}-message`).value;
      r.detail = $(`sc-r${i}-detail`).value;
    } else {
      r.stepsText = $(`sc-r${i}-steps`).value;
      r.questions = $(`sc-r${i}-q`).checked;
    }
  });
}

// Imaginea se aduce la 4:3 (fundal alb), max. 1600x1200, JPEG: se potriveste peste zona de desen, iar BMP/PNG devin fisiere mici
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Nu pot citi imaginea. Folosește un fișier PNG, JPG sau BMP."));
      i.src = url;
    });
    const W = 1600;
    const H = 1200;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W, H);
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("Nu am putut pregăti imaginea.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadImage(blob) {
  const slug = user.email.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const path = `communication/${slug}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from("card-images").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("Încărcarea imaginii a eșuat: " + error.message);
  return supabase.storage.from("card-images").getPublicUrl(path).data.publicUrl;
}

async function saveScenario() {
  syncForm();
  const err = $("sc-error");
  err.textContent = "";
  if (!form.title) return (err.textContent = "Dă un nume scenariului.");

  let validate;
  if (form.mode === "client") {
    const noMsg = form.rounds.findIndex((r) => !r.message.trim());
    if (noMsg >= 0) return (err.textContent = `Runda ${noMsg + 1}: scrie mesajul clientului.`);
    const noDetail = form.rounds.findIndex((r) => !r.detail.trim());
    if (noDetail >= 0) return (err.textContent = `Runda ${noDetail + 1}: scrie informația lipsă (o vezi doar tu, se dezvăluie la Reveal).`);
  } else {
    validate = form.rounds.map((r) => parseSteps(r.stepsText));
    const empty = validate.findIndex((s) => !s.length);
    if (empty >= 0) return (err.textContent = `Runda ${empty + 1}: scrie cel puțin o instrucțiune.`);
  }

  const debrief = parseSteps(form.debrief);
  if (debrief.length > MAX_DEBRIEF) return (err.textContent = `Cel mult ${MAX_DEBRIEF} întrebări de debrief (acum sunt ${debrief.length}).`);
  const tooLong = debrief.findIndex((q) => q.length > MAX_DEBRIEF_LEN);
  if (tooLong >= 0) return (err.textContent = `Întrebarea de debrief ${tooLong + 1} are ${debrief[tooLong].length} de caractere; maximum ${MAX_DEBRIEF_LEN}.`);

  $("sc-save").disabled = true;
  try {
    const rounds = [];
    for (let i = 0; i < form.rounds.length; i++) {
      const r = form.rounds[i];
      if (form.mode === "client") {
        rounds.push({ title: r.title, message: r.message.trim(), detail: r.detail.trim() });
      } else {
        const image_url = r.blob ? await uploadImage(r.blob) : r.image_url;
        rounds.push({ title: r.title, steps: validate[i], questions: r.questions, image_url: image_url || null });
      }
    }
    const row = { owner_email: user.email.toLowerCase(), mode: form.mode, title: form.title, rounds };
    // coloana apare în rând doar dacă ai întrebări proprii (sau le-ai golit pe cele vechi): scenariile obișnuite se salvează la fel ca până acum
    if (debrief.length || form.hadDebrief) row.debrief = debrief.length ? debrief : null;
    const q = form.id
      ? supabase.from("communication_scenarios").update(row).eq("id", form.id)
      : supabase.from("communication_scenarios").insert(row);
    const { error } = await q;
    if (error) throw new Error(error.message + (/debrief/i.test(error.message) ? " (ai rulat scriptul add-scenario-debrief.sql în Supabase?)" : ""));
    closeScenarioForm();
    $("scenario-hint").hidden = true;
    await loadScenarios();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    $("sc-save").disabled = false;
  }
}

// copiaza un scenariu de baza (din cod) in scenariile mele, ca sa poata fi editat
async function copyBaseScenario(index) {
  const b = baseClientScenarios()[index];
  if (!b) return;
  const row = {
    owner_email: user.email.toLowerCase(),
    mode: "client",
    title: `${b.title} (copie)`,
    rounds: b.rounds.map((r) => ({ title: r.title, message: r.message, detail: r.detail })),
  };
  const { error } = await supabase.from("communication_scenarios").insert(row);
  if (error) return alert(error.message);
  await loadScenarios();
}

async function deleteScenario(id) {
  const sc = myScenarios.find((s) => s.id === id);
  if (!sc || !(await TCUI.confirm(`Ștergi scenariul „${sc.title}”? Sesiunile deja pornite nu sunt afectate.`, { title: "Șterge scenariul", confirmLabel: "Șterge", danger: true }))) return;
  const { error } = await supabase.from("communication_scenarios").delete().eq("id", id);
  if (error) return alert(error.message);
  await loadScenarios();
}

$("scenario-new").onclick = () => openScenarioForm();
$("sc-tab-draw").onclick = () => setTab("draw");
$("sc-tab-client").onclick = () => setTab("client");
$("sc-cancel").onclick = closeScenarioForm;
$("sc-save").onclick = saveScenario;
$("sc-add-round").onclick = () => {
  syncForm();
  form.rounds.push(blankRound(form.rounds.length, form.mode));
  renderFormRounds();
};
$("sc-remove-round").onclick = () => {
  syncForm();
  form.rounds.pop();
  renderFormRounds();
};

// atingerea unui desen din „Rezultate” il deschide marit (se descarca atunci)
enableLightbox($("results"), (id) => fetchFullDrawing(supabase, id));

init();
