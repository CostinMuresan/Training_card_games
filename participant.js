import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const participantCode = params.get("p");

let participant = null;  // randul din session_participants
let groupId = null;
let sessionId = null;
let sessionInfo = {};
let solutionRevealedAt = null;
let cards = [];          // cardurile private ale acestui participant
let pollTimer = null;
let timerTickInterval = null;

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

// ---------- CRONOMETRU (identic cu learner.js) ----------
function liveRemaining() {
  if (sessionInfo.timer_status === "running" && sessionInfo.timer_started_at) {
    const elapsed = (Date.now() - new Date(sessionInfo.timer_started_at).getTime()) / 1000;
    return Math.max(0, (sessionInfo.timer_remaining_seconds || 0) - elapsed);
  }
  return sessionInfo.timer_remaining_seconds || 0;
}

function secondsToHMS(total) {
  total = Math.max(0, Math.round(total));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function updateTimerDisplay() {
  const bar = $("session-timer-bar");
  const overlay = $("expired-overlay");
  const status = sessionInfo.timer_status || "not_started";
  if (status === "not_started" || status === "none") {
    bar.style.display = "none";
    overlay.style.display = "none";
    return;
  }
  bar.style.display = "block";
  $("learner-timer-display").textContent = secondsToHMS(liveRemaining());
  $("learner-timer-display").style.color = status === "expired" ? "var(--red)" : status === "paused" ? "var(--grey)" : "var(--green)";
  overlay.style.display = status === "expired" ? "flex" : "none";
}

async function init() {
  if (!participantCode) {
    $("status-box").innerHTML = `<div class="empty-state">Link invalid. Cere trainerului link-ul tău personal.</div>`;
    return;
  }

  const { data: pData, error: pErr } = await supabase
    .from("session_participants")
    .select("*")
    .eq("participant_code", participantCode)
    .maybeSingle();

  if (pErr || !pData) {
    $("status-box").innerHTML = `<div class="empty-state">Link invalid sau contul tău nu mai există.</div>`;
    return;
  }
  participant = pData;
  groupId = participant.group_id;
  sessionId = participant.session_id;
  $("participant-name-bar").style.display = "block";
  $("participant-name-badge").textContent = participant.name;

  const { data: sessionData } = await supabase
    .from("training_sessions")
    .select("status, timer_total_seconds, timer_remaining_seconds, timer_status, timer_started_at, games(name)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!sessionData || sessionData.status !== "active") {
    $("status-box").innerHTML = `<div class="empty-state">Sesiunea nu există sau s-a încheiat. Cere trainerului un link nou.</div>`;
    return;
  }
  sessionInfo = sessionData;
  if (sessionData.games?.name) {
    $("participant-game-title").textContent = sessionData.games.name;
    document.title = sessionData.games.name;
  }

  const { data: groupData } = await supabase.from("session_groups").select("solution_revealed_at").eq("id", groupId).maybeSingle();
  solutionRevealedAt = groupData?.solution_revealed_at || null;

  const { data: pcRows } = await supabase.from("session_participant_cards").select("card_id").eq("participant_id", participant.id);
  const cardIds = (pcRows || []).map((r) => r.card_id);
  if (cardIds.length > 0) {
    const { data: cardData } = await supabase.from("cards").select("*").in("id", cardIds).order("order_index", { ascending: true });
    cards = cardData || [];
  }

  render();
  if (solutionRevealedAt) loadSolution();
  subscribeRealtime();
  startPolling();
  timerTickInterval = setInterval(() => {
    updateTimerDisplay();
    if (sessionInfo.timer_status === "running" && liveRemaining() <= 0) {
      sessionInfo.timer_status = "expired";
      updateTimerDisplay();
    }
  }, 1000);
}

function render() {
  updateTimerDisplay();
  const grid = $("learner-grid");
  const section = $("private-cards-section");

  if ((sessionInfo.timer_status || "not_started") === "not_started") {
    section.style.display = "none";
    $("status-box").innerHTML = `<div class="empty-state">⏳ Sesiunea nu a început încă. Așteaptă ca trainerul să o pornească.</div>`;
    return;
  }
  $("status-box").innerHTML = "";

  if (cards.length === 0) {
    section.style.display = "block";
    grid.innerHTML = `<div class="empty-state">Trainerul nu ți-a alocat încă niciun card privat.</div>`;
    return;
  }

  section.style.display = "block";
  grid.innerHTML = "";
  cards.forEach((c) => {
    const wrap = document.createElement("div");
    wrap.className = "flip-card-wrap";

    const zoomBtn = document.createElement("button");
    zoomBtn.className = "zoom-btn";
    zoomBtn.textContent = "🔍";
    zoomBtn.title = "Vezi mărit";
    zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightbox(c.front_image_url);
    });

    const card = document.createElement("div");
    card.className = "flip-card";
    card.style.setProperty("--ar", c.aspect_ratio || 0.75);
    card.innerHTML = `<div class="static-card"><img src="${c.front_image_url}" alt="${escapeHtml(c.title)}" /></div>`;

    const label = document.createElement("div");
    label.className = "card-title";
    label.textContent = c.title;

    wrap.appendChild(zoomBtn);
    wrap.appendChild(card);
    wrap.appendChild(label);
    grid.appendChild(wrap);
  });
}

