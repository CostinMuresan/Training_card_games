// Pagina inițială: „Intru cu cod”. Participantul scrie codul primit de la trainer, iar pagina află, printr-o funcție din baza de date
// (resolve_session_code), ce activitate este și îl duce la pagina potrivită. Funcția returnează doar tipul activității și codul exact.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { PLAY_GAMES, CODE_LABELS, icon } from "./activities.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

// pagini de participant la care se poate ajunge (nimic altceva nu se deschide din câmpul de cod)
const PARTICIPANT_PAGES = new Set(["grupa.html", "participant.html", "colourblind.html", "communication.html", "recap.html"]);
const KNOWN_PAGES = new Set([...PARTICIPANT_PAGES, "index.html"]);

// ---- cardul „Jocuri de training”: apare doar când există jocuri individuale ----
if (PLAY_GAMES.length) {
  $("games-card").hidden = false;
  for (const g of PLAY_GAMES) {
    const a = document.createElement("a");
    a.className = "home-link";
    a.href = g.href;
    a.innerHTML = `${icon(g.icon || "puzzle", 26)}<span class="grow"><strong></strong><span class="sub"></span></span>${icon("arrow", 18)}`;
    a.querySelector("strong").textContent = g.name;
    a.querySelector(".sub").textContent = g.text || "";
    $("games-list").append(a);
  }
}

// ---- cod ----
let fails = []; // momentele încercărilor eșuate (doar o frână în pagină, nu o protecție reală)
let blockedUntil = 0;
const msg = (t) => ($("code-msg").textContent = t || "");

// un link lipit întreg, de pe același site, merge direct; altfel e un cod (litere și cifre)
function readInput(raw) {
  const v = String(raw || "").trim();
  if (!v) return { error: "Scrie codul primit de la trainer." };
  try {
    const u = new URL(v, location.href);
    if (u.origin === location.origin && u.search && KNOWN_PAGES.has(u.pathname.split("/").pop())) return { url: u.href };
  } catch {
    /* nu e un link */
  }
  const code = v.replace(/\s+/g, "");
  if (!/^[a-z0-9]{4,12}$/i.test(code)) return { error: "Codul are doar litere și cifre, între 4 și 12 caractere." };
  return { code };
}

function go(row) {
  if (!PARTICIPANT_PAGES.has(row.page) || !/^[gs]$/.test(row.param)) return msg("Nu am putut deschide activitatea. Cere linkul de la trainer.");
  location.href = `${row.page}?${row.param}=${encodeURIComponent(row.code)}`;
}

function showChoices(rows) {
  const ul = $("code-choices");
  ul.innerHTML = "";
  msg("Codul se potrivește cu mai multe activități. Alege-o pe a ta:");
  for (const row of rows) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = CODE_LABELS[row.activity] || row.activity;
    b.onclick = () => go(row);
    li.append(b);
    ul.append(li);
  }
  ul.hidden = false;
}

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("code-choices").hidden = true;
  msg("");
  const now = Date.now();
  if (blockedUntil > now) return msg(`Prea multe încercări. Așteaptă ${Math.ceil((blockedUntil - now) / 1000)} secunde.`);
  const r = readInput($("code").value);
  if (r.url) {
    location.href = r.url;
    return;
  }
  if (r.error) return msg(r.error);
  $("code-go").disabled = true;
  const { data, error } = await supabase.rpc("resolve_session_code", { p_code: r.code });
  $("code-go").disabled = false;
  if (error) {
    return msg(/function|schema|resolve_session_code/i.test(error.message || "") ? "Intrarea cu cod nu e disponibilă momentan. Folosește linkul sau codul QR de la trainer." : "Nu am putut verifica codul. Încearcă din nou.");
  }
  if (!data || !data.length) {
    fails = fails.filter((t) => now - t < 60000).concat(now);
    if (fails.length >= 5) {
      blockedUntil = now + 30000;
      fails = [];
      return msg("Prea multe încercări. Așteaptă 30 de secunde, apoi verifică codul.");
    }
    return msg("Nu am găsit niciun cod ca acesta. Verifică-l sau cere-l din nou trainerului.");
  }
  if (data.length === 1) return go(data[0]);
  showChoices(data);
});

$("code").addEventListener("input", () => msg(""));
$("code").focus();
