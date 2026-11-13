// Funcții comune pentru „Reconstruiește modelul” (pagina participantului și pagina trainerului)

const key = (p) => `${p.x},${p.y}`;

// Compară ce a așezat participantul cu modelul-țintă. O piesă e corectă dacă are același simbol în același pătrat.
export function compareModel(target, own = []) {
  const marks = {};
  let correct = 0;
  own.forEach((p) => {
    const hit = target.some((t) => t.s === p.s && t.x === p.x && t.y === p.y);
    marks[key(p)] = hit ? "ok" : "bad";
    if (hit) correct++;
  });
  return { correct, total: target.length, wrong: own.length - correct, marks };
}

// Grila 4×4; `marks` (opțional) colorează pătratele: „ok” = verde, „bad” = roșu
export function gridHtml(items = [], marks = {}, opts = {}) {
  const cells = Array.from({ length: 16 }, () => ({ s: "", cls: "" }));
  items.forEach((p) => {
    cells[p.y * 4 + p.x] = { s: p.s, cls: marks[key(p)] || "" };
  });
  const cell = (c) => `<span class="${c.cls}">${c.s}</span>`;
  if (opts.axes) {
    // rândurile (1–4, de sus în jos) și coloanele (1–4, de la stânga la dreapta) sunt numerotate: sistem de referință comun
    const head = `<span class="axis"></span>${[1, 2, 3, 4].map((n) => `<span class="axis">${n}</span>`).join("")}`;
    const rows = [0, 1, 2, 3].map((r) => `<span class="axis">${r + 1}</span>${cells.slice(r * 4, r * 4 + 4).map(cell).join("")}`).join("");
    return `<div class="mini-model axes">${head}${rows}</div>`;
  }
  return `<div class="mini-model">${cells.map(cell).join("")}</div>`;
}

export function scoreText(cmp) {
  const base = `${cmp.correct} din ${cmp.total} piese la locul lor`;
  return cmp.wrong > 0 ? `${base} · ${cmp.wrong} ${cmp.wrong === 1 ? "piesă greșită" : "piese greșite"}` : base;
}

// ---------------------------------------------------------------------
//  Instrucțiuni ca listă numerotată
// ---------------------------------------------------------------------
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const escapeText = esc;

// O instrucțiune pe rând. Prefixele „1.”, „2)”, „-”, „•” (de ex. la lipirea din Word) se elimină; numerotarea e automată.
export function parseSteps(text = "") {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+\s*[.)]|[-•*–])\s*/, "").trim())
    .filter(Boolean);
}

export function stepsHtml(steps = []) {
  return steps.length ? `<ol class="steps">${steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : "";
}

// ---------------------------------------------------------------------
//  Imaginea de referință ca „suprapunere” roșie: liniile închise devin roșu transparent, fundalul alb dispare.
//  Imaginile sunt normalizate la 4:3 la încărcare, deci se potrivesc peste zona de desen (800×600).
// ---------------------------------------------------------------------
const tintDone = new Map(); // url -> data URL (sau false dacă nu s-a putut procesa)

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function computeTint(url) {
  try {
    const img = await loadImage(url);
    const w = 800;
    const h = 600;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = 211;
      px[i + 1] = 47;
      px[i + 2] = 47;
      px[i + 3] = Math.max(0, Math.min(255, (255 - lum) * 1.4));
    }
    g.putImageData(d, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return false; // ex. imagine fără CORS: se folosește amestecarea „multiply”
  }
}

function fillOverlay(el, tinted) {
  el.innerHTML = tinted ? `<img src="${tinted}" alt="">` : `<img class="blend" src="${esc(el.dataset.src)}" alt="">`;
}

// Completează elementele <div class="model-overlay" data-src="URL"> din `root`
export function hydrateOverlays(root = document) {
  root.querySelectorAll(".model-overlay[data-src]").forEach(async (el) => {
    if (el.firstChild) return;
    const url = el.dataset.src;
    if (tintDone.has(url)) return fillOverlay(el, tintDone.get(url));
    const tinted = await computeTint(url);
    tintDone.set(url, tinted);
    fillOverlay(el, tinted);
  });
}

// ---------------------------------------------------------------------
//  „Reconstruiește modelul”: scorul pe runde (pentru debrief)
// ---------------------------------------------------------------------
// subs: [{ participant_id, round, payload }]; rounds: rundele din getRounds. Intoarce, pentru fiecare runda: media grupului si scorul participantului `meId`.
export function modelRoundSummary(subs, rounds, meId = null) {
  return rounds.map((r, i) => {
    const scores = [];
    let mine = null;
    (subs || [])
      .filter((s) => s.round === i + 1 && s.payload?.type === "model")
      .forEach((s) => {
        const c = compareModel(r.target, s.payload.positions || []).correct;
        scores.push(c);
        if (meId && s.participant_id === meId) mine = c;
      });
    return { n: i + 1, label: r.styleLabel, total: r.target.length, count: scores.length, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, mine };
  });
}

const fmt = (x) => x.toFixed(1).replace(".", ",");
export function summaryHtml(summary, withMine) {
  const rows = summary
    .map((r) => {
      const pct = r.avg == null ? 0 : Math.round((r.avg / r.total) * 100);
      return `<tr><td class="nw">Runda ${r.n}</td><td>${esc(r.label)}</td>${withMine ? `<td class="nw">${r.mine == null ? "—" : `${r.mine} / ${r.total}`}</td>` : ""}
        <td>${r.avg == null ? "—" : `<div class="bar"><span style="width:${pct}%"></span></div>${fmt(r.avg)} / ${r.total} <span class="hint">(${r.count} ${r.count === 1 ? "participant" : "participanți"})</span>`}</td></tr>`;
    })
    .join("");
  return `<h3>Cum a mers grupul</h3>
    <table class="summary-table"><thead><tr><th>Runda</th><th>Descrierea</th>${withMine ? "<th>Tu</th>" : ""}<th>Piese la locul lor (medie)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------------
//  Desene usoare: JPEG + miniatura, miniaturi cu cache, deschidere la atingere
// ---------------------------------------------------------------------
// Desenul se salveaza ca JPEG 640×480 (~10–25 KB, fata de 40–60 KB cat avea PNG-ul) + o miniatura 360×270 (~5–10 KB) pentru galerii.
export function exportDrawing(source) {
  const make = (w, h, quality) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = "high";
    g.drawImage(source, 0, 0, w, h);
    return c.toDataURL("image/jpeg", quality);
  };
  return { image: make(640, 480, 0.82), thumb: make(360, 270, 0.78) };
}

