// Hub-ul trainerului: după autentificare, alege activitatea pe care o lansează și reia o sesiune în desfășurare.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ACTIVITIES, icon } from "./activities.js";
import { ACTIVITIES as COMM_MODES } from "./communication-data.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

function showLogin() {
  $("auth-box").hidden = false;
  $("hub").hidden = true;
  $("logout-btn").hidden = true;
  $("manual-link").hidden = true;
  $("user-email").textContent = "";
  window.TCTheme?.useDefault(); // ecranul de autentificare: mereu tema implicită
}

function renderTiles() {
  const box = $("tiles");
  box.innerHTML = "";
  for (const a of ACTIVITIES) {
    const el = document.createElement("a");
    el.className = "tile";
    el.href = a.href;
    el.dataset.activity = a.id;
    el.innerHTML = `<span class="card-icon">${icon(a.icon, 26)}</span><span class="tile-title"></span><span class="tile-chips"></span><span class="tile-text"></span><span class="tile-open">Deschide ${icon("arrow", 18)}</span>`;
    el.querySelector(".tile-title").textContent = a.title;
    el.querySelector(".tile-text").textContent = a.text;
    for (const c of a.chips || []) {
      const s = document.createElement("span");
      s.textContent = c;
      el.querySelector(".tile-chips").append(s);
    }
    box.append(el);
  }
}

// sesiunile încă neîncheiate ale trainerului, din fiecare activitate; „Reia” deschide panoul activității, care o reia singur
async function loadRunning(email) {
  const act = (id) => ACTIVITIES.find((a) => a.id === id);
  const sel = (table, cols) => supabase.from(table).select(cols).eq("admin_email", email).neq("status", "ended").order("created_at", { ascending: false }).limit(5);
  const [rec, com, cards] = await Promise.all([
    sel("recap_sessions", "id, topic, session_code"),
    sel("communication_sessions", "id, mode, session_code"),
    supabase.from("training_sessions").select("id, game_id").eq("admin_email", email).eq("status", "active").order("created_at", { ascending: false }).limit(5),
  ]);
  const rows = [];
  const count = async (table, id) => ((await supabase.from(table).select("id").eq("session_id", id)).data || []).length;
  for (const s of rec.data || []) rows.push({ a: act("recap"), title: s.topic || "Recapitulare", code: s.session_code, n: await count("recap_participants", s.id) });
  for (const s of com.data || []) rows.push({ a: act("communication"), title: COMM_MODES[s.mode]?.name || "Nodul comunicării", code: s.session_code, n: await count("communication_participants", s.id) });
  if ((cards.data || []).length) {
    const { data: games } = await supabase.from("games").select("id, name");
    const name = (id) => (games || []).find((g) => g.id === id)?.name;
    for (const s of cards.data) rows.push({ a: act("cards"), title: name(s.game_id) || "Joc cu cărți" });
  }
  $("running").hidden = rows.length === 0;
  const list = $("running-list");
  list.innerHTML = "";
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "run-row";
    row.innerHTML = `<span class="run-badge"></span><span class="run-main"><strong></strong><span></span></span><a class="run-go">${icon("play", 14)} Reia</a>`;
    row.querySelector(".run-badge").textContent = r.a.badge;
    row.querySelector("strong").textContent = r.title;
    const meta = [];
    if (r.n !== undefined) meta.push(`${r.n} participanți`);
    if (r.code) meta.push(`cod ${r.code}`);
    row.querySelector(".run-main span").textContent = meta.join(" · ");
    row.querySelector(".run-go").href = r.a.href;
    list.append(row);
  }
}

async function enterHub(user) {
  $("auth-box").hidden = true;
  $("hub").hidden = false;
  $("logout-btn").hidden = false;
  $("manual-link").hidden = false;
  $("user-email").textContent = user.email;
  window.TCTheme?.initTrainer(supabase, user.email); // tema salvată de trainer
  renderTiles();
  loadRunning(user.email);
}

async function login() {
  $("auth-error").textContent = "";
  const { data, error } = await supabase.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  if (error || !data?.user) {
    $("auth-error").textContent = "Email sau parolă greșite.";
    return;
  }
  await enterHub(data.user);
}
$("login").onclick = login;
$("password").addEventListener("keydown", (e) => e.key === "Enter" && login());
$("logout-btn").onclick = async () => {
  await supabase.auth.signOut();
  window.TCTheme?.useDefault(); // următoarea persoană din același browser nu primește tema acestui trainer
  location.href = "index.html";
};

(async function init() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  // o sesiune anonimă (de exemplu a unui jucător) nu e un trainer autentificat
  if (!session || session.user?.is_anonymous) return showLogin();
  await enterHub(session.user);
})();
