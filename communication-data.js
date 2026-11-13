// =====================================================================
//  Nodul comunicării — conținutul activităților
//
//  • Desenează după instrucțiuni: scenariile le creează fiecare trainer, din pagina trainerului
//    („Scenariile mele”): titlu, instrucțiuni (listă numerotată) și, opțional, o imagine de referință,
//    pentru una sau două runde. Scenariul ales se copiază în sesiune (communication_sessions.scenario).
//  • Ce ai înțeles?: scenariile de bază sunt aici, în `ACTIVITIES.client.variants` (mesaj = ce spune clientul,
//    detail = informația ascunsă), ca puncte de pornire; fiecare trainer le poate copia în „Scenariile mele”
//    și le poate edita, sau își poate crea scenarii proprii (1 sau 2 runde), salvate în baza de date.
//  • Reconstruiește modelul: nu se adaugă manual, modelele se generează.
// =====================================================================

const R1_NO_QUESTIONS = "Fără întrebări. Ascultă și desenează doar din instrucțiuni.";
const R2_QUESTIONS = "Poți pune întrebări de clarificare și poți verifica ce ai înțeles.";
const C1_RULE = "Răspunde pe baza mesajului inițial, fără informații suplimentare.";
const C2_RULE = "Înainte de soluție, formulează o întrebare de clarificare și apoi răspunsul tău.";

