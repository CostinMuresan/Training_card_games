// Pagina publică cu jocurile de gândire critică: arată ce se poate juca acum.
import { supabase, $, friendly } from "./puzzle-shared.js";

function closed(el, text) {
  el.classList.add("off");
  el.removeAttribute("href");
  el.setAttribute("aria-disabled", "true");
  el.querySelector(".pz-open")?.remove();
  const s = document.createElement("span");
  s.className = "pz-soon";
  s.textContent = text;
  el.append(s);
}

(async function init() {
  const { data, error } = await supabase.rpc("pz_catalog");
  $("loading").hidden = true;
  if (error || !data) {
    $("err").textContent = friendly(error, "Nu am putut încărca jocurile. Încearcă din nou peste câteva momente.");
    return;
  }
  $("games").hidden = false;
  if (!data.connections_ready) closed($("g-connections"), "Încă nu există destule categorii pentru acest joc.");
  if (!(data.scenarios || []).length) closed($("g-decision"), "Încă nu există scenarii disponibile.");
})();
