import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const sessionCode = params.get("s");

let session = null;       // randul din training_sessions
let myParticipant = null; // randul din cb_participants pentru acest browser
let pollTimer = null;     // fallback, ca la restul aplicatiei, pentru retele care blocheaza WebSocket

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
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

function renderCardGrid(gridId, cardList, emptyMsg) {
  const grid = $(gridId);
  grid.innerHTML = "";
  if (cardList.length === 0) {
    grid.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
    return;
  }
  cardList.forEach((c) => {
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

async function init() {
  if (!sessionCode) {
    $("cb-status-box").innerHTML = `<div class="empty-state">Link invalid. Cere trainerului link-ul echipei.</div>`;
    return;
  }
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("session_code", sessionCode)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) {
    $("cb-status-box").innerHTML = `<div class="empty-state">Sesiunea nu există sau s-a încheiat. Cere trainerului un link nou.</div>`;
    return;
  }
  session = data;
  window.TCTheme?.initParticipant(supabase, "cards", session.id); // tema trainerului

  const storageKey = `cb_participant_${session.id}`;
  const savedId = localStorage.getItem(storageKey);
  if (savedId) {
    const { data: p } = await supabase.from("cb_participants").select("*").eq("id", savedId).maybeSingle();
    if (p) myParticipant = p;
  }

  if (!myParticipant) {
    $("cb-alias-box").style.display = "block";
  } else {
    await render();
  }

  subscribeRealtime();
  pollTimer = setInterval(refreshSession, 4000);
}

$("cb-alias-submit-btn").addEventListener("click", submitAlias);
$("cb-alias-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAlias();
});

async function submitAlias() {
  const alias = $("cb-alias-input").value.trim();
  $("cb-alias-error").textContent = "";
  if (!alias) {
    $("cb-alias-error").textContent = "Introduce un alias.";
    return;
  }
  const btn = $("cb-alias-submit-btn");
  btn.disabled = true;
  try {
    const { data, error } = await supabase
      .from("cb_participants")
      .insert({ session_id: session.id, alias })
      .select()
      .single();
    if (error) {
      $("cb-alias-error").textContent =
        error.code === "23505" ? "Acest alias e deja folosit în sesiune — încearcă altul." : "Eroare: " + error.message;
      return;
    }
    myParticipant = data;
    localStorage.setItem(`cb_participant_${session.id}`, data.id);
    $("cb-alias-box").style.display = "none";
    await render();
  } finally {
    btn.disabled = false;
  }
}

async function refreshSession() {
  if (!session) return;
  const { data } = await supabase.from("training_sessions").select("*").eq("id", session.id).maybeSingle();
  if (!data || data.status !== "active") {
    $("cb-status-box").innerHTML = `<div class="empty-state">Sesiunea a fost încheiată de trainer.</div>`;
    $("cb-waiting-box").style.display = "none";
    $("cb-game-box").style.display = "none";
    $("cb-final-reveal-box").style.display = "none";
    clearInterval(pollTimer);
    return;
  }
  const phaseChanged = data.cb_started_at !== session.cb_started_at || data.cb_revealed_all_at !== session.cb_revealed_all_at;
  session = data;
  if (!myParticipant) return; // inca la ecranul de alias, nimic de randat
  if (phaseChanged) await render();
  else if (session.cb_started_at && !session.cb_revealed_all_at) await renderTrainerReveals();
}

async function render() {
  if (!myParticipant) return;
  $("cb-my-alias").textContent = myParticipant.alias;

  if (session.cb_revealed_all_at) {
    $("cb-waiting-box").style.display = "none";
    $("cb-game-box").style.display = "none";
    $("cb-final-reveal-box").style.display = "block";
    await renderFinalReveal();
    return;
  }

  if (!session.cb_started_at) {
    $("cb-waiting-box").style.display = "block";
    $("cb-game-box").style.display = "none";
    $("cb-final-reveal-box").style.display = "none";
    return;
  }

  $("cb-waiting-box").style.display = "none";
  $("cb-game-box").style.display = "block";
  $("cb-final-reveal-box").style.display = "none";

  const { data: myCardRows } = await supabase.from("cb_participant_cards").select("*").eq("participant_id", myParticipant.id);
  const cardIds = (myCardRows || []).map((r) => r.card_id);
  let myCards = [];
  if (cardIds.length > 0) {
    const { data: cardData } = await supabase.from("cards").select("*").in("id", cardIds);
    myCards = cardData || [];
  }
  renderCardGrid("cb-my-cards-grid", myCards, "Nu ai primit niciun card la această rundă.");

  await renderTrainerReveals();
}

async function renderTrainerReveals() {
  const { data: tcRows } = await supabase.from("cb_trainer_cards").select("*").eq("session_id", session.id);
  const revealedIds = (tcRows || []).filter((r) => r.revealed_at).map((r) => r.card_id);
  const panel = $("cb-trainer-reveals");

  if (revealedIds.length === 0) {
    // Trainerul n-a dezvaluit inca nimic - ascundem tot panoul, ca sa nu ocupe loc degeaba
    // si sa fie mai usor de vazut cardurile learnerului.
    panel.style.display = "none";
    renderCardGrid("cb-trainer-reveal-grid", [], "");
    return;
  }

  const { data: cardData } = await supabase.from("cards").select("*").in("id", revealedIds);
  const revealedCards = cardData || [];
  $("cb-trainer-reveal-title").textContent = revealedCards.length === 1 ? "Cardul trainerului" : "Cardurile trainerului";
  panel.style.display = "block";
  renderCardGrid("cb-trainer-reveal-grid", revealedCards, "");
}

async function renderFinalReveal() {
  const { data: tcRows } = await supabase.from("cb_trainer_cards").select("*").eq("session_id", session.id);
  const trainerCardIds = (tcRows || []).map((r) => r.card_id);
  let trainerCards = [];
  if (trainerCardIds.length > 0) {
    const { data } = await supabase.from("cards").select("*").in("id", trainerCardIds);
    trainerCards = data || [];
  }
  renderCardGrid("cb-final-trainer-grid", trainerCards, "—");

  const { data: partRows } = await supabase
    .from("cb_participants")
    .select("*")
    .eq("session_id", session.id)
    .order("joined_at", { ascending: true });
  const parts = partRows || [];
  const partIds = parts.map((p) => p.id);
  const { data: pcRows } = await supabase
    .from("cb_participant_cards")
    .select("*")
    .in("participant_id", partIds.length > 0 ? partIds : ["00000000-0000-0000-0000-000000000000"]);
  const allCardIds = [...new Set((pcRows || []).map((r) => r.card_id))];
  const allCardsMap = {};
  if (allCardIds.length > 0) {
    const { data } = await supabase.from("cards").select("*").in("id", allCardIds);
    (data || []).forEach((c) => (allCardsMap[c.id] = c));
  }

  const box = $("cb-final-participants-list");
  box.innerHTML = "";
  parts.forEach((p) => {
    const myIds = (pcRows || []).filter((r) => r.participant_id === p.id).map((r) => r.card_id);
    const thumbs = myIds
      .map((cid) => allCardsMap[cid])
      .filter(Boolean)
      .map(
        (c) =>
          `<img src="${c.front_image_url}" title="${escapeHtml(c.title)}" style="width:56px; height:56px; object-fit:cover; border-radius:6px; border:1px solid var(--parchment-dark); cursor:zoom-in;" data-zoom="${c.front_image_url}" />`
      )
      .join("");
    const row = document.createElement("div");
    row.className = "panel";
    row.style.cssText = "padding:12px 16px; margin:0; display:flex; align-items:center; gap:12px; flex-wrap:wrap;";
    row.innerHTML = `<strong style="min-width:110px;">${escapeHtml(p.alias)}</strong><div style="display:flex; gap:6px; flex-wrap:wrap;">${
      thumbs || '<span style="font-size:12px; color:var(--grey);">— fără carduri —</span>'
    }</div>`;
    row.querySelectorAll("[data-zoom]").forEach((img) => img.addEventListener("click", () => openLightbox(img.dataset.zoom)));
    box.appendChild(row);
  });
}

function subscribeRealtime() {
  supabase
    .channel(`cb-learner-${sessionCode}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "training_sessions", filter: `id=eq.${session.id}` },
      async (payload) => {
        if (payload.new.status !== "active") {
          $("cb-status-box").innerHTML = `<div class="empty-state">Sesiunea a fost încheiată de trainer.</div>`;
          $("cb-waiting-box").style.display = "none";
          $("cb-game-box").style.display = "none";
          $("cb-final-reveal-box").style.display = "none";
          clearInterval(pollTimer);
          session = { ...session, ...payload.new };
          return;
        }
        const phaseChanged =
          payload.new.cb_started_at !== session.cb_started_at || payload.new.cb_revealed_all_at !== session.cb_revealed_all_at;
        session = { ...session, ...payload.new };
        if (myParticipant && phaseChanged) await render();
      }
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "cb_trainer_cards", filter: `session_id=eq.${session.id}` }, async () => {
      if (myParticipant && session.cb_started_at && !session.cb_revealed_all_at) await renderTrainerReveals();
    })
    .subscribe();
}

init();
