// Modul „Recapitulare”: câmpul de luptă (animația bulgărilor), listele pe echipe și sincronizarea întrebărilor.
// Folosit de pagina participantului (recap.js) și de cea a trainerului (recap-admin.js).

export const TEAMS = {
  1: { name: "Roșii", color: "#c0392b", flag: "#d9534f" },
  2: { name: "Albaștri", color: "#1f5fa8", flag: "#3b82c4" },
};
export const MAX_LEN = 200; // lungimea maxima a unei intrebari (aceeasi regula in baza de date)
export const COOLDOWN_S = 8; // pauza intre doua intrebari ale aceluiasi participant (baza de date impune minimum 5 s)
export const otherTeam = (t) => (Number(t) === 1 ? 2 : 1);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // text, nu HTML: intrebarile scrise de participanti nu pot injecta cod
  return e;
}

// bulgare de hartie mototolita: contur neregulat + cute
export const BALL_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true">
  <path d="M20 3 L30 6 L37 15 L36 27 L29 36 L17 37 L7 31 L3 20 L7 9 L14 5 Z" fill="#f6f2e8" stroke="#8f8977" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M20 3 L18 17 L7 9 M18 17 L3 20 M18 17 L29 22 L36 27 M29 22 L30 6 M18 17 L17 37 M29 22 L29 36" fill="none" stroke="#b9b29f" stroke-width="1"/>
  <path d="M14 5 L18 17 L30 22" fill="none" stroke="#dcd6c6" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M7 31 L18 17" fill="none" stroke="#cfc9b8" stroke-width="1.4"/>
</svg>`;

const tentSvg = (team) => `<svg viewBox="0 0 120 96" aria-hidden="true">
  <ellipse cx="60" cy="88" rx="46" ry="6" fill="rgba(60,50,20,.18)"/>
  <path d="M14 86 L60 22 L106 86 Z" fill="${TEAMS[team].color}" stroke="rgba(0,0,0,.25)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M60 22 L60 86 M60 22 L40 86 M60 22 L80 86" stroke="rgba(255,255,255,.22)" stroke-width="2" fill="none"/>
  <path d="M48 86 L60 56 L72 86 Z" fill="#2b2418" opacity=".82"/>
  <path d="M60 22 L60 4" stroke="#5b4a2b" stroke-width="3" stroke-linecap="round"/>
  <path d="M60 5 L84 11 L60 18 Z" fill="${TEAMS[team].flag}" stroke="rgba(0,0,0,.25)" stroke-width="1.4"/>
