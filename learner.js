import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const groupCode = params.get("g");

let group = null;       // randul din session_groups
let sessionId = null;   // id-ul sesiunii parinte (pentru verificarea statusului)
let sessionInfo = {};   // status + campurile de cronometru ale sesiunii
let cards = [];         // cardurile alocate acestei grupe
let flippableMap = {};  // card_id -> bool, sincronizat de la trainer
let flippedLocal = {};  // card_id -> bool, doar local, la acest user
let backPageLocal = {}; // card_id -> 1 sau 2, doar pentru cardurile exceptionale cu al doilea verso
let lastScrolledHighlight = undefined;
let pollTimer = null; // fallback prin polling, pentru retele care blocheaza WebSocket (Supabase Realtime)
let timerTickInterval = null;

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

// ---------- CRONOMETRU ----------
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

function updateGroupBadge() {
  if (!group) return;
  $("learner-group-bar").style.display = "block";
  $("learner-group-badge").textContent = group.name;
}

async function init() {
  if (!groupCode) {
    $("status-box").innerHTML = `<div class="empty-state">Link invalid. Cere trainerului link-ul grupei tale.</div>`;
    return;
  }

  const { data: groupData, error: groupErr } = await supabase
    .from("session_groups")
    .select("*")
    .eq("group_code", groupCode)
    .maybeSingle();

  if (groupErr || !groupData) {
    $("status-box").innerHTML = `<div class="empty-state">Link invalid sau grupa nu mai există.</div>`;
    return;
  }
  group = groupData;
  sessionId = group.session_id;

  const { data: sessionData } = await supabase
    .from("training_sessions")
    .select("status, timer_total_seconds, timer_remaining_seconds, timer_status, timer_started_at, max_choices, games(name, mode)")
    .eq("id", sessionId)
    .maybeSingle();

  if (!sessionData || sessionData.status !== "active") {
    $("status-box").innerHTML = `<div class="empty-state">Sesiunea nu există sau s-a încheiat. Cere trainerului un link nou.</div>`;
    return;
  }
  sessionInfo = sessionData;
  if (sessionData.games?.name) {
    $("learner-game-title").textContent = sessionData.games.name;
    document.title = sessionData.games.name;
  }

  if (sessionData.games?.mode === "selection") {
    await initSelectionMode();
    return;
  }

  registerPresenceSilently(); // "id ascuns" - nu blocheaza afisarea cardurilor, doar semnaleaza prezenta in admin

  const { data: groupCardRows } = await supabase
    .from("session_group_cards")
    .select("*")
    .eq("group_id", group.id);

  const cardIds = (groupCardRows || []).map((r) => r.card_id);
  (groupCardRows || []).forEach((r) => (flippableMap[r.card_id] = r.is_flippable));

  if (cardIds.length > 0) {
    const { data: cardData } = await supabase
      .from("cards")
      .select("*")
      .in("id", cardIds)
      .order("order_index", { ascending: true });
    cards = cardData || [];
  }

  render();
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

// fallback: unele retele (firewall/proxy de firma) blocheaza conexiunile WebSocket folosite de Realtime.
// Verificam periodic prin cereri HTTP normale, ca sesiunea sa ramana sincronizata oricum.
function startPolling() {
  pollTimer = setInterval(pollUpdates, 4000);
}

async function pollUpdates() {
  if (!group) return;
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

    let changed = false;

    if (JSON.stringify(sessionData) !== JSON.stringify({ ...sessionInfo, games: undefined })) {
      const wasNotStarted = (sessionInfo.timer_status || "not_started") === "not_started";
      sessionInfo = { ...sessionInfo, ...sessionData }; // pastreaza numele jocului deja incarcat
      updateTimerDisplay();
      if (wasNotStarted && sessionInfo.timer_status !== "not_started") changed = true;
    }

    const { data: groupData } = await supabase
      .from("session_groups")
      .select("highlighted_card_id, flip_reset_at")
      .eq("id", group.id)
      .maybeSingle();
    if (groupData && groupData.highlighted_card_id !== group.highlighted_card_id) {
      group.highlighted_card_id = groupData.highlighted_card_id;
      changed = true;
    }
    if (groupData && groupData.flip_reset_at !== group.flip_reset_at) {
      group.flip_reset_at = groupData.flip_reset_at;
      flippedLocal = {};
      backPageLocal = {};
      $("learner-lightbox").style.display = "none";
      changed = true;
    }

    const { data: cardRows } = await supabase.from("session_group_cards").select("card_id, is_flippable").eq("group_id", group.id);
    (cardRows || []).forEach((r) => {
      if (flippableMap[r.card_id] !== r.is_flippable) {
        flippableMap[r.card_id] = r.is_flippable;
        changed = true;
      }
    });

    if (changed) render();
  } catch (err) {
    // eroare temporara de retea - reincercam la urmatorul ciclu, fara sa intrerupem experienta
  }
}

