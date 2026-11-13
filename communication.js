import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ACTIVITIES, debriefFor, hasCustomDebrief, DEBRIEF_MODEL_TRANSFER, getRounds, roundOf, isRoundStatus } from "./communication-data.js";
import { compareModel, gridHtml, scoreText, stepsHtml, hydrateOverlays, modelRoundSummary, summaryHtml, exportDrawing, gridFrame, gridLinesHtml, loadDrawThumbs, fetchFullDrawing, enableLightbox } from "./communication-shared.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

// ---------- grila de pătrățele: o pornește / o oprește participantul ----------
// Implicit e OPRITĂ, la toți, pe laptop și pe telefon. Alegerea se păstrează doar în sesiunea curentă (rămâne la reîncărcare și între runde),
// nu și în sesiunile următoare: o sesiune nouă începe mereu cu grila oprită.
const GRID_KEY = `comm_grid_${new URLSearchParams(location.search).get("s") || ""}`;
try {
  localStorage.removeItem("comm_grid"); // alegerea veche, valabilă pe tot dispozitivul (până la v68), nu se mai folosește
} catch {
  /* mod privat */
}
const gridOn = () => {
  try {
    return localStorage.getItem(GRID_KEY) === "1";
  } catch {
    return false;
  }
};
function setGrid(on) {
  try {
    localStorage.setItem(GRID_KEY, on ? "1" : "0");
  } catch {
    /* mod privat: se aplică doar pe pagina curentă */
  }
  document.body.classList.toggle("grid-on", on);
  document.querySelectorAll(".grid-check").forEach((c) => (c.checked = on));
  const b = document.getElementById("grid-btn");
  if (b) {
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("active", on);
  }
}
const gridCheckHtml = () =>
  `<label class="overlay-control grid-control"><input type="checkbox" class="grid-check"${gridOn() ? " checked" : ""}> Pătrățele (reper: coloane A–L, rânduri 1–9)</label>`;
document.body.classList.toggle("grid-on", gridOn());
document.addEventListener("change", (e) => {
  if (e.target.matches?.(".grid-check")) setGrid(e.target.checked);
});
document.addEventListener("click", (e) => {
  if (e.target.closest?.("#grid-btn")) setGrid(!gridOn());
});
const code = new URLSearchParams(location.search).get("s");

let session = null;
let me = null;
let round = 1;
let modelPositions = [];
let selectedPiece = null;
let canvas = null;
let ctx = null;
let drawing = false;
let finalizeShape = null; // fixeaza forma aflata in editare (apelat inainte de trimitere)
let poll = null;

function hideAll() {
  ["join", "waiting", "activity", "reveal", "debrief", "error"].forEach((id) => ($(id).hidden = true));
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function fail(msg) {
  window.__commReady = true;
  hideAll();
  $("error").hidden = false;
  $("error").textContent = msg;
}

// ---------- initializare + intrare ----------
async function init() {
  if (!code) return fail("Link invalid.");
  const { data, error } = await supabase
    .from("communication_sessions")
    .select("*")
    .eq("session_code", code)
    .maybeSingle();
  if (error) {
    console.error(error);
    return fail("Nu pot citi sesiunea: " + error.message);
  }
  if (!data) return fail("Sesiunea nu există.");
  session = data;
  window.TCTheme?.initParticipant(supabase, "comm", session.id); // tema trainerului
  $("title").textContent = ACTIVITIES[session.mode].name;

  const saved = localStorage.getItem(`comm_${session.id}`);
  if (saved) {
    const { data: p } = await supabase.from("communication_participants").select("*").eq("id", saved).maybeSingle();
    me = p;
  }
  render();
  window.__commReady = true;
  poll = setInterval(refresh, 2500);
}

$("join-btn").onclick = join;
$("alias").addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});
// daca participantul modifica textul, intrebarea despre alias nu mai e valabila
$("alias").addEventListener("input", hideAliasSuggestion);

let suggestedAlias = null;
let baseAlias = null;

function hideAliasSuggestion() {
  $("alias-suggest").hidden = true;
  suggestedAlias = null;
}

async function join() {
  const alias = $("alias").value.trim();
  hideAliasSuggestion();
  $("join-error").textContent = "";
  if (!alias) {
    $("join-error").textContent = "Introdu un alias.";
    return;
  }
  await register(alias, alias);
}

// Inregistreaza participantul. Daca aliasul e deja luat in aceasta sesiune, il intreaba daca vrea varianta cu sufix.
const norm = (s) => s.trim().toLowerCase();

// Aliasurile deja folosite in sesiune (fara diferenta de majuscule). null daca citirea esueaza.
async function takenAliases() {
  const { data, error } = await supabase.from("communication_participants").select("alias").eq("session_id", session.id);
  if (error) return null;
  return new Set((data || []).map((p) => norm(p.alias)));
}

async function register(alias, base) {
  // verificare prealabila: functioneaza chiar daca regula unique din baza de date lipseste sau difera
  const taken = await takenAliases();
  if (taken && taken.has(norm(alias))) return offerSuffixedAlias(base);

  const { data, error } = await supabase
    .from("communication_participants")
    .insert({ session_id: session.id, alias })
    .select()
    .single();
  if (error) {
    if (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message)) return offerSuffixedAlias(base);
    $("join-error").textContent = error.message;
    return;
  }
  me = data;
  localStorage.setItem(`comm_${session.id}`, me.id);
  hideAliasSuggestion();
  render();
}