export const ACTIVITIES = {
  draw: {
    name: "Desenează după instrucțiuni",
    // fără scenarii în cod: fiecare trainer își creează propriile scenarii
  },

  model: {
    name: "Reconstruiește modelul",
    // variantele se generează din număr (vezi getRounds); aici nu există listă
  },

  client: {
    name: "Ce ai înțeles?",
    variants: [
      {
        rounds: [
          { title: "Plata", message: "Am făcut plata ieri și încă nu apare. Nu înțeleg de ce trebuie să verific eu mereu lucrurile astea.", detail: "Plata apare în contul clientului. Beneficiarul spune că nu a primit banii.", rule: C1_RULE },
          { title: "Cardul", message: "Mi-ați blocat cardul exact când aveam nevoie de el.", detail: "Cardul este activ. Tranzacția a fost refuzată doar la un comerciant online.", rule: C2_RULE },
        ],
      },
      {
        rounds: [
          { title: "Transferul", message: "Am trimis banii azi-dimineață și destinatarul zice că nu i-au ajuns. Vreau să rezolvați imediat, nu e prima dată.", detail: "Transferul a fost inițiat către un cont din altă bancă și este încă în procesare; banii nu au fost încă debitați din contul clientului.", rule: C1_RULE },
          { title: "Aplicația", message: "Nu mai merge aplicația, ce-mi faceți?!", detail: "Aplicația funcționează. Clientul nu se poate autentifica după ce și-a schimbat telefonul, pentru că dispozitivul nou nu a fost înregistrat.", rule: C2_RULE },
        ],
      },
      {
        rounds: [
          { title: "Comisionul", message: "Mi-ați luat un comision din nou și nimeni nu mi-a zis nimic despre asta.", detail: "Este comisionul lunar de administrare a contului, aplicat după ce soldul clientului a coborât sub nivelul cerut de pachetul lui.", rule: C1_RULE },
          { title: "Rambursarea", message: "Am returnat produsul acum două săptămâni și încă n-am primit banii.", detail: "Comerciantul a inițiat rambursarea, dar aceasta este încă în procesare. Clientul a numărat și zilele de weekend și crede că a trecut mult mai mult timp.", rule: C2_RULE },
        ],
      },
      {
        rounds: [
          { title: "La ghișeu", message: "Am așteptat o oră la ghișeu și tot nu s-a rezolvat nimic. Data viitoare nu mai vin.", detail: "Clientul a venit fără un act de identitate valabil, deci operațiunea nu se putea face. Nu i s-a explicat clar de ce.", rule: C1_RULE },
          { title: "Creditul", message: "Mi-ați respins cererea și nici nu mi-ați spus de ce. Ce rost mai are să aplic?", detail: "Cererea nu a fost respinsă definitiv: lipsește un document de venit. Clientul a primit un SMS automat pe care nu l-a citit.", rule: C2_RULE },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------
//  Etapele sesiunii. Desenul și mesajele ambigue au 2 runde; „Reconstruiește modelul” are 4 pași:
//   1 poziționare (facilitatorul explică) → 2 reveal individual (model + ce a făcut fiecare)
//   → 3 rezultatele tuturor → 4 debrief.
//  Valorile salvate în baza de date sunt cele permise de constrângerea existentă (nu cere SQL nou):
//  la model, pasul 3 se salvează ca „round2_reveal”.
// ---------------------------------------------------------------------
// Numarul maxim de runde al unui scenariu de desen
export const MAX_ROUNDS = 10;

// round3 / round3_reveal / round3_results -> { kind: "round" | "reveal" | "results", n: 3 }; lobby / debrief / ended -> { kind, n: 0 }
export function parseStatus(status) {
  const m = /^round(\d+)(?:_(reveal|results))?$/.exec(status || "");
  return m ? { kind: m[2] || "round", n: Number(m[1]) } : { kind: status, n: 0 };
}
export const roundOf = (status) => parseStatus(status).n || 1;
export const isRoundStatus = (status) => parseStatus(status).kind === "round";

// Lobby, apoi pentru fiecare runda: runda -> reveal -> toate raspunsurile/desenele, apoi debrief
function stagesWithRounds(n) {
  const out = ["lobby"];
  for (let i = 1; i <= n; i++) out.push(`round${i}`, `round${i}_reveal`, `round${i}_results`);
  return [...out, "debrief", "ended"];
}

const STAGES_DEFAULT = ["lobby", "round1", "round1_reveal", "round2", "round2_reveal", "debrief", "ended"];
const LABELS_DEFAULT = {
  lobby: "Lobby",
  round1: "Runda 1 · fără clarificări",
  round1_reveal: "Reveal runda 1",
  round2: "Runda 2 · cu clarificări",
  round2_reveal: "Reveal runda 2",
  debrief: "Debrief",
  ended: "Încheiată",
};
// „Ce ai înțeles?”: după fiecare reveal urmează un pas în care participanții văd răspunsurile tuturor (anonim)
const LABELS_CLIENT = {
  lobby: "Lobby",
  round1: "Runda 1 · fără clarificări",
  round1_reveal: "Reveal runda 1",
  round1_results: "Răspunsurile tuturor · runda 1",
  round2: "Runda 2 · cu clarificări",
  round2_reveal: "Reveal runda 2",
  round2_results: "Răspunsurile tuturor · runda 2",
  debrief: "Debrief",
  ended: "Încheiată",
};

// Rundele unui scenariu de desen (1 sau 2), cu regula rundei dedusă din „permite întrebări”
export function scenarioRounds(scenario) {
  const list = Array.isArray(scenario?.rounds) && scenario.rounds.length ? scenario.rounds : [{ steps: [], questions: false }];
  return list.slice(0, MAX_ROUNDS).map((r, i) => ({
    title: r.title || scenario?.title || `Runda ${i + 1}`,
    steps: Array.isArray(r.steps) ? r.steps : [],
    image: r.image_url || null,
    questions: !!r.questions,
    rule: r.questions ? R2_QUESTIONS : R1_NO_QUESTIONS,
  }));
}

export function stagesFor(mode, session) {
  if (mode === "model") return stagesWithRounds(3); // exact 3 runde: interpretabila, stufoasa, exacta
  if (mode === "client") return stagesWithRounds(session?.scenario?.rounds?.length === 1 ? 1 : 2); // scenariu propriu cu o singura runda: fara runda 2
  // desen: fiecare runda are runda -> reveal -> „Desenele tuturor”; numarul de runde vine din scenariu
  if (mode === "draw") return stagesWithRounds(scenarioRounds(session?.scenario).length);
  return STAGES_DEFAULT;
}

export function stageLabel(mode, status, session) {
  const { kind, n } = parseStatus(status);
  if (mode === "model" && n) {
    if (kind === "reveal") return `Reveal individual · runda ${n}`;
    if (kind === "results") return `Rezultatele tuturor · runda ${n}`;
    return `Runda ${n} · Poziționare`;
  }
  if ((mode === "draw" || mode === "client") && n) {
    if (kind === "reveal") return `Reveal runda ${n}`;
    if (kind === "results") return mode === "draw" ? `Desenele tuturor · runda ${n}` : `Răspunsurile tuturor · runda ${n}`;
    const questions = mode === "draw" ? scenarioRounds(session?.scenario)[n - 1]?.questions : n > 1;
    return `Runda ${n} · ${questions ? "cu" : "fără"} clarificări`;
  }
  if (mode === "client") return LABELS_CLIENT[status] || status;
  return LABELS_DEFAULT[status] || status;
}

// Debrief la „Reconstruiește modelul” (3 runde: interpretabilă, stufoasă, exactă)
export const DEBRIEF_MODEL = [
  "Runda 1 · descrierea interpretabilă: ce ai presupus fără să-ți dai seama când ai auzit „lângă”, „undeva sub” sau „mai spre dreapta”? Cum ai decis unde pui fiecare piesă?",
  "La „Rezultatele tuturor”: aceeași descriere, atâtea așezări diferite. De unde vin diferențele dintre colegi și ce ar fi trebuit să se spună ca ele să dispară?",
  "Runda 2 · descrierea stufoasă: informația corectă era acolo, dar îngropată în cuvinte. Ce te-a încurcat mai mult: lungimea, repetițiile sau digresiunile? Ce ai reținut și ce ai pierdut pe drum?",
  "Comparând rundele 1 și 2: care a fost mai grea și de ce? Ce spune asta despre ideea că „mai multe explicații” înseamnă „mai clar”?",
  "Runda 3 · descrierea exactă, cu sistem de referință: ce a schimbat faptul că rândurile și coloanele erau numerotate și la fel pentru toți? De ce nu mai era loc de interpretări?",
  "Unde, la serviciu, dai sau primești instrucțiuni ca în runda 1 sau 2? Ce „sistem de referință” (termeni, exemple, format, pași numerotați) ai putea stabili cu colegii sau cu clienții, ca să ajungi la runda 3?",
];
export const DEBRIEF_MODEL_TRANSFER =
  "Aceeași informație poate fi înțeleasă foarte diferit: prea vagă, lasă loc interpretărilor; prea lungă, se pierde pe drum; exactă și cu un sistem de referință comun, e înțeleasă la fel de toți.";
export const DEBRIEF_MODEL_SHORT_TIME = "Dacă ai puțin timp: întrebările 2, 4 și 6.";

// Întrebările de debrief: cele ale scenariului (dacă trainerul le-a personalizat), altfel cele standard ale activității
export const customDebrief = (scenario) =>
  Array.isArray(scenario?.debrief) ? scenario.debrief.filter((q) => typeof q === "string" && q.trim()).map((q) => q.trim()) : [];
export const hasCustomDebrief = (scenario) => customDebrief(scenario).length > 0;
export const debriefFor = (mode, scenario = null) => {
  const own = customDebrief(scenario);
  if (own.length) return own;
  return mode === "model" ? DEBRIEF_MODEL : DEBRIEF;
};

export const DEBRIEF = [
  "Ce presupuneri ai făcut fără să îți dai seama?",
  "Ce s-a schimbat când ai putut clarifica și verifica înțelegerea?",
  "Ce întrebare ai putea folosi într-o conversație cu un client dificil pentru a preveni escaladarea?",
];

// ---------------------------------------------------------------------
//  Modelul clasic (varianta 0) — exact cele două modele inițiale
// ---------------------------------------------------------------------
const CLASSIC_MODEL_TARGETS = [
  [{ s: "●", x: 2, y: 0 }, { s: "▲", x: 1, y: 1 }, { s: "■", x: 2, y: 1 }, { s: "▬", x: 2, y: 2 }, { s: "➜", x: 3, y: 2 }],
  [{ s: "★", x: 0, y: 0 }, { s: "●", x: 1, y: 1 }, { s: "■", x: 2, y: 1 }, { s: "▲", x: 3, y: 2 }, { s: "➜", x: 2, y: 3 }],
  [{ s: "■", x: 0, y: 0 }, { s: "▲", x: 1, y: 1 }, { s: "★", x: 2, y: 2 }, { s: "●", x: 3, y: 1 }, { s: "➜", x: 1, y: 3 }],
];

// n = fără articol (după „sub”, „față de”), d = cu articol (început de propoziție), g = genitiv (după „deasupra”, „la dreapta”)
const SHAPES = [
  { s: "●", n: "cerc", d: "cercul", g: "cercului" },
  { s: "▲", n: "triunghi", d: "triunghiul", g: "triunghiului" },
  { s: "■", n: "pătrat", d: "pătratul", g: "pătratului" },
  { s: "▬", n: "dreptunghi", d: "dreptunghiul", g: "dreptunghiului" },
  { s: "➜", n: "săgeată", d: "săgeata", g: "săgeții" },
  { s: "★", n: "stea", d: "steaua", g: "stelei" },
];
const SHAPE_BY_SYMBOL = Object.fromEntries(SHAPES.map((x) => [x.s, x]));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// generator pseudo-aleatoriu determinist: același număr => aceleași modele, pe orice ecran
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const NEIGHBORS = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => [dx, dy])).filter(([dx, dy]) => dx || dy);

// 5 piese distincte, pe grila 4×4, legate între ele (vecine pe orizontală, verticală sau diagonală),
// cu un model care ocupă cel puțin 3 rânduri și 3 coloane (ca să merite descris)
function generateTarget(rand) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const symbols = shuffled(SHAPES, rand).slice(0, 5).map((x) => x.s);
    const cells = [{ x: Math.floor(rand() * 4), y: Math.floor(rand() * 4) }];
    while (cells.length < 5) {
      const free = new Map();
      for (const c of cells) {
        for (const [dx, dy] of NEIGHBORS) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (x < 0 || x > 3 || y < 0 || y > 3) continue;
          if (cells.some((q) => q.x === x && q.y === y)) continue;
          free.set(`${x},${y}`, { x, y });
        }
      }
      const options = [...free.values()];
      cells.push(options[Math.floor(rand() * options.length)]);
    }
    const spanX = Math.max(...cells.map((c) => c.x)) - Math.min(...cells.map((c) => c.x)) + 1;
    const spanY = Math.max(...cells.map((c) => c.y)) - Math.min(...cells.map((c) => c.y)) + 1;
    if (spanX >= 3 && spanY >= 3) return cells.map((c, i) => ({ s: symbols[i], x: c.x, y: c.y }));
  }
  return CLASSIC_MODEL_TARGETS[0];
}