async function loadSolution() {
  const { data } = await supabase.from("session_group_target_cards").select("card_id").eq("group_id", groupId);
  const cardIds = (data || []).map((r) => r.card_id);
  if (cardIds.length === 0) return;
  const { data: cardData } = await supabase.from("cards").select("*").in("id", cardIds).order("order_index", { ascending: true });

  const section = $("solution-section");
  const grid = $("solution-grid");
  grid.innerHTML = "";
  (cardData || []).forEach((c) => {
    const wrap = document.createElement("div");
    wrap.className = "flip-card-wrap";
    const card = document.createElement("div");
    card.className = "flip-card";
    card.style.setProperty("--ar", c.aspect_ratio || 0.75);
    card.innerHTML = `<div class="static-card"><img src="${c.front_image_url}" alt="${escapeHtml(c.title)}" /></div>`;
    const label = document.createElement("div");
    label.className = "card-title";
    label.textContent = c.title;
    wrap.appendChild(card);
    wrap.appendChild(label);
    grid.appendChild(wrap);
  });
  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openLightbox(src) {
  const img = $("learner-lightbox-img");
  img.src = src;
  img.classList.remove("super-zoom");
  $("learner-lightbox").scrollTo(0, 0);
  $("learner-lightbox").style.display = "flex";
}
$("learner-lightbox").addEventListener("click", () => ($("learner-lightbox").style.display = "none"));
$("learner-lightbox-img").addEventListener("click", (e) => {
  e.stopPropagation();
  e.target.classList.toggle("super-zoom");
});

function showSessionEnded() {
  if (pollTimer) clearInterval(pollTimer);
  if (timerTickInterval) clearInterval(timerTickInterval);
  supabase.removeAllChannels();
  $("private-cards-section").style.display = "none";
  $("solution-section").style.display = "none";
  $("learner-lightbox").style.display = "none";
  $("session-timer-bar").style.display = "none";
  $("participant-name-bar").style.display = "none";
  $("expired-overlay").style.display = "none";
  $("status-box").innerHTML = `<div class="empty-state">Sesiunea nu există sau s-a încheiat. Cere trainerului un link nou.</div>`;
}

function subscribeRealtime() {
  supabase
    .channel(`participant-${participant.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "training_sessions", filter: `id=eq.${sessionId}` },
      (payload) => {
        if (payload.new.status !== "active") {
          showSessionEnded();
          return;
        }
        const wasNotStarted = (sessionInfo.timer_status || "not_started") === "not_started";
        sessionInfo = { ...sessionInfo, ...payload.new };
        if (wasNotStarted && sessionInfo.timer_status !== "not_started") render();
        else updateTimerDisplay();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "session_groups", filter: `id=eq.${groupId}` },
      (payload) => {
        if (payload.new.solution_revealed_at && !solutionRevealedAt) {
          solutionRevealedAt = payload.new.solution_revealed_at;
          loadSolution();
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "session_participant_cards", filter: `participant_id=eq.${participant.id}` },
      async () => {
        const { data: pcRows } = await supabase.from("session_participant_cards").select("card_id").eq("participant_id", participant.id);
        const cardIds = (pcRows || []).map((r) => r.card_id);
        if (cardIds.length > 0) {
          const { data: cardData } = await supabase.from("cards").select("*").in("id", cardIds).order("order_index", { ascending: true });
          cards = cardData || [];
        } else {
          cards = [];
        }
        render();
      }
    )
    .subscribe();
}

// fallback pentru retele care blocheaza WebSocket (identic cu learner.js)
function startPolling() {
  pollTimer = setInterval(pollUpdates, 4000);
}

async function pollUpdates() {
  if (!participant) return;
  try {
    const { data: sessionData } = await supabase
      .from("training_sessions")
      .select("status, timer_total_seconds, timer_remaining_seconds, timer_status, timer_started_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (!sessionData || sessionData.status !== "active") {
      showSessionEnded();
      return;
    }
    if (JSON.stringify(sessionData) !== JSON.stringify({ ...sessionInfo, games: undefined })) {
      const wasNotStarted = (sessionInfo.timer_status || "not_started") === "not_started";
      sessionInfo = { ...sessionInfo, ...sessionData };
      updateTimerDisplay();
      if (wasNotStarted && sessionInfo.timer_status !== "not_started") render();
    }

    const { data: groupData } = await supabase.from("session_groups").select("solution_revealed_at").eq("id", groupId).maybeSingle();
    if (groupData?.solution_revealed_at && !solutionRevealedAt) {
      solutionRevealedAt = groupData.solution_revealed_at;
      loadSolution();
    }
  } catch (err) {
    // eroare temporara de retea - reincercam la urmatorul ciclu
  }
}

init();