let lastRenderedCardIds = null; // detecteaza daca s-a schimbat efectiv setul de carduri (nu doar starea lor)

function render() {
  const grid = $("learner-grid");
  updateTimerDisplay();
  updateGroupBadge();

  if ((sessionInfo.timer_status || "not_started") === "not_started") {
    grid.innerHTML = `<div class="empty-state">⏳ Sesiunea nu a început încă. Așteaptă ca trainerul să o pornească.</div>`;
    lastRenderedCardIds = null;
    return;
  }

  if (cards.length === 0) {
    grid.innerHTML = `<div class="empty-state">Trainerul nu a alocat încă niciun card pentru grupa ta.</div>`;
    lastRenderedCardIds = null;
    return;
  }

  const currentIds = cards.map((c) => c.id).join(",");
  if (currentIds !== lastRenderedCardIds) {
    buildGrid(); // structura s-a schimbat (carduri adaugate/eliminate din grupa) - reconstruim complet
    lastRenderedCardIds = currentIds;
  } else {
    cards.forEach(updateCardTile); // doar starea s-a schimbat - actualizare chirurgicala, animatiile ruleaza normal
  }

  scrollToHighlighted();
}

function buildGrid() {
  const grid = $("learner-grid");
  grid.innerHTML = "";

  cards.forEach((c) => {
    const wrap = document.createElement("div");
    wrap.className = "flip-card-wrap";
    wrap.dataset.cardId = c.id;

    const zoomBtn = document.createElement("button");
    zoomBtn.className = "zoom-btn";
    zoomBtn.textContent = "🔍";
    zoomBtn.title = "Vezi mărit";
    zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const frontDisplay = c.initial_face === "back" ? c.back_image_url : c.front_image_url;
      const backDisplay = c.initial_face === "back" ? c.front_image_url : c.back_image_url;
      const onBack2 = backPageLocal[c.id] === 2 && c.back_image_url_2;
      const src = flippedLocal[c.id] ? (onBack2 ? c.back_image_url_2 : backDisplay) : frontDisplay;
      const label = flippedLocal[c.id] && c.back_image_url_2 ? `Verso — pagina ${onBack2 ? 2 : 1} din 2` : null;
      openLightbox(src, label);
    });

    const flip = document.createElement("div");
    flip.className = "flip-card";
    flip.style.setProperty("--ar", c.aspect_ratio || 0.75);
    flip.innerHTML = `
      <div class="flip-card-inner">
        <div class="flip-face front" data-hint="Click pentru a întoarce"><img src="${c.initial_face === "back" ? c.back_image_url : c.front_image_url}" /></div>
        <div class="flip-face back" data-hint="${c.back_image_url_2 ? "Click pentru pagina 2/2" : "Click pentru a reveni"}"><img src="${c.initial_face === "back" ? c.front_image_url : c.back_image_url}" /></div>
      </div>
    `;
    // handler-ul e mereu atasat; verifica starea LIVE la fiecare click, nu una capturata la creare
    // (necesar acum ca flip-ul poate fi activat/dezactivat fara sa se recreeze elementul)
    flip.addEventListener("click", () => {
      if (!flippableMap[c.id]) return;
      const hasSecondBack = !!c.back_image_url_2;
      if (!flippedLocal[c.id]) {
        flippedLocal[c.id] = true;
        backPageLocal[c.id] = 1;
      } else if (hasSecondBack && (backPageLocal[c.id] || 1) === 1) {
        backPageLocal[c.id] = 2; // ramane intors, doar schimba continutul versoului - fara animatie 3D suplimentara
      } else {
        flippedLocal[c.id] = false;
        backPageLocal[c.id] = 1;
      }
      flip.classList.toggle("flipped", flippedLocal[c.id]);
      const backImg = flip.querySelector(".flip-face.back img");
      backImg.src = backPageLocal[c.id] === 2 ? c.back_image_url_2 : (c.initial_face === "back" ? c.front_image_url : c.back_image_url);
      if (hasSecondBack) {
        flip.querySelector(".flip-face.back").dataset.hint =
          backPageLocal[c.id] === 2 ? "Click pentru a reveni · pagina 2/2" : "Click pentru pagina 2/2";
      }
      updateExplanation(wrap, c, flippedLocal[c.id]);
    });

    wrap.appendChild(zoomBtn);
    wrap.appendChild(flip);
    grid.appendChild(wrap);

    updateCardTile(c); // seteaza starea initiala corecta (highlight, can-flip, flipped, explicatie)
  });
}