// "Pustiu" -> primul "Pustiu (n)" liber, n >= 2 ("Pustiu (2)" devine tot "Pustiu (3)", nu "Pustiu (2) (2)")
async function nextFreeAlias(base) {
  const clean = base.replace(/\s*\(\d+\)$/, "") || base;
  const taken = (await takenAliases()) || new Set();
  let n = 2;
  while (taken.has(norm(`${clean} (${n})`))) n++;
  return `${clean} (${n})`;
}

async function offerSuffixedAlias(base) {
  baseAlias = base;
  suggestedAlias = await nextFreeAlias(base);
  $("alias-suggest-text").textContent = `Aliasul „${base}” e deja folosit. Vrei să apari ca „${suggestedAlias}”?`;
  $("alias-yes").textContent = `Da, apar ca „${suggestedAlias}”`;
  $("alias-suggest").hidden = false;
}

$("alias-yes").onclick = () => {
  if (suggestedAlias) register(suggestedAlias, baseAlias);
};

$("alias-no").onclick = () => {
  hideAliasSuggestion();
  $("alias").value = "";
  $("alias").focus();
  $("join-error").textContent = "Alege un alias diferit.";
};

async function refresh() {
  const { data } = await supabase.from("communication_sessions").select("*").eq("id", session.id).maybeSingle();
  if (!data || data.status === "ended") {
    clearInterval(poll);
    return fail("Sesiunea s-a încheiat.");
  }
  if (data.status !== session.status) {
    // la model, ce e pe grila se trimite automat cand se iese din pasul de pozitionare
    if (session.mode === "model" && isRoundStatus(session.status) && modelPositions.length) await saveModel();
    // la „Ce ai înțeles?”, ce a scris participantul se trimite automat când se iese din rundă
    if (session.mode === "client" && isRoundStatus(session.status)) await saveClient();
    // la desen, desenul de pe canvas (daca are ceva desenat) se trimite automat cand se iese din runda
    if (session.mode === "draw" && isRoundStatus(session.status)) await saveDraw();
    session = data;
    modelPositions = [];
    selectedPiece = null;
    render();
  } else if (session.mode === "model" && session.status.endsWith("_results")) {
    showAllModelResults(); // rezultatele colegilor pot mai sosi
  } else if (session.mode === "client" && session.status.endsWith("_results")) {
    showAllClientAnswers();
  } else if (session.mode === "draw" && session.status.endsWith("_results")) {
    // reimprospatare usoara: se cere doar lista de participanti care au trimis; imaginile se reiau numai daca numarul s-a schimbat
    const { data: ids } = await supabase
      .from("communication_submissions")
      .select("participant_id")
      .eq("session_id", session.id)
      .eq("round", round);
    if ((ids || []).length !== drawShownCount) showAllDrawings();
  }
}

// ---------- afisare in functie de etapa ----------
function render() {
  hideAll();
  if (!me) {
    $("join").hidden = false;
    return;
  }
  $("my-alias").textContent = me.alias;

  if (session.status === "lobby") {
    $("waiting").hidden = false;
    return;
  }
  if (session.status === "debrief") {
    $("debrief").hidden = false;
    $("debrief-list").innerHTML = debriefFor(session.mode, session.scenario).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    // cu întrebări proprii ale trainerului, textul standard de sub listă (despre clientul agresiv) nu se mai potrivește: se ascunde
    $("debrief-transfer").hidden = hasCustomDebrief(session.scenario);
    // la model: textul de transfer potrivit si rezumatul scorurilor pe runde; la celelalte moduri ramane ca pana acum
    if (session.mode === "model") {
      $("debrief-transfer").textContent = DEBRIEF_MODEL_TRANSFER;
      showModelSummary();
    } else {
      $("debrief-summary").innerHTML = "";
    }
    return;
  }
  if ((session.mode === "client" || session.mode === "draw" || session.mode === "model") && session.status.endsWith("_results")) {
    round = roundOf(session.status);
    if (session.mode === "draw") showAllDrawings();
    else if (session.mode === "model") showAllModelResults();
    else showAllClientAnswers();
    return;
  }
  if (session.status.includes("reveal")) {
    round = roundOf(session.status);
    showReveal();
    return;
  }
  round = roundOf(session.status);
  $("activity").hidden = false;
  buildActivity();
}

function buildActivity() {
  const p = getRounds(session.mode, session.prompt_index, session.scenario)[round - 1];
  $("round-badge").textContent = `Runda ${round}`;
  $("round-title").textContent = p.title;
  $("rule").textContent = p.rule;
  $("submitted").hidden = true;

  if (session.mode === "draw") buildCanvas();
  if (session.mode === "model") buildModel(p);
  if (session.mode === "client") buildClient(p);
}

// ---------- modul 1: desen ----------
// Rezolutie interna fixa: desenul ramane corect la rotirea telefonului / redimensionarea ferestrei,
// iar imaginea trimisa are mereu aceeasi dimensiune (usoara).
const CANVAS_W = 800;
const CANVAS_H = 600;

const PEN_COLORS = [
  { c: "#1a1a1a", n: "Negru" },
  { c: "#d32f2f", n: "Roșu" },
  { c: "#1565c0", n: "Albastru" },
  { c: "#2e7d32", n: "Verde" },
  { c: "#ef6c00", n: "Portocaliu" },
  { c: "#6a1b9a", n: "Mov" },
  { c: "#6d4c41", n: "Maro" },
];
const PEN_WIDTH = 5;
const ERASER_WIDTH = 32;