// Miniaturile se cer doar pentru raspunsurile noi sau schimbate (cheie: id + submitted_at) si se tin in memorie.
// Desenele mai vechi, fara miniatura (PNG), se iau o singura data in forma completa.
const thumbCache = new Map();
export async function loadDrawThumbs(supabase, rows) {
  const keyOf = (r) => `${r.id}|${r.submitted_at ?? ""}`;
  const need = rows.filter((r) => !thumbCache.has(keyOf(r)));
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    const { data } = await supabase
      .from("communication_submissions")
      .select("id, thumb:payload->>thumb")
      .in("id", chunk.map((r) => r.id));
    const legacy = [];
    for (const d of data || []) {
      const r = chunk.find((x) => x.id === d.id);
      if (!r) continue;
      if (d.thumb) thumbCache.set(keyOf(r), d.thumb);
      else legacy.push(r);
    }
    if (legacy.length) {
      const { data: full } = await supabase
        .from("communication_submissions")
        .select("id, image:payload->>image")
        .in("id", legacy.map((r) => r.id));
      for (const d of full || []) {
        const r = legacy.find((x) => x.id === d.id);
        if (r && d.image) thumbCache.set(keyOf(r), d.image);
      }
    }
  }
  return (r) => thumbCache.get(keyOf(r)) || null;
}

export async function fetchFullDrawing(supabase, id) {
  const { data } = await supabase.from("communication_submissions").select("image:payload->>image").eq("id", id).maybeSingle();
  return data?.image || null;
}

export function openLightbox(src) {
  const el = document.createElement("div");
  el.className = "lightbox";
  el.innerHTML = `<button class="lightbox-close" aria-label="Închide">✕</button><img src="${src}" alt="Desen mărit">`;
  const onKey = (e) => e.key === "Escape" && close();
  const close = () => {
    el.remove();
    document.removeEventListener("keydown", onKey);
  };
  el.onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(el);
}

// Atingerea unei miniaturi (img[data-sid]) deschide desenul complet, descarcat atunci
export function enableLightbox(container, getFull) {
  container.addEventListener("click", async (e) => {
    const img = e.target.closest?.("img[data-sid]");
    if (!img) return;
    img.classList.add("loading");
    const full = await getFull(img.dataset.sid).catch(() => null);
    img.classList.remove("loading");
    openLightbox(full || img.src);
  });
}

// ---------------------------------------------------------------------
//  Grila de pătrățele de pe canvasul de desen (12 coloane A–L × 9 rânduri 1–9; pătrate, ca la 4:3)
// ---------------------------------------------------------------------
export const GRID_COLS = 12;
export const GRID_ROWS = 9;
// Etichetele coloanelor (deasupra) și ale rândurilor (în stânga) stau ÎN AFARA zonei de desen, în marginile unui cadru (.grid-frame),
// pentru instrucțiuni de tipul „începe în C4”. Grila e un strat peste desen: nu se salvează în desenul trimis.
export function gridAxesHtml() {
  const cols = Array.from({ length: GRID_COLS }, (_, i) => `<span>${String.fromCharCode(65 + i)}</span>`).join("");
  const rows = Array.from({ length: GRID_ROWS }, (_, i) => `<span>${i + 1}</span>`).join("");
  return `<div class="grid-axis-cols" aria-hidden="true">${cols}</div><div class="grid-axis-rows" aria-hidden="true">${rows}</div>`;
}
// Încadrează o zonă de desen (canvas, desen, imagine de referință) cu etichetele grilei în margini
export const gridFrame = (inner, cls = "") => `<div class="grid-frame${cls ? " " + cls : ""}">${gridAxesHtml()}${inner}</div>`;
// Stratul cu liniile grilei de pe canvas
export const gridLinesHtml = () => '<div class="grid-overlay" aria-hidden="true"></div>';
