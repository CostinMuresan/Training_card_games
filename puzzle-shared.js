// Cod comun pentru paginile de puzzle: clientul Supabase, memoria locală a partidei în curs, mici ajutoare.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // jucătorii nu au cont: nu păstrăm și nu reîmprospătăm nicio sesiune de autentificare pe paginile lor
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
export const $ = (id) => document.getElementById(id);

// Browserul reține doar identificatorul partidei în curs, ca o reîncărcare a paginii să nu piardă progresul.
// Funcționează și fără memorie locală (fereastră privată, date blocate): atunci partida pornește de la zero.
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* fără memorie locală: se joacă mai departe */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* idem */
    }
  },
};

export const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

// mesaj prietenos pentru o eroare a bazei de date (fără detalii tehnice)
export function friendly(error, fallback) {
  const m = String(error?.message || "");
  if (/pz_|schema cache|Could not find the function|does not exist/i.test(m)) {
    return "Jocurile de gândire critică nu sunt încă pornite pe acest server. Cere trainerului să ruleze scriptul add-puzzles.sql.";
  }
  // mesajele scrise chiar de funcțiile din baza de date sunt în română și pot fi afișate
  if (m && /[ăâîșțĂÂÎȘȚ]|Prea multe|Trebuie|Scenariul|Partida|Opțiunea/.test(m)) return m;
  return fallback;
}

export const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const TIERS = ["yellow", "green", "blue", "purple"];
export const TIER_NAMES = { yellow: "Galben", green: "Verde", blue: "Albastru", purple: "Mov" };
export const TRAIT_NAMES = { exploration: "Exploratorul", execution: "Executorul", analysis: "Analistul", diplomacy: "Diplomatul", investigation: "Investigatorul" };

export const FUNCTIONS_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1`;
export { SUPABASE_ANON_KEY };