const SHAPE_TOOLS = ["rect", "triangle", "circle"];
// manerul de rotire al formei selectate: dimensiuni in pixeli de ECRAN (se inmultesc cu scara canvasului, ca sa fie atingibile pe telefon)
const HANDLE_R = 14;
const HANDLE_GAP = 40;
const HANDLE_HIT = 26;
const BOX_PAD = 6;
const HANDLE_COLOR = "#2f6f4f";
const TOOL_BUTTONS = { pen: "tool-pen", eraser: "tool-eraser", rect: "tool-rect", triangle: "tool-triangle", circle: "tool-circle" };
const SHAPE_ICONS = {
  rect: '<rect x="3" y="5" width="14" height="10"/>',
  triangle: '<path d="M10 3 L18 17 H2 Z"/>',
  circle: '<circle cx="10" cy="10" r="7"/>',
};
const shapeButton = (id, label) =>
  `<button class="tool-btn" id="tool-${id}" aria-pressed="false" title="${label}" aria-label="${label}"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${SHAPE_ICONS[id]}</svg><span class="lbl">${label}</span></button>`;

function buildCanvas() {
  // pe telefon (ecran ingust sau scund) instructiunile sunt initial inchise, ca sa ramana loc pentru desen
  const compact = window.matchMedia("(max-width: 600px), (orientation: landscape) and (max-height: 520px)").matches;
  $("content").innerHTML = `
    <details class="how-to" ${compact ? "" : "open"}>
      <summary>ℹ️ Cum desenezi</summary>
      <ul>
        <li>Desenezi ținând degetul (sau mouse-ul) apăsat pe zona albă.</li>
        <li><b>Forme:</b> alege „Dreptunghi”, „Triunghi” sau „Cerc”, apoi trage pe zona albă în diagonală, de la un colț până la colțul opus. Cercul se încadrează în pătratul tras.</li>
        <li><b>Rotire și mutare:</b> după ce ai tras o formă, ea rămâne selectată: trage <b>mânerul rotund</b> de lângă ea ca s-o rotești liber, la orice unghi, sau trage forma ca s-o muți. Apasă <b>✓ Gata</b> (sau alege alt instrument) ca s-o fixezi, ori <b>✕</b> ca s-o ștergi.</li>
        <li><b>Culoare:</b> atinge una dintre bulinele colorate sau bulina multicoloră pentru orice altă culoare; se aplică și formelor.</li>
        <li><b>Radieră:</b> apasă „Radieră”, apoi treci peste ce vrei să ștergi. Revii la desen cu „Creion” sau alegând o culoare.</li>
        <li><b>Șterge tot</b> golește toată pagina.</li>
        <li>Când ești gata, apasă <b>Trimite răspunsul</b>. Dacă mai schimbi ceva, trimite din nou: se păstrează ultima versiune.</li>
      </ul>
    </details>
    <div class="canvas-tools">
      <div class="tool-group" role="group" aria-label="Instrument">
        <button class="tool-btn active" id="tool-pen" aria-pressed="true">✏️ Creion</button>
        <button class="tool-btn" id="tool-eraser" aria-pressed="false">🧽 Radieră</button>
        <button class="tool-btn clear" id="clear-canvas">Șterge tot</button>
      </div>
      <div class="tool-group" role="group" aria-label="Reper">
        <button class="tool-btn${gridOn() ? " active" : ""}" id="grid-btn" aria-pressed="${gridOn()}" title="Pătrățele de reper (coloane A–L, rânduri 1–9). Nu apar în desenul trimis.">▦ Grilă</button>
      </div>
      <div class="tool-group" role="group" aria-label="Forme">
        ${shapeButton("rect", "Dreptunghi")}
        ${shapeButton("triangle", "Triunghi")}
        ${shapeButton("circle", "Cerc")}
      </div>
      <div class="tool-group" role="group" aria-label="Culoare">
        ${PEN_COLORS.map(
          (x, i) =>
            `<button class="swatch${i === 0 ? " active" : ""}" data-color="${x.c}" style="--c:${x.c}" title="${x.n}" aria-label="${x.n}"></button>`
        ).join("")}
        <label class="swatch custom" id="custom-swatch" title="Altă culoare" style="--c:#1a1a1a">
          <input type="color" id="custom-color" value="#1a1a1a" aria-label="Alege o altă culoare">
        </label>
      </div>
    </div>
    ${gridFrame(
      `<div class="canvas-wrap">
      <canvas class="draw-canvas" id="canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
      ${gridLinesHtml()}
      <div class="shape-actions" id="shape-actions" hidden>
        <button class="tool-btn done" id="shape-done" title="Fixează forma">✓ Gata</button>
        <button class="tool-btn clear" id="shape-delete" title="Șterge forma" aria-label="Șterge forma">✕</button>
      </div>
    </div>`,
      "is-canvas"
    )}`;

  canvas = $("canvas");
  ctx = canvas.getContext("2d");
  const paintBackground = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  };
  paintBackground();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  let tool = "pen";
  let penColor = PEN_COLORS[0].c;
  const isShape = () => SHAPE_TOOLS.includes(tool);
  const applyTool = () => {
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : penColor;
    ctx.lineWidth = tool === "eraser" ? ERASER_WIDTH : PEN_WIDTH;
  };

  // ---- forma in editare: ramane obiect (rotibil, mutabil) pana e fixata ----
  let pending = null; // { type, cx, cy, w, h, rot, color }
  let base = null; // imaginea canvasului de dinainte de forma
  let snapshot = null; // la crearea unei forme noi
  let origin = null;
  let gesture = null; // { mode: "create" | "move" | "rotate", ... }

  const showActions = (v) => ($("shape-actions").hidden = !v);
  const kScale = () => CANVAS_W / canvas.getBoundingClientRect().width; // pixeli interni pe pixel de ecran
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const shapePath = (s) => {
    ctx.beginPath();
    if (s.type === "circle") {
      ctx.arc(0, 0, s.w / 2, 0, Math.PI * 2);
    } else if (s.type === "rect") {
      ctx.rect(-s.w / 2, -s.h / 2, s.w, s.h);
    } else {
      ctx.moveTo(0, -s.h / 2);
      ctx.lineTo(s.w / 2, s.h / 2);
      ctx.lineTo(-s.w / 2, s.h / 2);
      ctx.closePath();
    }
  };
  const renderShape = (s) => {
    ctx.save();
    ctx.translate(s.cx, s.cy);
    ctx.rotate(s.rot);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = PEN_WIDTH;
    ctx.lineJoin = "round";
    shapePath(s);
    ctx.stroke();
    ctx.restore();
  };

  // pozitia manerului de rotire: deasupra formei; daca iese din canvas, dedesubt (sd = -1 sus, +1 jos)
  const handleGeom = () => {
    const k = kScale();
    const hr = HANDLE_R * k;
    const dist = pending.h / 2 + HANDLE_GAP * k;
    const at = (sd) => ({ hx: pending.cx - sd * dist * Math.sin(pending.rot), hy: pending.cy + sd * dist * Math.cos(pending.rot) });
    const fits = (q) => q.hx >= hr && q.hx <= CANVAS_W - hr && q.hy >= hr && q.hy <= CANVAS_H - hr;
    const sd = gesture?.side ?? (fits(at(-1)) ? -1 : 1);
    const q = at(sd);
    return { hx: clamp(q.hx, hr, CANVAS_W - hr), hy: clamp(q.hy, hr, CANVAS_H - hr), hr, sd, k };
  };

  const drawHandles = () => {
    const { hx, hy, hr, sd, k } = handleGeom();
    const pad = BOX_PAD * k;
    ctx.save();
    ctx.translate(pending.cx, pending.cy);
    ctx.rotate(pending.rot);
    ctx.setLineDash([8 * k, 6 * k]);
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = HANDLE_COLOR;
    ctx.strokeRect(-pending.w / 2 - pad, -pending.h / 2 - pad, pending.w + 2 * pad, pending.h + 2 * pad);
    ctx.restore();
    // conector + maner
    const ex = pending.cx - sd * (pending.h / 2 + pad) * Math.sin(pending.rot);
    const ey = pending.cy + sd * (pending.h / 2 + pad) * Math.cos(pending.rot);
    ctx.save();
    ctx.strokeStyle = HANDLE_COLOR;
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // sageata circulara in maner
    const r = hr * 0.52;
    const a0 = -0.3 * Math.PI;
    const a1 = 1.2 * Math.PI;
    ctx.lineWidth = 2.4 * k;
    ctx.beginPath();
    ctx.arc(hx, hy, r, a0, a1);
    ctx.stroke();
    const px = hx + r * Math.cos(a1);
    const py = hy + r * Math.sin(a1);
    const tx = -Math.sin(a1);
    const ty = Math.cos(a1);
    const nx = Math.cos(a1);
    const ny = Math.sin(a1);
    ctx.fillStyle = HANDLE_COLOR;
    ctx.beginPath();
    ctx.moveTo(px + tx * 5 * k, py + ty * 5 * k);
    ctx.lineTo(px - tx * 2 * k + nx * 4.5 * k, py - ty * 2 * k + ny * 4.5 * k);
    ctx.lineTo(px - tx * 2 * k - nx * 4.5 * k, py - ty * 2 * k - ny * 4.5 * k);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const renderPending = (handles) => {
    ctx.putImageData(base, 0, 0);
    renderShape(pending);
    if (handles) drawHandles();
  };
  const bake = () => {
    if (!pending) return;
    renderPending(false);
    pending = null;
    base = null;
    showActions(false);
  };
  const discard = () => {
    if (!pending) return;
    ctx.putImageData(base, 0, 0);
    pending = null;
    base = null;
    showActions(false);
  };
  finalizeShape = bake;

  const hitHandle = (p) => {
    const g = handleGeom();
    return Math.hypot(p.x - g.hx, p.y - g.hy) <= HANDLE_HIT * g.k;
  };
  const hitBody = (p) => {
    const tol = 10 * kScale();
    const dx = p.x - pending.cx;
    const dy = p.y - pending.cy;
    const cs = Math.cos(pending.rot);
    const sn = Math.sin(pending.rot);
    const lx = dx * cs + dy * sn;
    const ly = -dx * sn + dy * cs;
    if (pending.type === "circle") return Math.hypot(lx, ly) <= pending.w / 2 + tol;
    return Math.abs(lx) <= pending.w / 2 + tol && Math.abs(ly) <= pending.h / 2 + tol;
  };
  // usoara "magnetizare" la unghiuri drepte (±2,5°), ca sa revii usor la forma dreapta; in rest rotirea e libera
  const snapRot = (rot) => {
    const step = Math.PI / 2;
    const near = Math.round(rot / step) * step;
    return Math.abs(rot - near) < (2.5 * Math.PI) / 180 ? near : rot;
  };

  const setTool = (t) => {
    if (pending && t !== tool) bake(); // schimbarea instrumentului fixeaza forma
    tool = t;
    for (const [name, id] of Object.entries(TOOL_BUTTONS)) {
      $(id).classList.toggle("active", name === t);
      $(id).setAttribute("aria-pressed", String(name === t));
    }
    canvas.classList.toggle("erasing", t === "eraser");
    canvas.classList.toggle("shaping", SHAPE_TOOLS.includes(t));
    applyTool();
  };
  for (const [name, id] of Object.entries(TOOL_BUTTONS)) $(id).onclick = () => setTool(name);
  const markActive = (el) => document.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("active", x === el));
  // culoarea alesa se aplica si formei selectate; te readuce la creion doar daca erai pe radiera
  const afterColor = () => {
    if (pending) {
      pending.color = penColor;
      renderPending(true);
    }
    setTool(tool === "eraser" ? "pen" : tool);
  };
  document.querySelectorAll(".swatch[data-color]").forEach((b) => {
    b.onclick = () => {
      penColor = b.dataset.color;
      markActive(b);
      afterColor();
    };
  });
  // culoare la alegere (selectorul nativ al dispozitivului)
  $("custom-color").oninput = (e) => {
    penColor = e.target.value;
    $("custom-swatch").style.setProperty("--c", penColor);
    markActive($("custom-swatch"));
    afterColor();
  };
  applyTool();

  // coordonate in pixelii interni ai canvasului, indiferent cat de mare e afisat
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * CANVAS_W) / r.width,
      y: ((e.clientY - r.top) * CANVAS_H) / r.height,
    };
  };

  // forma rezultata din tragerea de la un colt la colturile opus
  const shapeFromDrag = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (tool === "circle") {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      return {
        type: "circle",
        cx: a.x + ((Math.sign(dx) || 1) * size) / 2,
        cy: a.y + ((Math.sign(dy) || 1) * size) / 2,
        w: size,
        h: size,
        rot: 0,
        color: penColor,
      };
    }
    return { type: tool, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: Math.abs(dx), h: Math.abs(dy), rot: 0, color: penColor };
  };
  const bigEnough = (a, b) => Math.abs(b.x - a.x) >= 8 || Math.abs(b.y - a.y) >= 8;

  const start = (e) => {
    const p = pos(e);
    applyTool();
    if (pending) {
      if (hitHandle(p)) gesture = { mode: "rotate", side: handleGeom().sd };
      else if (hitBody(p)) gesture = { mode: "move", ox: p.x - pending.cx, oy: p.y - pending.cy };
      else bake(); // o atingere in afara formei o fixeaza si poti continua cu alta
      if (gesture) {
        drawing = true;
        canvas.setPointerCapture?.(e.pointerId);
        canvas.style.cursor = gesture.mode === "rotate" ? "grabbing" : "move";
        e.preventDefault();
        return;
      }
    }
    drawing = true;
    canvas.setPointerCapture?.(e.pointerId);
    if (isShape()) {
      snapshot = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      origin = p;
      gesture = { mode: "create" };
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      // un punct la simpla atingere
      ctx.lineTo(p.x + 0.01, p.y);
      ctx.stroke();
    }
    e.preventDefault();
  };
  const move = (e) => {
    const p = pos(e);
    if (!drawing) {
      // pe desktop: cursor care arata ce se poate face
      if (pending && e.pointerType === "mouse") canvas.style.cursor = hitHandle(p) ? "grab" : hitBody(p) ? "move" : "";
      return;
    }
    if (gesture?.mode === "rotate") {
      const a = Math.atan2(p.y - pending.cy, p.x - pending.cx);
      pending.rot = snapRot(a - (gesture.side < 0 ? -Math.PI / 2 : Math.PI / 2));
      renderPending(true);
    } else if (gesture?.mode === "move") {
      pending.cx = clamp(p.x - gesture.ox, 0, CANVAS_W);
      pending.cy = clamp(p.y - gesture.oy, 0, CANVAS_H);
      renderPending(true);
    } else if (snapshot) {
      ctx.putImageData(snapshot, 0, 0);
      renderShape(shapeFromDrag(origin, p));
    } else {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    e.preventDefault();
  };
  const stop = (e) => {
    if (gesture?.mode === "create" && snapshot) {
      ctx.putImageData(snapshot, 0, 0);
      const p = e?.type === "pointerup" ? pos(e) : null;
      if (p && bigEnough(origin, p)) {
        // forma ramane selectata: poate fi rotita, mutata, fixata sau stearsa
        pending = shapeFromDrag(origin, p);
        base = snapshot;
        renderPending(true);
        showActions(true);
      }
      snapshot = null;
      origin = null;
    }
    if (gesture && gesture.mode !== "create") canvas.style.cursor = "";
    gesture = null;
    drawing = false;
  };

  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  $("shape-done").onclick = bake;
  $("shape-delete").onclick = discard;
  $("clear-canvas").onclick = () => {
    pending = null;
    base = null;
    showActions(false);
    paintBackground();
  };
}