function updateCardTile(c) {
  const wrap = document.querySelector(`.flip-card-wrap[data-card-id="${c.id}"]`);
  if (!wrap) return;
  const flip = wrap.querySelector(".flip-card");
  const isHighlighted = group.highlighted_card_id === c.id;
  const canFlip = !!flippableMap[c.id];
  const isFlipped = !!flippedLocal[c.id];

  flip.classList.toggle("is-highlighted", isHighlighted);
  flip.classList.toggle("can-flip", canFlip);
  flip.classList.toggle("flipped", isFlipped); // doar comuta clasa pe elementul existent - animatia CSS ruleaza normal

  const backImg = flip.querySelector(".flip-face.back img");
  if (backImg) {
    backImg.src =
      backPageLocal[c.id] === 2 && c.back_image_url_2
        ? c.back_image_url_2
        : c.initial_face === "back" ? c.front_image_url : c.back_image_url;
  }

  updateExplanation(wrap, c, isFlipped);
}

function updateExplanation(wrap, c, isFlipped) {
  let expEl = wrap.querySelector(".card-explanation");
  if (isFlipped && c.explanation) {
    if (!expEl) {
      expEl = document.createElement("div");
      expEl.className = "card-explanation";
      expEl.style.cssText = "font-size:12px; color:var(--grey); margin-top:6px; text-align:center;";
      wrap.appendChild(expEl);
    }
    expEl.textContent = c.explanation;
  } else if (expEl) {
    expEl.remove();
  }
}

function scrollToHighlighted() {
  if (!group || !group.highlighted_card_id) return;
  if (group.highlighted_card_id === lastScrolledHighlight) return;
  lastScrolledHighlight = group.highlighted_card_id;
  $("learner-lightbox").style.display = "none";
  const el = document.querySelector(`[data-card-id="${group.highlighted_card_id}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

function openLightbox(src, pageLabel) {
  const img = $("learner-lightbox-img");
  img.src = src;
  img.classList.remove("super-zoom"); // porneste mereu de la "incape pe ecran", nu ramas marit de la deschiderea anterioara
  const label = $("lightbox-page-label");
  if (pageLabel) {
    label.textContent = pageLabel;
    label.style.display = "block";
  } else {
    label.style.display = "none";
  }
  $("learner-lightbox").scrollTo(0, 0);
  $("learner-lightbox").style.display = "flex";
}
$("learner-lightbox").addEventListener("click", () => ($("learner-lightbox").style.display = "none"));
$("learner-lightbox-img").addEventListener("click", (e) => {
  e.stopPropagation(); // nu inchide lightbox-ul - doar comuta intre "incape pe ecran" si marit
  e.target.classList.toggle("super-zoom");
});

function showSessionEnded() {
  if (pollTimer) clearInterval(pollTimer);
  if (timerTickInterval) clearInterval(timerTickInterval);
  supabase.removeAllChannels();
  $("learner-grid").innerHTML = "";
  $("learner-lightbox").style.display = "none";
  $("session-timer-bar").style.display = "none";
  $("learner-group-bar").style.display = "none";
  $("expired-overlay").style.display = "none";
  $("selection-choosing-section").style.display = "none";
  $("selection-result-section").style.display = "none";
  $("status-box").innerHTML = `<div class="empty-state">Sesiunea nu există sau s-a încheiat. Cere trainerului un link nou.</div>`;
}

function subscribeRealtime() {
  supabase
    .channel(`group-${group.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "training_sessions", filter: `id=eq.${sessionId}` },
      (payload) => {
        if (payload.new.status !== "active") {
          showSessionEnded();
          return;
        }
        const wasNotStarted = (sessionInfo.timer_status || "not_started") === "not_started";
        sessionInfo = { ...sessionInfo, ...payload.new }; // pastreaza numele jocului deja incarcat (realtime nu include join-uri)
        if (wasNotStarted && sessionInfo.timer_status !== "not_started") render();
        else updateTimerDisplay();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "session_groups", filter: `id=eq.${group.id}` },
      (payload) => {
        const flipWasReset = payload.new.flip_reset_at !== group.flip_reset_at;
        group = { ...group, ...payload.new };
        if (flipWasReset) {
          flippedLocal = {};
          backPageLocal = {};
          $("learner-lightbox").style.display = "none";
        }
        render();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "session_group_cards", filter: `group_id=eq.${group.id}` },
      (payload) => {
        flippableMap[payload.new.card_id] = payload.new.is_flippable;
        render();
      }
    )
    .subscribe();
}

