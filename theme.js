/* Tema de culori a aplicației (v61).
 * O temă = 4 culori de bază: fundal, suprafață (carduri), culoare principală (antet, butoane), accent.
 * Restul (culoarea textului, a marginilor, a textului de pe butoane etc.) se calculează automat:
 * pe fundal închis, text deschis; pe fundal deschis, text închis; contrastul de citire e garantat (minimum 4,5:1).
 * Script clasic (nu modul), încărcat în <head> pe toate paginile, ca tema să se aplice înainte de primul desen pe ecran.
 */
(function () {
  "use strict";

  var LS_KEY = "tc_theme_v1";
  var SAVED_KEY = "tc_theme_saved_v1";
  var HEX = /^#[0-9a-f]{6}$/i;

  var PRESETS = [
    { id: "pergament", name: "Pergament", bg: "#F2EDE0", surface: "#FFFCF4", primary: "#2F4B3C", accent: "#C9992E",
      // tema actuală: păstrează exact aspectul de până acum pentru margini și antet
      overrides: { greenDeep: "#213A2E", line: "#E7DFC9", goldSoft: "#E4C878", hiddenBg: "#F8D7D3", hiddenFg: "#A61B12", hiddenLine: "#C0392B" } },
    { id: "noapte", name: "Noapte", bg: "#12171A", surface: "#1C2327", primary: "#2F8F7A", accent: "#E3B341" },
    { id: "grafit", name: "Grafit", bg: "#1E1F24", surface: "#2A2C33", primary: "#6B7BE0", accent: "#F0B429" },
    { id: "albastru", name: "Albastru corporate", bg: "#EAF0F7", surface: "#FFFFFF", primary: "#1D4E89", accent: "#F2A900" },
    { id: "bordo", name: "Bordo", bg: "#F7F0F0", surface: "#FFFFFF", primary: "#7B1E3A", accent: "#D99A2B" },
    { id: "contrast", name: "Contrast înalt", bg: "#FFFFFF", surface: "#FFFFFF", primary: "#000000", accent: "#FFD400" },
  ];

  // ---------- culori ----------
  function toRgb(h) {
    h = String(h).replace("#", "");
    if (h.length === 3) h = h.replace(/(.)/g, "$1$1");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function toHex(rgb) {
    return "#" + rgb.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }).join("").toUpperCase();
  }
  function lum(h) {
    var c = toRgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    var la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function mix(a, b, t) { // a spre b, cu proporția t (0–1)
    var x = toRgb(a), y = toRgb(b);
    return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  // alege textul deschis sau închis, după care are contrast mai bun; dacă niciunul nu atinge 4,5:1, alb sau negru pur
  function pickText(bg, light, dark) {
    var best = contrast(bg, light) >= contrast(bg, dark) ? light : dark;
    if (contrast(bg, best) >= 4.5) return best;
    return contrast(bg, "#FFFFFF") >= contrast(bg, "#000000") ? "#FFFFFF" : "#000000";
  }
  // apropie culoarea fg de `toward` până atinge contrastul cerut față de toate fundalurile din listă
  function ensure(fg, bgs, min, toward) {
    var ok = function (c) { return bgs.every(function (b) { return contrast(c, b) >= min; }); };
    var c = fg;
    for (var i = 0; i < 40 && !ok(c); i++) c = mix(c, toward, 0.07);
    if (!ok(c)) c = toward;
    return c;
  }

  // ---------- derivarea variabilelor CSS ----------
  function deriveVars(t) {
    var bg = t.bg, primary = t.primary, accent = t.accent, ov = t.overrides || {};
    // Textul se alege după fundal. Suprafața (carduri) trebuie să se citească cu același text: dacă e prea departe
    // (de ex. fundal închis + carduri foarte deschise), se apropie automat de fundal, până devine lizibilă.
    var ink = pickText(bg, "#F4F1EA", "#2B2A28");
    var surface = t.surface;
    for (var i = 0; i < 14 && contrast(ink, surface) < 4.5; i++) surface = mix(surface, bg, 0.15);
    if (contrast(ink, surface) < 4.5) surface = bg;
    var bgs = [bg, surface];
    var dark = lum(ink) > 0.4; // textul e deschis => tema e închisă
    // un fundal derivat (câmpuri, „selectat”, eroare) rămâne lizibil cu textul: se apropie de suprafață până trece de 4,5:1
    var readable = function (c) {
      for (var k = 0; k < 12 && contrast(ink, c) < 4.5; k++) c = mix(c, surface, 0.3);
      return contrast(ink, c) < 4.5 ? surface : c;
    };
    // fundalul câmpurilor / cardurilor interioare: și pe el textul trebuie să se citească
    var fieldBg = readable(dark ? mix(surface, "#FFFFFF", 0.07) : lum(surface) > 0.9 ? "#FFFFFF" : mix(surface, "#FFFFFF", 0.6));
    bgs.push(fieldBg);
    var onPrimary = pickText(primary, "#FFFCF4", "#1E1D1B");
    var greenDeep = ov.greenDeep || mix(primary, "#000000", 0.3);
    var onHeader = pickText(greenDeep, "#FFFCF4", "#1E1D1B");
    var onAccent = pickText(accent, "#FFFCF4", "#1E1D1B");
    var red = ensure(dark ? "#F0968A" : "#8B3A2E", bgs, 4.5, ink);
    var okAll = function (c, list) { return list.every(function (b) { return contrast(c, b) >= 4.5; }); };
    // întrebările ascunse (Recapitulare): fundal roșiatic + text roșu, lizibile pe orice temă
    var hBg = ov.hiddenBg || mix(surface, dark ? "#E0584A" : "#E57368", dark ? 0.32 : 0.28);
    var hFg = ov.hiddenFg || ensure(dark ? "#FFB3A8" : "#8E1A10", [hBg, surface, bg, fieldBg], 4.5, ink);
    if (!okAll(hFg, [hBg, surface, bg, fieldBg])) { hBg = surface; hFg = ensure(dark ? "#FFB3A8" : "#8E1A10", [surface, bg, fieldBg], 4.5, ink); }
    // culorile echipelor, pentru text pe fundalul paginii / al cardurilor
    var teamList = [bg, surface, fieldBg];
    var team1 = ensure(dark ? "#F08F82" : "#C0392B", teamList, 4.5, ink);
    var team2 = ensure(dark ? "#8FB7EF" : "#1F5FA8", teamList, 4.5, ink);
    var vars = {
      "--parchment": bg,
      "--card-bg": surface,
      "--field-bg": fieldBg,
      "--ink": ink,
      "--ink-soft": ensure(mix(ink, bg, 0.25), bgs, 4.5, ink),
      "--grey": ensure(ov.grey || mix(ink, bg, 0.42), bgs, 4.5, ink),
      "--parchment-dark": ov.line || readable(mix(bg, ink, 0.13)), // margini, fundal de „cod”: textul se citește și pe ele
      "--green": primary,
      "--green-deep": greenDeep,
      "--green-text": ensure(primary, bgs, 4.5, ink),
      "--on-primary": onPrimary,
      "--on-header": onHeader,
      "--gold": accent,
      "--gold-soft": ov.goldSoft || ensure(mix(accent, onHeader, 0.5), [greenDeep], 4.5, onHeader),
      "--accent-text": ensure(accent, bgs, 4.5, ink),
      "--on-accent": onAccent,
      "--red": red,
      "--on-red": pickText(red, "#FFFCF4", "#1E1D1B"),
      // fundal pentru elemente „selectate” (carduri bifate etc.) și pentru mesaje de eroare
      "--select-bg": readable(mix(surface, primary, dark ? 0.32 : 0.12)),
      "--danger-bg": readable(mix(surface, red, dark ? 0.18 : 0.1)),
      "--accent-soft": readable(mix(surface, accent, dark ? 0.3 : 0.38)),
      "--hidden-bg": hBg,
      "--hidden-fg": hFg,
      "--hidden-line": ov.hiddenLine || red,
      "--team1-text": team1,
      "--team2-text": team2,
    };
    vars["color-scheme"] = dark ? "dark" : "light";
    vars._surfaceAdjusted = surface.toUpperCase() !== String(t.surface).toUpperCase();
    return vars;
  }

  // ---------- teme: rezolvare, aplicare ----------
  function preset(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return PRESETS[0]; }
  function validColors(c) { return c && HEX.test(c.bg) && HEX.test(c.surface) && HEX.test(c.primary) && HEX.test(c.accent); }
  // json salvat: { active: "<id presetat>" | "custom", custom: { bg, surface, primary, accent } }
  function resolve(saved) {
    if (saved && saved.active === "custom" && validColors(saved.custom)) {
      return { id: "custom", name: "Personalizată", bg: saved.custom.bg, surface: saved.custom.surface, primary: saved.custom.primary, accent: saved.custom.accent };
    }
    return preset(saved && saved.active);
  }
  var current = null;
  function apply(resolved) {
    current = resolved;
    if (typeof document === "undefined") return deriveVars(resolved);
    var vars = deriveVars(resolved), root = document.documentElement;
    Object.keys(vars).forEach(function (k) {
      if (k === "color-scheme") root.style.colorScheme = vars[k];
      else if (k.indexOf("--") === 0) root.style.setProperty(k, vars[k]);
    });
    root.setAttribute("data-theme", resolved.id || "custom");
    root.setAttribute("data-theme-dark", vars["color-scheme"] === "dark" ? "1" : "0");
    return vars;
  }
  function cache(saved) { try { localStorage.setItem(LS_KEY, JSON.stringify(saved)); } catch (e) {} }
  function cached() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { return null; } }
  // Ecranul de autentificare și orice cont fără temă salvată folosesc tema implicită (Pergament), nu tema altcuiva rămasă în browser
  function useDefault() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    apply(preset("pergament"));
  }
  // Există o autentificare Supabase în acest browser? (cheia standard sb-<proiect>-auth-token)
  function hasLogin() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.+-auth-token$/.test(k) && localStorage.getItem(k)) return true;
      }
    } catch (e) {}
    return false;
  }

  // ---------- Supabase ----------
  var savedTheme = null; // ultima temă salvată (pentru „Anulează”)
  function loadTrainer(supabase, email) {
    return supabase.from("trainer_settings").select("theme").eq("email", String(email).toLowerCase()).maybeSingle().then(function (r) {
      return r && r.data ? r.data.theme : null;
    });
  }
  function saveTrainer(supabase, email, saved) {
    return supabase.from("trainer_settings").upsert({ email: String(email).toLowerCase(), theme: saved, updated_at: new Date().toISOString() }, { onConflict: "email" });
  }
  // pagini de trainer: tema proprie, salvată în cont
  function initTrainer(supabase, email) {
    var btn = document.getElementById("theme-btn");
    if (btn) {
      btn.hidden = false;
      btn.onclick = function () { openPicker({ supabase: supabase, email: email }); };
    }
    return loadTrainer(supabase, email).then(function (saved) {
      savedTheme = saved;
      if (saved) { apply(resolve(saved)); cache(saved); }
      else useDefault(); // cont fără temă salvată: tema implicită, nu cea rămasă în browser de la alt trainer
      return saved;
    }).catch(function () { /* fără tabel (scriptul SQL încă nerulat): rămâne tema din cache / implicită */ });
  }
  // pagini de participant: tema trainerului care a pornit sesiunea (kind: "cards" | "comm" | "recap")
  function initParticipant(supabase, kind, sessionId) {
    return supabase.rpc("session_theme", { p_kind: kind, p_session: sessionId }).then(function (r) {
      if (r && r.data) apply(resolve(r.data));
    }).catch(function () {});
  }

  // ---------- fereastra de alegere a temei ----------
  var STYLE_ID = "tc-theme-style";
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = [
      ".tc-modal{position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;background:rgba(10,12,12,.62);overflow:auto}",
      ".tc-card{width:min(760px,100%);background:var(--card-bg);color:var(--ink);border:1px solid var(--parchment-dark);border-radius:16px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:'Inter',sans-serif}",
      ".tc-card h2{margin:0 0 6px;font-family:'Fraunces',serif;font-size:24px}",
      ".tc-card p{margin:0 0 14px;font-size:14px;line-height:1.5;color:var(--ink-soft)}",
      ".tc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:16px}",
      ".tc-opt{display:flex;flex-direction:column;gap:8px;text-align:left;padding:10px 12px;border:2px solid var(--parchment-dark);border-radius:12px;background:var(--parchment);color:var(--ink);font:inherit;cursor:pointer}",
      ".tc-opt:hover{border-color:var(--green-text)}",
      ".tc-opt[aria-pressed=true]{border-color:var(--green-text);box-shadow:0 0 0 2px var(--green-text)}",
      ".tc-opt b{font-size:14px}",
      ".tc-sw{display:flex;height:22px;border-radius:6px;overflow:hidden;border:1px solid rgba(128,128,128,.5)}",
      ".tc-sw i{flex:1}",
      ".tc-custom{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:14px;border:1px solid var(--parchment-dark);border-radius:12px;background:var(--parchment);margin-bottom:14px}",
      ".tc-custom label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:var(--ink)}",
      ".tc-custom input[type=color]{width:100%;height:42px;padding:2px;border:1px solid var(--parchment-dark);border-radius:8px;background:var(--field-bg);cursor:pointer}",
      ".tc-info{font-size:13px;color:var(--ink-soft);margin:0 0 14px}",
      ".tc-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
      ".tc-msg{font-size:13px;color:var(--green-text);font-weight:600}",
    ].join("");
    document.head.appendChild(st);
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k === "style") e.setAttribute("style", attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function ratio(n) { return (Math.round(n * 10) / 10).toString().replace(".", ",") + ":1"; }

  function openPicker(opts) {
    if (document.getElementById("tc-modal")) return;
    injectStyle();
    var startSaved = savedTheme || cached();      // la „Anulează” se revine aici
    var startResolved = current || resolve(startSaved);
    var state = { active: startResolved.id === "custom" ? "custom" : startResolved.id, custom: { bg: startResolved.bg, surface: startResolved.surface, primary: startResolved.primary, accent: startResolved.accent } };
    if (startSaved && startSaved.custom && validColors(startSaved.custom)) state.custom = startSaved.custom;

    var modal = el("div", { class: "tc-modal", id: "tc-modal", role: "dialog", "aria-modal": "true", "aria-label": "Tema de culori" });
    var card = el("div", { class: "tc-card" });
    var grid = el("div", { class: "tc-grid" });
    var info = el("p", { class: "tc-info", "aria-live": "polite" });
    var msg = el("span", { class: "tc-msg", role: "status" });
    var custom = el("div", { class: "tc-custom" });
    var inputs = {};
    var labels = { bg: "Fundal", surface: "Suprafață (carduri)", primary: "Culoare principală (antet, butoane)", accent: "Accent" };

    function resolvedNow() {
      if (state.active === "custom") return { id: "custom", name: "Personalizată", bg: state.custom.bg, surface: state.custom.surface, primary: state.custom.primary, accent: state.custom.accent };
      return preset(state.active);
    }
    function refresh() {
      var r = resolvedNow(), v = apply(r);
      Array.prototype.forEach.call(grid.children, function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-id") === state.active)); });
      ["bg", "surface", "primary", "accent"].forEach(function (k) { inputs[k].value = (state.active === "custom" ? state.custom : r)[k].toLowerCase(); });
      var note = v._surfaceAdjusted ? " Suprafața a fost ajustată automat, ca să se citească textul." : "";
      info.textContent = "Textul se alege automat (" + (v["color-scheme"] === "dark" ? "deschis, pe fundal închis" : "închis, pe fundal deschis") + "). Contrast text/fundal: " + ratio(contrast(v["--ink"], v["--parchment"])) + " · text pe butoane: " + ratio(contrast(v["--on-primary"], v["--green"])) + "." + note;
    }
    PRESETS.concat([{ id: "custom", name: "Personalizată", bg: state.custom.bg, surface: state.custom.surface, primary: state.custom.primary, accent: state.custom.accent }]).forEach(function (p) {
      var sw = el("span", { class: "tc-sw" }, ["bg", "surface", "primary", "accent"].map(function (k) { return el("i", { style: "background:" + p[k] }); }));
      var b = el("button", { type: "button", class: "tc-opt", "data-id": p.id, "aria-pressed": "false" }, [sw, el("b", { text: p.id === "custom" ? "Personalizată" : p.name })]);
      b.onclick = function () {
        if (p.id === "custom") state.active = "custom";
        else { state.active = p.id; state.custom = { bg: p.bg, surface: p.surface, primary: p.primary, accent: p.accent }; }
        msg.textContent = "";
        refresh();
      };
      grid.appendChild(b);
    });
    ["bg", "surface", "primary", "accent"].forEach(function (k) {
      var inp = el("input", { type: "color", id: "tc-" + k, value: "#000000" });
      inp.oninput = function () { state.custom[k] = inp.value; state.active = "custom"; msg.textContent = ""; refresh(); };
      inputs[k] = inp;
      custom.appendChild(el("label", { for: "tc-" + k }, [el("span", { text: labels[k] }), inp]));
    });

    function close(revert) {
      if (revert) apply(resolve(startSaved) || preset("pergament"));
      modal.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(true); }
    var save = el("button", { type: "button", class: "btn", text: "Salvează ca tema mea" });
    var reset = el("button", { type: "button", class: "btn outline", text: "Resetează la Pergament" });
    var cancel = el("button", { type: "button", class: "btn outline", text: "Anulează" });
    save.onclick = function () {
      var saved = { active: state.active, custom: state.custom };
      save.disabled = true;
      var done = function (ok, err) {
        save.disabled = false;
        if (!ok) { msg.textContent = "Nu s-a putut salva: " + err; return; }
        savedTheme = saved; cache(saved);
        msg.textContent = "Salvată ✓";
        setTimeout(function () { close(false); }, 700);
      };
      if (!opts || !opts.supabase) return done(true);
      saveTrainer(opts.supabase, opts.email, saved).then(function (r) {
        done(!(r && r.error), r && r.error && (r.error.message + " (ai rulat scriptul add-themes.sql în Supabase?)"));
      });
    };
    reset.onclick = function () { state.active = "pergament"; var p = preset("pergament"); state.custom = { bg: p.bg, surface: p.surface, primary: p.primary, accent: p.accent }; msg.textContent = ""; refresh(); };
    cancel.onclick = function () { close(true); };
    modal.onclick = function (e) { if (e.target === modal) close(true); };
    document.addEventListener("keydown", onKey);

    card.appendChild(el("h2", { text: "Tema de culori" }));
    card.appendChild(el("p", { text: "Alege o temă sau creeaz-o pe a ta. Se aplică în toată aplicația, inclusiv pe ecranele participanților la sesiunile tale, și rămâne salvată în contul tău." }));
    card.appendChild(grid);
    card.appendChild(custom);
    card.appendChild(info);
    card.appendChild(el("div", { class: "tc-actions" }, [save, reset, cancel, msg]));
    modal.appendChild(card);
    document.body.appendChild(modal);
    refresh();
    save.focus();
  }

  var api = { PRESETS: PRESETS, deriveVars: deriveVars, contrast: contrast, resolve: resolve, apply: apply, initTrainer: initTrainer, initParticipant: initParticipant, useDefault: useDefault, openPicker: openPicker, _lum: lum, _mix: mix };
  if (typeof window !== "undefined") window.TCTheme = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // pornire: paginile de trainer aplică imediat tema din cache (fără sclipire), DOAR dacă cineva e deja autentificat;
  // fără autentificare (ecranul de login) rămâne tema implicită. Paginile de participant așteaptă sesiunea.
  if (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme-role") === "trainer") {
    var c = cached();
    if (c && hasLogin()) apply(resolve(c));
  }
})();