// ---------- modul 2: model pe grila 4x4 ----------
function buildModel(p) {
  const pieces = ["●", "▲", "■", "▬", "➜", "★"];
  const axes = !!p?.axes; // runda cu sistem de referinta: rândurile si coloanele sunt numerotate
  const cell = (i) => `<button class="model-cell" data-cell="${i}"></button>`;
  const gridInner = axes
    ? `<span class="axis-corner"></span>${[1, 2, 3, 4].map((n) => `<span class="axis-label">${n}</span>`).join("")}` +
      [0, 1, 2, 3].map((r) => `<span class="axis-label">${r + 1}</span>${[0, 1, 2, 3].map((cc) => cell(r * 4 + cc)).join("")}`).join("")
    : Array.from({ length: 16 }, (_, i) => cell(i)).join("");
  $("content").innerHTML = `
    <p>Alege o piesă, apoi un pătrat din grilă. Click pe o piesă plasată o elimină.${axes ? " Rândurile (1–4, de sus în jos) și coloanele (1–4, de la stânga la dreapta) sunt numerotate." : ""}</p>
    <div class="piece-tray">
      ${pieces.map((s) => `<button class="piece" data-piece="${s}">${s}</button>`).join("")}
    </div>
    <div class="model-grid${axes ? " axes" : ""}">${gridInner}</div>`;

  document.querySelectorAll("[data-piece]").forEach((b) => {
    b.onclick = () => {
      selectedPiece = b.dataset.piece;
      document.querySelectorAll(".piece").forEach((x) => x.classList.toggle("active", x === b));
    };
  });

  document.querySelectorAll("[data-cell]").forEach((c) => {
    c.onclick = () => {
      const i = +c.dataset.cell;
      const x = i % 4;
      const y = Math.floor(i / 4);
      const idx = modelPositions.findIndex((p) => p.x === x && p.y === y);
      if (idx >= 0) {
        modelPositions.splice(idx, 1);
        c.textContent = "";
        return;
      }
      if (selectedPiece) {
        modelPositions.push({ s: selectedPiece, x, y });
        c.textContent = selectedPiece;
      }
    };
  });
}