// ---------- SELECTION (Hardiness): cursantul isi alege cardurile ----------
let selectionParticipant = null;
let selectionMaxChoices = 1;
let selectionLocalPicks = new Set();

async function initSelectionMode() {
  selectionMaxChoices = sessionInfo.max_choices || 1;

  const { data: groupCardRows } = await supabase.from("session_group_cards").select("card_id, is_flippable").eq("group_id", group.id);
  const cardIds = (groupCardRows || []).map((r) => r.card_id);
  (groupCardRows || []).forEach((r) => (flippableMap[r.card_id] = r.is_flippable));
  if (cardIds.length > 0) {
    const { data: cardData } = await supabase.from("cards").select("*").in("id", cardIds).order("order_index", { ascending: true });
    cards = cardData || [];
  }

  const storageKey = `participant_${group.id}`;
  const savedId = localStorage.getItem(storageKey);
  if (savedId) {
    const { data } = await supabase.from("session_participants").select("*").eq("id", savedId).maybeSingle();
    if (data) selectionParticipant = data;
  }

  if (!selectionParticipant) {
    // inregistrare silentioasa, fara sa cerem nimic cursantului - doar un id anonim,
    // salvat local, ca sa stim ca reveni pe acelasi link nu conteaza de doua ori
    const code = Math.random().toString(36).slice(2, 10);
    const { data, error } = await supabase
      .from("session_participants")
      .insert({ session_id: sessionId, group_id: group.id, name: "Cursant", participant_code: code })
      .select()
      .single();
    if (!error && data) {
      selectionParticipant = data;
      localStorage.setItem(storageKey, data.id);
    }
  }

  if (selectionParticipant) await refreshSelectionView();

  subscribeSelectionRealtime();
  timerTickInterval = setInterval(updateTimerDisplay, 1000);
}