</svg>`;

// =====================================================================
//  Câmpul de luptă
// =====================================================================
export function createArena(root) {
  root.classList.add("arena");
  root.innerHTML = [1, 2]
    .map(
      (t) => `<div class="camp camp-${t}" data-team="${t}">
        <div class="camp-art">${tentSvg(t)}</div>
        <div class="pile" aria-hidden="true"></div>
        <div class="camp-name">Echipa ${TEAMS[t].name}</div>
        <div class="camp-stats"></div>
      </div>`
    )
    .join("") + '<div class="front" aria-hidden="true"></div>';
  const camps = { 1: root.querySelector(".camp-1"), 2: root.querySelector(".camp-2") };
  const thrown = { 1: 0, 2: 0 };
  const pending = { 1: 0, 2: 0 }; // bulgari in zbor sau la coada, catre fiecare tabara
  const queue = [];
  let pumping = false;
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const received = (t) => thrown[otherTeam(t)];
  function renderStats() {
    [1, 2].forEach((t) => (camps[t].querySelector(".camp-stats").textContent = `aruncate ${thrown[t]} · primite ${received(t)}`));
  }
  // gramada de bulgari din tabara = intrebarile primite (maxim 10 afisate), fara cele inca in zbor
  function renderPile(t, pop) {
    const pile = camps[t].querySelector(".pile");
    const n = Math.max(0, Math.min(10, received(t) - pending[t]));
    if (pile.children.length === n && !pop) return;
    pile.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const b = el("div", "ball landed");
      b.innerHTML = BALL_SVG;
      b.style.left = `${8 + ((i * 37) % 70)}%`;
      b.style.bottom = `${(i % 3) * 7}px`;
      b.style.transform = `rotate(${(i * 53) % 360}deg)`;
      if (pop && i === n - 1) b.classList.add("pop");
      pile.appendChild(b);
    }
  }

  function launch(from, done) {
    const to = otherTeam(from);
    const a = root.getBoundingClientRect();
    const cf = camps[from].querySelector(".camp-art").getBoundingClientRect();
    const ct = camps[to].querySelector(".camp-art").getBoundingClientRect();
    const size = a.width < 520 ? 26 : 40;
    const sx = cf.left + cf.width / 2 - a.left - size / 2;
    const sy = cf.top + cf.height * 0.3 - a.top - size / 2;
    const ex = ct.left + ct.width / 2 - a.left - size / 2 + (Math.random() * 24 - 12);
    const ey = ct.top + ct.height * 0.55 - a.top - size / 2;
    const arc = Math.max(48, Math.abs(ex - sx) * 0.26);
    const ball = el("div", "ball flying");
    ball.innerHTML = BALL_SVG;
    ball.style.width = ball.style.height = `${size}px`;
    ball.dataset.from = String(from);
    root.appendChild(ball);
    const frames = [
      { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(.6)` },
      { transform: `translate(${(sx + ex) / 2}px, ${Math.min(sy, ey) - arc}px) rotate(260deg) scale(1.15)`, offset: 0.5 },
      { transform: `translate(${ex}px, ${ey}px) rotate(520deg) scale(.85)` },
    ];
    const anim = ball.animate(frames, { duration: 1300, easing: "cubic-bezier(.25,.1,.4,1)", fill: "forwards" });
    anim.onfinish = () => {
      ball.remove();
      done();
    };
  }

  function land(to) {
    pending[to] = Math.max(0, pending[to] - 1);
    renderPile(to, true);
  }
  function pump() {
    if (pumping) return;
    pumping = true;
    const step = () => {
      const job = queue.shift();
      if (!job) {
        pumping = false;
        return;
      }
      launch(job.from, () => land(otherTeam(job.from)));
      setTimeout(step, 320); // bulgarii pornesc la intervale scurte, ca sa nu se suprapuna
    };
    step();
  }

  return {
    camps,
    // a fost aruncata o intrebare de catre echipa `from`: se animeaza un bulgare (sau, cu „reduce miscarea”, aterizeaza direct)
    fly(from) {
      const to = otherTeam(from);
      pending[to]++;
      if (reduced() || queue.length > 8) return land(to); // multe deodata: fara animatie pentru surplus
      queue.push({ from });
      pump();
    },
    // totaluri: cate intrebari vizibile a aruncat fiecare echipa (fara animatie)
    setTotals(t1, t2) {
      thrown[1] = t1;
      thrown[2] = t2;
      renderStats();
      renderPile(1);
      renderPile(2);
    },
    pendingCount: () => pending[1] + pending[2],
  };
}