// ---------- modul 3: ce ai inteles ----------
function buildClient(p) {
  const r1 = round === 1;
  $("content").innerHTML = `
    <div class="client-box">
      <div class="rule"><b>Client:</b> ${escapeHtml(p.message)}</div>
      ${
        r1
          ? `<label>Ce presupui că este problema?</label><textarea id="assumption"></textarea>`
          : `<label>Ce întrebare de clarificare ai pune?</label><textarea id="question"></textarea>`
      }
      <label>Ce ai răspunde clientului?</label>
      <textarea id="answer"></textarea>
    </div>`;
}

// ---------- trimitere raspuns ----------
$("submit").onclick = submit;

async function saveModel() {
  return supabase
    .from("communication_submissions")
    .upsert(
      { session_id: session.id, participant_id: me.id, round, payload: { type: "model", positions: modelPositions } },
      { onConflict: "session_id,participant_id,round" }
    );
}

// salvare automata a desenului: doar daca pe canvas exista ceva desenat
async function saveDraw() {
  if (!canvas || !ctx || !$("canvas")) return;
  finalizeShape?.();
  const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
  let ink = false;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) {
      ink = true;
      break;
    }
  }
  if (!ink) return;
  return supabase
    .from("communication_submissions")
    .upsert(
      { session_id: session.id, participant_id: me.id, round, payload: { type: "draw", ...exportDrawing(canvas) }, submitted_at: new Date().toISOString() },
      { onConflict: "session_id,participant_id,round" }
    );
}