function renderSelectionChoiceGrid() {
  const grid = $("selection-choice-grid");
  grid.innerHTML = "";
  $("selection-max-label").textContent = selectionMaxChoices;
  cards.forEach((c) => {
    const checked = selectionLocalPicks.has(c.id);
    const canFlip = !!flippableMap[c.id];
    const isFlipped = !!flippedLocal[c.id];
    const tile = document.createElement("div");
    tile.className = "card-tile" + (checked ? " selected" : "");
    tile.innerHTML = `
      <label class="pick-row">
        <input type="checkbox" data-pick="${c.id}" ${checked ? "checked" : ""} />
        <span>${checked ? "✓ Selectat" : "Selectează"}</span>
      </label>
      <div class="mini-flip${isFlipped ? " flipped" : ""}" style="aspect-ratio:${c.aspect_ratio || 0.75}; ${canFlip ? "cursor:pointer;" : ""}" data-flip>
        <div class="mini-flip-inner">
          <img class="mini-flip-face" src="${c.front_image_url}" alt="${escapeHtml(c.title)}" />
          <img class="mini-flip-face back" src="${c.back_image_url}" alt="${escapeHtml(c.title)}" />
        </div>
        ${canFlip ? `<div class="mini-flip-hint front-hint">Click pentru a întoarce</div><div class="mini-flip-hint back-hint">${c.back_image_url_2 ? "Click pentru pagina 2/2" : "Click pentru a reveni"}</div>` : ""}
        <button class="zoom-btn" data-zoom title="Vezi mărit">🔍</button>
      </div>
      <div class="tile-label">${escapeHtml(c.title)}</div>
    `;
    tile.querySelector(".mini-flip").style.position = "relative";
    tile.querySelector("[data-zoom]").addEventListener("click", (e) => {
      e.stopPropagation();
      const showingBack2 = backPageLocal[c.id] === 2 && c.back_image_url_2;
      const src = flippedLocal[c.id] ? (showingBack2 ? c.back_image_url_2 : c.back_image_url) : c.front_image_url;
      const label = flippedLocal[c.id] && c.back_image_url_2 ? `Verso — pagina ${showingBack2 ? 2 : 1} din 2` : null;
      openLightbox(src, label);
    });
    if (canFlip) {
      tile.querySelector("[data-flip]").addEventListener("click", () => {
        const hasSecondBack = !!c.back_image_url_2;
        if (!flippedLocal[c.id]) {
          flippedLocal[c.id] = true;
          backPageLocal[c.id] = 1;
        } else if (hasSecondBack && (backPageLocal[c.id] || 1) === 1) {
          backPageLocal[c.id] = 2;
        } else {
          flippedLocal[c.id] = false;
          backPageLocal[c.id] = 1;
        }
        const flipEl = tile.querySelector("[data-flip]");
        flipEl.classList.toggle("flipped", flippedLocal[c.id]);
        flipEl.querySelector(".mini-flip-face.back").src = backPageLocal[c.id] === 2 ? c.back_image_url_2 : c.back_image_url;
        if (hasSecondBack) {
          flipEl.querySelector(".back-hint").textContent =
            backPageLocal[c.id] === 2 ? "Click pentru a reveni · pagina 2/2" : "Click pentru pagina 2/2";
        }
      });
    }
    tile.querySelector("[data-pick]").addEventListener("change", (e) => {
      if (e.target.checked) {
        if (selectionLocalPicks.size >= selectionMaxChoices) {
          e.target.checked = false;
          alert(`Poți alege maximum ${selectionMaxChoices} card(uri).`);
          return;
        }
        selectionLocalPicks.add(c.id);
      } else {
        selectionLocalPicks.delete(c.id);
      }
      tile.classList.toggle("selected", e.target.checked);
      tile.querySelector(".pick-row span").textContent = e.target.checked ? "✓ Selectat" : "Selectează";
      $("selection-submit-btn").disabled = selectionLocalPicks.size === 0;
    });
    grid.appendChild(tile);
  });
  $("selection-submit-btn").disabled = selectionLocalPicks.size === 0;
}

$("selection-submit-btn").addEventListener("click", async () => {
  if (selectionLocalPicks.size === 0) return;
  const btn = $("selection-submit-btn");
  btn.disabled = true;
  btn.textContent = "Se trimite...";
  try {
    const rows = Array.from(selectionLocalPicks).map((cardId) => ({
      session_id: sessionId,
      participant_id: selectionParticipant.id,
      card_id: cardId,
    }));
    const { error: e1 } = await supabase.from("session_participant_cards").insert(rows);
    if (e1) throw e1;
    const submittedAt = new Date().toISOString();
    const { error: e2 } = await supabase.from("session_participants").update({ submitted_at: submittedAt }).eq("id", selectionParticipant.id);
    if (e2) throw e2;
    selectionParticipant.submitted_at = submittedAt;
    await refreshSelectionView();
  } catch (err) {
    alert("Eroare: " + err.message);
    btn.disabled = false;
    btn.textContent = "Am ales";
  }
});