// =====================================================================
//  Listele de întrebări, grupate pe echipe
// =====================================================================
// questions: TOATE întrebările [{ id, team, body, hidden, parent_id, created_at, updated_at }] (cele ascunse se folosesc doar la relații)
// opts: { author: (q) => text|null, onToggle: (q) => void (trainer), showHidden: bool (trainer), newIds: Set,
//         myTeam: 1|2, onReturn: (q) => void (participant: „Aruncă înapoi”), returning: Set de id-uri în curs de trimitere }
export function renderLists(root, questions, opts = {}) {
  const scroll = root.scrollTop;
  // pozitiile de dinainte, ca o intrebare ascunsa / reafisata sa se MUTE animat in noul loc (nu sa sara)
  const before = new Map([...root.querySelectorAll(".qitem")].map((li) => [li.dataset.id, li.getBoundingClientRect()]));
  root.innerHTML = "";
  root.classList.add("qlists");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // O întrebare aruncată înapoi este aceeași întrebare, care a trecut la cealaltă echipă: în listă rămâne doar ultima ei „aruncare”,
  // adică ea apare mereu doar la echipa care trebuie să răspundă acum (cea de partea cealaltă a celei care a aruncat-o ultima).
  const byId = new Map(questions.map((q) => [q.id, q]));
  const superseded = new Set(questions.filter((q) => q.parent_id).map((q) => q.parent_id)); // întrebările deja aruncate mai departe
  const rootOf = (q) => {
    let c = q;
    for (let i = 0; i < 1000 && c.parent_id && byId.has(c.parent_id); i++) c = byId.get(c.parent_id);
    return c.id;
  };
  const current = questions.filter((q) => !superseded.has(q.id));
  const shownQ = opts.showHidden ? current : current.filter((q) => !q.hidden);
  const makeItem = (q) => {
    const li = el("li", `qitem${q.hidden ? " is-hidden" : ""}${opts.newIds?.has(q.id) ? " is-new" : ""}`);
    li.dataset.id = rootOf(q); // aceeași cheie pe tot lanțul: la fiecare aruncare întrebarea se MUTĂ animat în coloana celeilalte echipe
    li.append(el("span", "qtext", q.body));
    const author = opts.author?.(q);
    if (author) li.append(el("small", "qauthor", author));
    if (opts.onToggle) {
      const b = el("button", "qbtn", q.hidden ? "Arată" : "Ascunde");
      b.onclick = () => opts.onToggle(q);
      li.append(b);
    }
    // „Aruncă înapoi”: pe întrebările la care răspunde echipa mea, de câte ori vrea, până încheie trainerul sesiunea
    if (opts.onReturn && !q.hidden && q.team !== opts.myTeam) {
      const b = el("button", "qbtn qret-btn", "↩ Aruncă înapoi");
      b.disabled = !!opts.returning?.has(q.id);
      b.onclick = () => opts.onReturn(q);
      li.append(b);
    }
    return li;
  };
  [1, 2].forEach((t) => {
    const mine = shownQ.filter((q) => otherTeam(q.team) === t); // coloana echipei t: întrebările la care răspunde ea
    // afisate: in ordinea aruncarii; ascunse: la final, cea mai recent ascunsa prima
    const visible = mine.filter((q) => !q.hidden).sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    const hidden = mine.filter((q) => q.hidden).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    const col = el("section", `qcol team-${t}`);
    const head = el("h4", "qhead");
    head.append(el("span", "qtitle", `Întrebări pentru echipa ${TEAMS[t].name}`), el("span", "qcount", String(visible.length)));
    col.append(head, el("div", "qdir", `Răspunde echipa ${TEAMS[t].name}`));
    const ol = el("ol", "qlist");
    if (!visible.length) ol.append(el("li", "qempty", hidden.length ? "Nicio întrebare afișată." : "Încă nicio întrebare."));
    visible.forEach((q) => ol.append(makeItem(q)));
    col.append(ol);
    if (hidden.length) {
      col.append(el("div", "qhidden-head", `Ascunse de trainer (${hidden.length})`));
      const ul = el("ul", "qlist qhidden");
      hidden.forEach((q) => ul.append(makeItem(q)));
      col.append(ul);
    }
    root.append(col);
  });
  root.scrollTop = scroll;
  if (!reduced && before.size) {
    root.querySelectorAll(".qitem").forEach((li) => {
      const old = before.get(li.dataset.id);
      if (!old) return;
      const now = li.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      li.style.zIndex = "2";
      li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" }).onfinish = () => (li.style.zIndex = "");
    });
  }
}