function clientPayload() {
  return {
    type: "client",
    assumption: $("assumption")?.value || "",
    question: $("question")?.value || "",
    answer: $("answer")?.value || "",
  };
}

// salvare automata (fara alerte) a ce a scris participantul, daca a scris ceva
async function saveClient() {
  if (!$("answer") && !$("assumption") && !$("question")) return;
  const payload = clientPayload();
  if (!`${payload.assumption}${payload.question}${payload.answer}`.trim()) return;
  return supabase
    .from("communication_submissions")
    .upsert({ session_id: session.id, participant_id: me.id, round, payload }, { onConflict: "session_id,participant_id,round" });
}

async function submit() {
  let payload;
  if (session.mode === "draw") {
    finalizeShape?.(); // o forma inca selectata (cu manere) se fixeaza inainte sa fie trimisa
    payload = { type: "draw", ...exportDrawing(canvas) };
  }
  if (session.mode === "model") payload = { type: "model", positions: modelPositions };
  if (session.mode === "client") payload = clientPayload();
  const { error } = await supabase
    .from("communication_submissions")
    .upsert(
      { session_id: session.id, participant_id: me.id, round, payload, submitted_at: new Date().toISOString() },
      { onConflict: "session_id,participant_id,round" }
    );
  if (error) {
    const stale = error.code === "23514" || /round_check|check constraint/i.test(error.message || "");
    return alert(
      stale
        ? "Nu se poate trimite răspunsul pentru această rundă: baza de date nu a fost actualizată pentru mai mult de 2 runde. Anunță trainerul (are de rulat o singură dată scriptul add-communication-more-rounds.sql)."
        : error.message
    );
  }
  $("submitted").hidden = false;
}

// ---------- desen: desenele tuturor (anonim): modelul, desenul meu primul, apoi ale celorlalți ----------
let drawShownCount = -1;
let drawOverlayOn = false;