function renderStaticResultCards(cardList) {
  const grid = $("selection-result-grid");
  grid.innerHTML = "";
  cardList.forEach((c) => {
    const canFlip = !!flippableMap[c.id];
    const isFlipped = !!flippedLocal[c.id];
    const wrap = document.createElement("div");
    wrap.className = "flip-card-wrap";

    const flip = document.createElement("div");
    flip.className = "flip-card" + (canFlip ? " can-flip" : "") + (isFlipped ? " flipped" : "");
    flip.style.setProperty("--ar", c.aspect_ratio || 0.75);
    flip.innerHTML = `
      <div class="flip-card-inner">
        <div class="flip-face front" data-hint="Click pentru a întoarce"><img src="${c.front_image_url}" alt="${escapeHtml(c.title)}" /></div>
        <div class="flip-face back" data-hint="${c.back_image_url_2 ? "Click pentru pagina 2/2" : "Click pentru a reveni"}"><img src="${c.back_image_url}" alt="${escapeHtml(c.title)}" /></div>
      </div>
    `;
    if (canFlip) {
      flip.addEventListener("click", () => {
        const hasSecondBack = !!c.back_image_url_2;
        if (!flippedLocal[c.id]) {
          flippedLocal[c.id] = true;
          backPageLocal[c.id] = 1;
        } else if (hasSecondBack && (backPageLocal[c.id] || 1) === 1) {
          backPageLocal[c.id] = 2;
        } else {
          flippedLocal[c.id] = false;
          backPageLocal[c.id] = 1;
        }
        flip.classList.toggle("flipped", flippedLocal[c.id]);
        flip.querySelector(".flip-face.back img").src = backPageLocal[c.id] === 2 ? c.back_image_url_2 : c.back_image_url;
        if (hasSecondBack) {
          flip.querySelector(".flip-face.back").dataset.hint =
            backPageLocal[c.id] === 2 ? "Click pentru a reveni · pagina 2/2" : "Click pentru pagina 2/2";
        }
      });
    }

    const zoomBtn = document.createElement("button");
    zoomBtn.className = "zoom-btn";
    zoomBtn.textContent = "🔍";
    zoomBtn.title = "Vezi mărit";
    zoomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const showingBack2 = backPageLocal[c.id] === 2 && c.back_image_url_2;
      const src = flippedLocal[c.id] ? (showingBack2 ? c.back_image_url_2 : c.back_image_url) : c.front_image_url;
      const label = flippedLocal[c.id] && c.back_image_url_2 ? `Verso — pagina ${showingBack2 ? 2 : 1} din 2` : null;
      openLightbox(src, label);
    });

    wrap.appendChild(zoomBtn);
    wrap.appendChild(flip);
    grid.appendChild(wrap);
  });
}

async function refreshSelectionView() {
  updateGroupBadge();

  if (!selectionParticipant.submitted_at) {
    $("selection-choosing-section").style.display = "block";
    $("selection-result-section").style.display = "none";
    renderSelectionChoiceGrid();
    return;
  }

  const { data: parts } = await supabase.from("session_participants").select("id, submitted_at").eq("group_id", group.id);
  const expected = group.expected_participants || 0;
  const submittedCount = (parts || []).filter((p) => p.submitted_at).length;
  const groupComplete = expected > 0 && submittedCount >= expected;

  $("selection-choosing-section").style.display = "none";
  $("selection-result-section").style.display = "block";

  let cardIdsToShow;
  if (groupComplete) {
    const { data: allChoices } = await supabase
      .from("session_participant_cards")
      .select("card_id")
      .in("participant_id", (parts || []).map((p) => p.id));
    cardIdsToShow = [...new Set((allChoices || []).map((r) => r.card_id))];
    $("selection-result-hint").textContent = "Toată grupa a ales. Cardurile alese de echipa ta:";
  } else {
    const { data: own } = await supabase.from("session_participant_cards").select("card_id").eq("participant_id", selectionParticipant.id);
    cardIdsToShow = (own || []).map((r) => r.card_id);
    $("selection-result-hint").textContent = `Ai ales cardul/cardurile tale. Se așteaptă restul grupei (${submittedCount}/${expected})...`;
  }

  const { data: cardData } = await supabase
    .from("cards")
    .select("*")
    .in("id", cardIdsToShow.length ? cardIdsToShow : ["00000000-0000-0000-0000-000000000000"])
    .order("order_index", { ascending: true });
  renderStaticResultCards(cardData || []);
}