// =====================================================================
//  Sincronizarea întrebărilor: se cere doar ce s-a schimbat de la ultima verificare
// =====================================================================
export const STORE_COLS = "id, team, body, hidden, created_at, updated_at, parent_id"; // coloanele unei întrebări (pentru INSERT ... SELECT)
export function createStore(supabase, sessionId, { withAuthor = false } = {}) {
  const map = new Map();
  let cursor = null;
  let first = true;
  const cols = "id, team, body, hidden, created_at, updated_at, parent_id" + (withAuthor ? ", participant_id" : "");
  return {
    // intoarce { added: [...] (intrebari noi, fara cele din prima incarcare), changed: [...], all, initial }
    async sync() {
      const added = [];
      const changed = [];
      for (let page = 0; page < 20; page++) {
        let q = supabase.from("recap_questions").select(cols).eq("session_id", sessionId).order("updated_at", { ascending: true }).limit(500);
        if (cursor) q = q.gte("updated_at", cursor);
        const { data, error } = await q;
        if (error) throw error;
        const rows = data || [];
        for (const r of rows) {
          const prev = map.get(r.id);
          map.set(r.id, r);
          if (!prev) added.push(r);
          else if (prev.hidden !== r.hidden) changed.push(r);
        }
        const last = rows[rows.length - 1];
        const moved = last && last.updated_at !== cursor;
        if (last) cursor = last.updated_at;
        if (rows.length < 500 || !moved) break;
      }
      const initial = first;
      first = false;
      return { added: initial ? [] : added, changed, initial, all: [...map.values()] };
    },
    // o intrebare pe care am aruncat-o eu: o tinem local imediat (apare si la urmatoarea sincronizare, dar nu se reanimeaza)
    remember(row) {
      map.set(row.id, row);
    },
    all: () => [...map.values()],
    visibleCounts() {
      const c = { 1: 0, 2: 0 };
      for (const q of map.values()) if (!q.hidden) c[q.team]++;
      return c;
    },
  };
}

// Textul întrebărilor, grupat pe echipe (pentru „Copiază”)
export function questionsAsText(questions, topic = "") {
  const out = [topic ? `Recapitulare: ${topic}` : "Recapitulare"];
  const superseded = new Set(questions.filter((q) => q.parent_id).map((q) => q.parent_id));
  const current = questions.filter((q) => !superseded.has(q.id) && !q.hidden);
  [1, 2].forEach((t) => {
    // la întrebările aruncate înapoi, un singur rând: la echipa care răspunde acum
    const mine = current.filter((q) => otherTeam(q.team) === t).sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    out.push("", `Întrebări pentru echipa ${TEAMS[t].name} (${mine.length})`);
    mine.forEach((q, i) => out.push(`${i + 1}. ${q.body}`));
  });
  return out.join("\n");
}

// Ultima „aruncare” dintr-un lanț de întrebări (cea care se vede acum în liste): de la un rând, urmăm returnările până la capăt.
export function leafOf(rows, id) {
  const child = new Map(rows.filter((r) => r.parent_id).map((r) => [r.parent_id, r]));
  let cur = rows.find((r) => r.id === id) || null;
  for (let i = 0; cur && child.has(cur.id) && i < 10000; i++) cur = child.get(cur.id);
  return cur;
}

// =====================================================================
//  Cronometrul (timpul pentru aruncarea întrebărilor)
// =====================================================================
// Ceasul serverului: timpul rămas se calculează cu ora serverului, nu cu ceasul (posibil decalat) al telefonului sau al calculatorului.
export function createClock(supabase) {
  let offset = 0; // server − ceasul meu, în ms
  return {
    async sync() {
      const t0 = Date.now();
      try {
        const { data } = await supabase.rpc("recap_server_time");
        const t1 = Date.now();
        if (data) offset = new Date(data).getTime() - (t0 + t1) / 2; // mijlocul drumului dus-întors
      } catch {
        /* fără ceasul serverului se folosește ceasul local */
      }
    },
    now: () => Date.now() + offset,
  };
}

// Starea cronometrului sesiunii: { state: "none" | "running" | "paused" | "expired", remaining: secunde }
export function timerInfo(session, nowMs) {
  const st = session?.timer_status || "not_started";
  if (st === "running" && session.timer_ends_at) {
    const rem = Math.max(0, (new Date(session.timer_ends_at).getTime() - nowMs) / 1000);
    return { state: rem <= 0 ? "expired" : "running", remaining: rem };
  }
  if (st === "paused") return { state: "paused", remaining: session.timer_remaining_seconds || 0 };
  if (st === "expired") return { state: "expired", remaining: 0 };
  return { state: "none", remaining: 0 }; // „fără timp” sau sesiune mai veche, fără cronometru
}

// 05:00 (minute:secunde); cu ore, 1:05:00. Se rotunjește în sus, ca „00:00” să apară doar la expirare.
export function fmtTime(sec) {
  const t = Math.max(0, Math.ceil(sec - 1e-6));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