async function showAllDrawings() {
  $("reveal").hidden = false;
  $("reveal-title").textContent = "Desenele tuturor";
  const p = getRounds(session.mode, session.prompt_index, session.scenario)[round - 1];
  // doar lista (fara imagini); miniaturile se cer apoi, o singura data pentru fiecare desen
  const { data: rows } = await supabase
    .from("communication_submissions")
    .select("id, participant_id, submitted_at, kind:payload->>type")
    .eq("session_id", session.id)
    .eq("round", round);

  const all = (rows || []).filter((r) => r.kind === "draw");
  drawShownCount = all.length;
  const mine = all.find((r) => r.participant_id === me.id);
  // ordine stabila, dar fara legatura cu ordinea intrarii in sesiune (ca sa nu poata fi ghicit cine e cine)
  const others = all.filter((r) => r.participant_id !== me.id).sort((a, b) => (a.participant_id > b.participant_id ? 1 : -1));
  const thumb = await loadDrawThumbs(supabase, all);
  const ownSrc = mine ? (await fetchFullDrawing(supabase, mine.id)) || thumb(mine) : null; // desenul propriu, in forma completa

  const ref = p.image ? escapeHtml(p.image) : null;
  const card = (img, title, isMine, sid) =>
    `<article class="result-card${isMine ? " mine" : ""}">${title ? `<b>${title}</b>` : ""}${gridFrame(`<div class="draw-wrap"><img src="${img}" alt="Desen"${sid ? ` data-sid="${sid}"` : ""}>${ref ? `<div class="model-overlay" data-src="${ref}"></div>` : ""}</div>`)}</article>`;
  const own = ownSrc
    ? card(ownSrc, "Desenul tău", true)
    : `<article class="result-card mine"><b>Desenul tău</b><p class="hint">Nu ai trimis un desen.</p></article>`;

  $("reveal-content").innerHTML = `
    ${
      ref
        ? `<h3>Modelul</h3>${gridFrame(`<div class="model-fig"><img src="${ref}" alt="Modelul"></div>`, "model")}
           <label class="overlay-control"><input type="checkbox" id="results-overlay"${drawOverlayOn ? " checked" : ""}> Suprapune modelul (roșu) peste desene</label>`
        : ""
    }
    ${gridCheckHtml()}
    <div class="results-grid is-draw own-result">${own}</div>
    <h3>Desenele celorlalți participanți</h3>
    <div class="results-grid is-draw">${others.map((r) => (thumb(r) ? card(thumb(r), "", false, r.id) : "")).join("") || "<p>Niciun alt desen deocamdată.</p>"}</div>
    ${others.length ? '<p class="hint">Atinge un desen ca să-l vezi mărit.</p>' : ""}`;

  const apply = () => document.querySelectorAll("#reveal-content .results-grid").forEach((g) => g.classList.toggle("show-overlay", drawOverlayOn));
  apply();
  hydrateOverlays($("reveal-content"));
  const cb = $("results-overlay");
  if (cb) {
    cb.onchange = () => {
      drawOverlayOn = cb.checked;
      apply();
    };
  }
}

// ---------- „Ce ai înțeles?”: răspunsurile tuturor (anonim, al tău primul, fără informația lipsă) ----------
async function showAllClientAnswers() {
  $("reveal").hidden = false;
  $("reveal-title").textContent = "Răspunsurile tuturor";
  const p = getRounds(session.mode, session.prompt_index, session.scenario)[round - 1];
  const { data: subs } = await supabase
    .from("communication_submissions")
    .select("participant_id,payload")
    .eq("session_id", session.id)
    .eq("round", round);

  const all = (subs || []).filter((s) => s.payload?.type === "client");
  const mine = all.find((s) => s.participant_id === me.id);
  // ordine stabila, dar fara legatura cu ordinea intrarii in sesiune (ca sa nu poata fi ghicit cine e cine)
  const others = all.filter((s) => s.participant_id !== me.id).sort((a, b) => (a.participant_id > b.participant_id ? 1 : -1));

  const parts = (pl) =>
    [
      pl.assumption?.trim() ? `<p><b>Interpretare:</b> ${escapeHtml(pl.assumption)}</p>` : "",
      pl.question?.trim() ? `<p><b>Clarificare:</b> ${escapeHtml(pl.question)}</p>` : "",
      pl.answer?.trim() ? `<p><b>Răspuns:</b> ${escapeHtml(pl.answer)}</p>` : "",
    ].join("") || `<p class="hint">(fără text)</p>`;
  const card = (pl, title, isMine) => `<article class="answer-card${isMine ? " mine" : ""}">${title ? `<b>${title}</b>` : ""}${parts(pl)}</article>`;

  $("reveal-content").innerHTML = `
    <div class="rule"><b>Clientul:</b> ${escapeHtml(p.message)}</div>
    ${mine ? card(mine.payload, "Răspunsul tău", true) : `<article class="answer-card mine"><b>Răspunsul tău</b><p class="hint">Nu ai trimis un răspuns.</p></article>`}
    <h3>Răspunsurile celorlalți participanți</h3>
    <div class="answers-list">${others.map((s) => card(s.payload, "", false)).join("") || "<p>Niciun alt răspuns deocamdată.</p>"}</div>`;
}

// ---------- debrief (model): scorul pe runde, al meu si media grupului (anonim) ----------
async function showModelSummary() {
  const { data: subs } = await supabase.from("communication_submissions").select("participant_id,round,payload").eq("session_id", session.id);
  const rounds = getRounds(session.mode, session.prompt_index, session.scenario);
  $("debrief-summary").innerHTML = summaryHtml(modelRoundSummary(subs, rounds, me?.id), true);
}