const RELATIONS = {
  "0,1": (r) => `imediat sub ${r.n}`,
  "0,-1": (r) => `imediat deasupra ${r.g}`,
  "1,0": (r) => `imediat la dreapta ${r.g}`,
  "-1,0": (r) => `imediat la stânga ${r.g}`,
  "1,1": (r) => `în diagonală, dreapta-jos față de ${r.n}`,
  "-1,1": (r) => `în diagonală, stânga-jos față de ${r.n}`,
  "1,-1": (r) => `în diagonală, dreapta-sus față de ${r.n}`,
  "-1,-1": (r) => `în diagonală, stânga-sus față de ${r.n}`,
};

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const ROW_ORD = ["primul", "al doilea", "al treilea", "al patrulea"];
const COL_ORD = ["prima", "a doua", "a treia", "a patra"];

// piesa de referinta pentru piesa `i`: o piesa anterioara vecina (ortogonal de preferat, apoi diagonal)
function refFor(items, i) {
  const p = items[i];
  const earlier = items.slice(0, i);
  const orth = earlier.findIndex((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) === 1);
  return orth >= 0 ? orth : earlier.findIndex((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1);
}

// ---- Runda 3: descriere EXACTA, cu sistem de referinta ----
function describeExact(items) {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [
    "Sistem de referință (spune-l înainte să începi):",
    "• Grila are 4 rânduri și 4 coloane, deci 16 pătrate. Fiecare piesă ocupă exact un pătrat, iar două piese nu pot sta în același pătrat.",
    "• Rândurile se numără de sus în jos: rândul 1 este cel de sus, rândul 4 cel de jos.",
    "• Coloanele se numără de la stânga la dreapta: coloana 1 este cea din stânga, coloana 4 cea din dreapta.",
    "• Pe ecranul participanților rândurile și coloanele sunt numerotate la fel.",
  ];
  if (items.some((p) => p.s === "➜")) lines.push("• Săgeata ➜ are vârful spre dreapta și așa rămâne.");
  lines.push("Piesele (rând, coloană):");
  order.forEach((p, i) => lines.push(`${i + 1}. ${cap(SHAPE_BY_SYMBOL[p.s].d)} ${p.s} — rândul ${p.y + 1}, coloana ${p.x + 1}.`));
  lines.push("Celelalte pătrate rămân goale.");
  return lines.join("\n");
}

// ---- Runda 1: descriere INTERPRETABILA (indicii vagi; aceeasi descriere se potriveste mai multor asezari) ----
// Intoarce si constrangerile (pentru verificare in teste): fiecare piesa e descrisa doar printr-o regiune sau o relatie vaga
function describeAmbiguous(items, rand) {
  const lines = ["Vă descriu pe rând cele 5 piese."];
  const constraints = [];
  const p0 = items[0];
  const sh0 = SHAPE_BY_SYMBOL[p0.s];
  const rows = p0.y < 2 ? [0, 1] : [2, 3];
  const cols = p0.x < 2 ? [0, 1] : [2, 3];
  constraints.push({ i: 0, kind: "region", rows, cols });
  lines.push(`Începem cu ${sh0.d} ${p0.s}: se află ${p0.y < 2 ? "în jumătatea de sus" : "în jumătatea de jos"} a grilei, ${p0.x < 2 ? "mai spre stânga" : "mai spre dreapta"}.`);
  const openers = ["Apoi", "După aceea", "Mai departe", "Urmează", "Încă o piesă:", "Pe urmă"];
  for (let i = 1; i < items.length; i++) {
    const p = items[i];
    const j = refFor(items, i);
    const ref = items[j];
    const sh = SHAPE_BY_SYMBOL[p.s];
    const rf = SHAPE_BY_SYMBOL[ref.s];
    const dx = p.x - ref.x;
    const dy = p.y - ref.y;
    const orthogonal = Math.abs(dx) + Math.abs(dy) === 1;
    const near = !orthogonal || rand() < 0.5; // diagonala: doar „lângă”; ortogonal: uneori vag-directional, uneori „lângă”
    let phrase;
    if (near) {
      constraints.push({ i, kind: "near", ref: j });
      phrase = pick(rand, [`lângă ${rf.n}`, `în apropierea ${rf.g}`, `undeva în jurul ${rf.g}`]);
    } else if (dy === 1) {
      constraints.push({ i, kind: "below", ref: j });
      phrase = pick(rand, [`undeva sub ${rf.n}`, `mai jos de ${rf.n}`]);
    } else if (dy === -1) {
      constraints.push({ i, kind: "above", ref: j });
      phrase = pick(rand, [`undeva deasupra ${rf.g}`, `mai sus de ${rf.n}`]);
    } else if (dx === 1) {
      constraints.push({ i, kind: "right", ref: j });
      phrase = pick(rand, [`undeva la dreapta ${rf.g}`, `mai spre dreapta față de ${rf.n}`]);
    } else {
      constraints.push({ i, kind: "left", ref: j });
      phrase = pick(rand, [`undeva la stânga ${rf.g}`, `mai spre stânga față de ${rf.n}`]);
    }
    lines.push(`${pick(rand, openers)} ${sh.d} ${p.s}: ${phrase}.`);
  }
  lines.push("Restul pătratelor rămân goale.");
  return { guide: lines.join("\n"), constraints };
}

// ---- Runda 2: descriere STUFOASA (informatia corecta e acolo, dar ingropata in cuvinte) ----
function describeVerbose(items, rand) {
  const intro =
    "Înainte să începem, câteva precizări care s-ar putea să vă fie sau să nu vă fie de folos, depinde cum le luați: grila pe care o aveți în față are patru rânduri, care merg pe orizontală, și patru coloane, care merg pe verticală, deci în total șaisprezece pătrățele, pe care le puteți privi fie ca pe un tablou de șah în miniatură, fie ca pe o foaie de caiet cu pătrățele, cum vă este mai comod. Rândurile le numărăm de sus în jos, deși, recunosc, le-am putea număra și invers, dar pentru ordine le vom număra de sus, iar coloanele de la stânga la dreapta, bineînțeles, ca la citit, deși nimeni nu v-a întrebat dacă vă place sau nu această convenție, pe care o păstrăm de la început până la sfârșit.";
  const paragraphs = [];
  items.forEach((p, i) => {
    const sh = SHAPE_BY_SYMBOL[p.s];
    const row = p.y + 1;
    const col = p.x + 1;
    const rowOrd = ROW_ORD[p.y];
    const colOrd = COL_ORD[p.x];
    // „nu in rândul X / coloana Y”: adevarat, dar fara folos
    const otherRow = pick(rand, [1, 2, 3, 4].filter((n) => n !== row));
    const otherCol = pick(rand, [1, 2, 3, 4].filter((n) => n !== col));
    if (i === 0) {
      paragraphs.push(
        `Începem, fără prea multe ocolișuri, deși ocolișurile ar fi fost la îndemână, cu ${sh.d} ${p.s}, prima piesă, așa că nu avem încă nicio altă piesă după care să ne orientăm și ne luăm doar după grilă: o așezați în ${rowOrd} rând numărând de sus, adică în rândul ${row}, și în ${colOrd} coloană numărând din stânga, adică în coloana ${col}, nu în rândul ${otherRow} și nu în coloana ${otherCol}, cum ar putea să creadă cei grăbiți.`
      );
      return;
    }
    const j = refFor(items, i);
    const ref = items[j];
    const rf = SHAPE_BY_SYMBOL[ref.s];
    const rel = RELATIONS[`${p.x - ref.x},${p.y - ref.y}`](rf);
    const relVerb = `se află ${rel}`;
    const templates = [
      `Acum să trecem, fără grabă dar și fără să pierdem vremea, la ${sh.d} ${p.s} — vă rog să rețineți că vorbesc despre ${sh.d} și nu despre altă piesă din cele pe care le aveți în față — pe care o veți așeza în ${rowOrd} rând numărând de sus, adică în rândul ${row}, iar pe orizontală în ${colOrd} coloană numărând din stânga, adică în coloana ${col}, ceea ce, pentru cei care preferă să se orienteze după piesele dinainte, înseamnă că ${relVerb}, deci, ca să nu rămână dubii, nu în rândul ${otherRow} și nu în coloana ${otherCol}.`,
      `Mai departe — și aici vă rog să fiți atenți, deși nu v-aș spune că e neapărat cel mai greu moment — avem ${sh.d} ${p.s}, care, după cum probabil v-ați dat seama singuri, nu are cum să stea în același pătrat cu alta, așa că o așezăm în ${rowOrd} rând de sus, rândul ${row} după numărătoarea noastră, și în ${colOrd} coloană de la stânga, coloana ${col}, ceea ce, dacă o raportați la ce am așezat deja, înseamnă că ${relVerb}; spun asta de două ori, o dată cu cifre și o dată cu cuvinte, tocmai ca să nu o așezați în rândul ${otherRow}.`,
      `Pentru ${sh.d} ${p.s} lucrurile stau așa, și îmi cer scuze dacă par să mă repet: pătratul ei este cel din rândul ${row}, adică ${rowOrd} de sus, și din coloana ${col}, adică ${colOrd} de la stânga, sau, spus altfel, ${relVerb}; și, între noi fie vorba, ${sh.d} ${p.s} este o piesă care se vede bine pe grilă, dar asta nu schimbă cu nimic locul ei, care rămâne rândul ${row}, coloana ${col}, nu coloana ${otherCol}.`,
      `Și acum, ca să nu spuneți că vă las pe dinafară, urmează ${sh.d} ${p.s}, despre care aș putea să vă spun multe, dar mă limitez la esențial, adică la faptul că ea ocupă rândul ${row} — cel numărat ${rowOrd}, de sus în jos — și coloana ${col} — cea numărată ${colOrd}, de la stânga la dreapta — iar ${relVerb}, ceea ce înseamnă, în alți termeni, că rândul ei nu este ${otherRow}, iar coloana ei nu este ${otherCol}.`,
    ];
    paragraphs.push(pick(rand, templates));
  });
  const closing =
    "Asta ar fi tot, deși, dacă vă gândiți bine, rămâne senzația că poate am omis ceva, dar nu am omis nimic: toate cele cinci piese au fost spuse, iar pătrățelele rămase libere rămân libere, adică goale, fără nicio piesă pe ele, indiferent cât de tentant ar fi să le umpleți.";
  return [intro, ...paragraphs, closing].join("\n\n");
}

const MODEL_STYLES = [
  {
    key: "ambiguous",
    label: "Descriere interpretabilă",
    tip: "Citește descrierea așa cum e: unele indicii sunt vagi, deci aceeași descriere se potrivește mai multor așezări. Nu da detalii suplimentare și nu răspunde la întrebări.",
  },
  {
    key: "verbose",
    label: "Descriere stufoasă",
    tip: "Citește tot, rar, fără să sari peste digresiuni: informația corectă e acolo, dar îngropată în cuvinte. Nu o rezuma și nu răspunde la întrebări.",
  },
  {
    key: "exact",
    label: "Descriere exactă, cu sistem de referință",
    tip: "Spune întâi sistemul de referință, apoi piesele, pe rând. Pe ecranul participanților rândurile și coloanele sunt numerotate; dacă toată lumea folosește aceeași grilă, nimeni nu are cum să greșească.",
  },
];

const sameTarget = (a, b) => a.length === b.length && a.every((p) => b.some((q) => q.s === p.s && q.x === p.x && q.y === p.y));

// Trei modele diferite, câte unul pe rundă. Același număr (seed) → aceleași modele și aceleași texte, pe orice ecran.
function modelRounds(seed) {
  const targets = [];
  if (!seed) {
    targets.push(...CLASSIC_MODEL_TARGETS);
  } else {
    const rand = rng(seed);
    while (targets.length < 3) {
      let t = generateTarget(rand);
      for (let k = 0; k < 20 && targets.some((x) => sameTarget(x, t)); k++) t = generateTarget(rand);
      targets.push(t);
    }
  }
  const textRand = rng((seed || 1) * 7919 + 13);
  return targets.map((target, i) => {
    const style = MODEL_STYLES[i];
    let guide;
    let constraints = null;
    if (i === 0) ({ guide, constraints } = describeAmbiguous(target, textRand));
    else if (i === 1) guide = describeVerbose(target, textRand);
    else guide = describeExact(target);
    return {
      title: `Runda ${i + 1}`,
      rule:
        "Ascultă descrierea facilitatorului și așază piesele pe grilă." +
        (style.key === "exact" ? " Rândurile și coloanele sunt numerotate: folosește-le." : "") +
        " Ce ai pe grilă se trimite automat când se trece la pasul următor.",
      style: style.key,
      styleLabel: style.label,
      tip: style.tip,
      axes: style.key === "exact", // doar runda 3 afiseaza numerele rândurilor si coloanelor
      target,
      guide,
      constraints,
    };
  });
}

// ---------------------------------------------------------------------
//  API folosit de paginile participantului și trainerului
//  `index` = valoarea salvată în communication_sessions.prompt_index
//  (desen / mesaje: numărul variantei; model: numărul din care se generează modelele)
// ---------------------------------------------------------------------
// Scenariu propriu la „Ce ai înțeles?”: 1 sau 2 runde, fiecare cu mesajul clientului și informația lipsă (doar pentru trainer)
export function clientScenarioRounds(scenario) {
  return scenario.rounds.slice(0, 2).map((r, i) => ({
    title: r.title || scenario.title || `Runda ${i + 1}`,
    message: r.message || "",
    detail: r.detail || "",
    rule: i === 0 ? C1_RULE : C2_RULE,
  }));
}

// Scenariile de bază („Ce ai înțeles?”) din cod, ca puncte de pornire: [{ index, title, rounds }]
export function baseClientScenarios() {
  return ACTIVITIES.client.variants.map((v, index) => ({ index, title: v.rounds.map((r) => r.title).join(" → "), rounds: v.rounds }));
}

export function getRounds(mode, index = 0, scenario = null) {
  if (mode === "model") return modelRounds(Number(index) || 0);
  if (mode === "draw") return scenarioRounds(scenario);
  if (mode === "client" && scenario?.rounds?.length) return clientScenarioRounds(scenario);
  const list = ACTIVITIES[mode].variants;
  return list[(Number(index) || 0) % list.length].rounds;
}

export function randomVariant(mode, current = -1) {
  if (mode === "draw") return 0; // scenariul se alege separat (din „Scenariile mele”)
  if (mode === "model") {
    let n;
    do n = 1 + Math.floor(Math.random() * 99999);
    while (n === current);
    return n;
  }
  const count = ACTIVITIES[mode].variants.length;
  if (count < 2) return 0;
  let n;
  do n = Math.floor(Math.random() * count);
  while (n === current);
  return n;
}

export function variantLabel(mode, index = 0, scenario = null) {
  if (mode === "model") return Number(index) ? `Model aleatoriu #${index}` : "Modelele clasice";
  if (mode === "draw") return scenario?.title || "—";
  if (mode === "client" && scenario?.rounds?.length) return scenario.title || "—";
  return getRounds(mode, index).map((r) => r.title).join(" → ");
}