function subscribeSelectionRealtime() {
  supabase
    .channel(`selection-${group.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "training_sessions", filter: `id=eq.${sessionId}` }, (payload) => {
      if (payload.new.status !== "active") {
        showSessionEnded();
        return;
      }
      sessionInfo = { ...sessionInfo, ...payload.new };
      updateTimerDisplay();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "session_participants", filter: `group_id=eq.${group.id}` }, () => {
      if (selectionParticipant?.submitted_at) refreshSelectionView();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "session_group_cards", filter: `group_id=eq.${group.id}` }, async () => {
      // reincarca tot deck-ul grupei - nu doar starea de flip - ca sa prinda si cardurile
      // adaugate/eliminate manual de trainer in timpul sesiunii, nu doar activarea flip-ului
      const { data: groupCardRows } = await supabase.from("session_group_cards").select("card_id, is_flippable").eq("group_id", group.id);
      const cardIds = (groupCardRows || []).map((r) => r.card_id);
      (groupCardRows || []).forEach((r) => (flippableMap[r.card_id] = r.is_flippable));
      if (cardIds.length > 0) {
        const { data: cardData } = await supabase.from("cards").select("*").in("id", cardIds).order("order_index", { ascending: true });
        cards = cardData || [];
      } else {
        cards = [];
      }
      if (selectionParticipant?.submitted_at) refreshSelectionView();
      else renderSelectionChoiceGrid();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "session_groups", filter: `id=eq.${group.id}` }, (payload) => {
      if (payload.new.flip_reset_at && payload.new.flip_reset_at !== group.flip_reset_at) {
        group.flip_reset_at = payload.new.flip_reset_at;
        flippedLocal = {}; // toate cardurile intorse revin cu fata la urmatoarea randare
        backPageLocal = {};
        $("learner-lightbox").style.display = "none";
        if (selectionParticipant?.submitted_at) refreshSelectionView();
        else renderSelectionChoiceGrid();
      }
    })
    .subscribe();

  pollTimer = setInterval(async () => {
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
      sessionInfo = { ...sessionInfo, ...sessionData };
      updateTimerDisplay();

      const { data: groupData } = await supabase.from("session_groups").select("flip_reset_at").eq("id", group.id).maybeSingle();
      if (groupData?.flip_reset_at && groupData.flip_reset_at !== group.flip_reset_at) {
        group.flip_reset_at = groupData.flip_reset_at;
        flippedLocal = {};
        backPageLocal = {};
        $("learner-lightbox").style.display = "none";
      }

      const { data: gcRows } = await supabase.from("session_group_cards").select("card_id, is_flippable").eq("group_id", group.id);
      const gcCardIds = (gcRows || []).map((r) => r.card_id);
      (gcRows || []).forEach((r) => (flippableMap[r.card_id] = r.is_flippable));
      // reincarca tot deck-ul doar daca setul de carduri chiar s-a schimbat (adaugat/eliminat de trainer)
      const currentIds = cards.map((c) => c.id).sort().join(",");
      const newIds = [...gcCardIds].sort().join(",");
      if (currentIds !== newIds) {
        if (gcCardIds.length > 0) {
          const { data: cardData } = await supabase.from("cards").select("*").in("id", gcCardIds).order("order_index", { ascending: true });
          cards = cardData || [];
        } else {
          cards = [];
        }
      }

      if (selectionParticipant?.submitted_at) await refreshSelectionView();
      else renderSelectionChoiceGrid();
    } catch (err) {
      // eroare temporara de retea - reincercam la urmatorul ciclu
    }
  }, 4000);
}

// ---------- PREZENTA (mod Standard): id ascuns, o singura data per grupa/browser ----------
async function registerPresenceSilently() {
  const storageKey = `presence_${group.id}`;
  if (localStorage.getItem(storageKey)) return; // deja inregistrat din vizite anterioare
  try {
    const code = Math.random().toString(36).slice(2, 10);
    const { data, error } = await supabase
      .from("session_participants")
      .insert({ session_id: sessionId, group_id: group.id, name: "Cursant", participant_code: code })
      .select()
      .single();
    if (!error && data) localStorage.setItem(storageKey, data.id);
  } catch (err) {
    // nu blocam experienta cursantului daca prezenta nu poate fi inregistrata
  }
}

init();