// ---------- pasul 3 (model): rezultatele tuturor ----------
// Anonim: aliasurile celorlalti nu se afiseaza (si nici nu se mai citesc); rezultatul propriu apare primul, dupa model.
async function showAllModelResults() {
  $("reveal").hidden = false;
  $("reveal-title").textContent = "Rezultatele tuturor";
  const p = getRounds(session.mode, session.prompt_index, session.scenario)[round - 1];
  const axes = { axes: p.axes };
  const { data: subs } = await supabase
    .from("communication_submissions")
    .select("participant_id,payload")
    .eq("session_id", session.id)
    .eq("round", round);

  const models = (subs || []).filter((s) => s.payload?.type === "model");
  const mine = models.find((s) => s.participant_id === me.id);
  // ordine stabila, dar fara legatura cu ordinea intrarii in sesiune (ca sa nu poata fi ghicit cine e cine)
  const others = models.filter((s) => s.participant_id !== me.id).sort((a, b) => (a.participant_id > b.participant_id ? 1 : -1));

  const card = (positions, title, isMine) => {
    const cmp = compareModel(p.target, positions || []);
    return `<article class="result-card${isMine ? " mine" : ""}">${title ? `<b>${title}</b>` : ""}${gridHtml(positions || [], cmp.marks, axes)}<p class="hint">${cmp.correct}/${cmp.total} la locul lor</p></article>`;
  };
  const own = mine
    ? card(mine.payload.positions, "Rezultatul tău", true)
    : `<article class="result-card mine"><b>Rezultatul tău</b><p class="hint">Nu ai trimis un răspuns.</p></article>`;

  $("reveal-content").innerHTML = `
    <div class="compare-row"><figure><figcaption>Modelul</figcaption>${gridHtml(p.target, {}, axes)}</figure></div>
    <div class="results-grid own-result">${own}</div>
    <h3>Rezultatele celorlalți participanți</h3>
    <div class="results-grid">${others.map((s) => card(s.payload.positions, "", false)).join("") || "<p>Niciun alt rezultat deocamdată.</p>"}</div>`;
}

// ---------- reveal ----------
async function showReveal() {
  $("reveal").hidden = false;
  const p = getRounds(session.mode, session.prompt_index, session.scenario)[round - 1];

  let intro = "";
  if (session.mode === "draw") {
    intro = `<div class="rule"><b>Instrucțiunile originale:</b>${stepsHtml(p.steps)}</div>`;
  }
  if (session.mode === "model") {
    intro = `<p>Compară modelul descris de facilitator cu ce ai realizat tu. <b>Verde</b> = piesă la locul ei, <b>roșu</b> = piesă greșită sau în plus.</p>`;
  }
  if (session.mode === "client") {
    intro = `<div class="rule"><b>Informația care lipsea:</b> ${escapeHtml(p.detail)}</div>`;
  }

  const { data } = await supabase
    .from("communication_submissions")
    .select("payload")
    .eq("session_id", session.id)
    .eq("participant_id", me.id)
    .eq("round", round)
    .maybeSingle();

  let own = "";
  const x = data?.payload;
  if (x?.type === "draw") {
    // desenul participantului + imaginea de referinta (daca runda are una): vizualizare simpla, model sau suprapus
    own = p.image
      ? `<h3>Desenul tău</h3>
         ${gridCheckHtml()}
         <div class="tool-group view-switch" role="group" aria-label="Vizualizare">
           <button class="tool-btn active" data-view="own">Desenul meu</button>
           <button class="tool-btn" data-view="model">Modelul</button>
           <button class="tool-btn" data-view="both">Suprapus</button>
         </div>
         ${gridFrame(`<div class="draw-wrap reveal-draw" id="reveal-draw" data-view="own">
           <img src="${x.image}" alt="Desenul tău">
           <img class="model-orig" src="${escapeHtml(p.image)}" alt="Modelul">
           <div class="model-overlay" data-src="${escapeHtml(p.image)}"></div>
         </div>`, "reveal")}
         <p class="hint" id="reveal-hint" hidden>Modelul apare în roșu peste desenul tău.</p>`
      : `<h3>Desenul tău</h3><img src="${x.image}" style="max-width:100%;background:white">`;
  } else if (session.mode === "draw" && p.image) {
    own = `<p>Nu ai trimis un desen în această rundă. Iată modelul:</p>${gridFrame(`<div class="model-fig"><img src="${escapeHtml(p.image)}" alt="Modelul"></div>`, "model")}`;
  }
  if (x?.type === "client") {
    own = `<p><b>Răspunsul tău:</b> ${escapeHtml(x.answer)}</p>`;
  }
  if (session.mode === "model") {
    if (x?.type === "model") {
      const cmp = compareModel(p.target, x.positions || []);
      own = `<div class="compare-row">
          <figure><figcaption>Modelul</figcaption>${gridHtml(p.target, {}, { axes: p.axes })}</figure>
          <figure><figcaption>Ce ai realizat tu</figcaption>${gridHtml(x.positions || [], cmp.marks, { axes: p.axes })}</figure>
        </div>
        <p class="score-badge">${scoreText(cmp)}</p>`;
    } else {
      own = `<p>Nu ai trimis un răspuns. Iată modelul:</p><div class="compare-row"><figure>${gridHtml(p.target, {}, { axes: p.axes })}</figure></div>`;
    }
  }
  $("reveal-title").textContent = "Compară și observă";

  $("reveal-content").innerHTML = intro + own;
  hydrateOverlays($("reveal-content"));

  document.querySelectorAll(".view-switch [data-view]").forEach((b) => {
    b.onclick = () => {
      $("reveal-draw").dataset.view = b.dataset.view;
      $("reveal-hint").hidden = b.dataset.view !== "both";
      document.querySelectorAll(".view-switch [data-view]").forEach((o) => o.classList.toggle("active", o === b));
    };
  });
}

init();

// atingerea unui desen din galerie il deschide marit (se descarca atunci)
enableLightbox($("reveal-content"), (id) => fetchFullDrawing(supabase, id));
