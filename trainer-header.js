/* Antetul comun al paginilor de trainer (v80): cărare de navigare + meniul „Contul meu”.
   Se pune imediat după <header class="app-header" id="app-header" data-title="…" data-parent-label="…" data-parent-href="…">.
   Identificatorii folosiți de cod rămân: #theme-btn (temă), #logout-btn (deconectare), #account-email.
   Butonul „Contul meu” apare abia după autentificare, când theme.js apelează TCHeader.setUser(email). */
(function () {
  var hd = document.getElementById("app-header");
  if (!hd) return;
  var title = hd.getAttribute("data-title") || "";
  var pLabel = hd.getAttribute("data-parent-label");
  var pHref = hd.getAttribute("data-parent-href");
  var cur = hd.getAttribute("data-current") || title;

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  var main = el("div", { class: "hd-main" });
  if (pLabel && pHref) {
    var nav = el("nav", { class: "crumb", "aria-label": "Navigare" });
    var a = el("a", { href: pHref, "data-icon": "arrow-left" }, pLabel);
    nav.appendChild(a);
    nav.appendChild(el("span", { "aria-hidden": "true" }, "›"));
    nav.appendChild(el("span", { "aria-current": "page" }, cur));
    main.appendChild(nav);
  }
  main.appendChild(el("h1", {}, title));

  var acc = el("div", { class: "account", id: "account" });
  acc.hidden = true;
  var btn = el("button", { type: "button", class: "btn onhead sm", id: "account-btn", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "account-menu" }, "Contul meu");
  btn.appendChild(el("span", { class: "chev", "data-icon": "chevron-down", "aria-hidden": "true" }));
  var menu = el("div", { class: "account-menu", id: "account-menu", role: "menu", "aria-label": "Contul meu" });
  menu.hidden = true;
  var who = el("div", { class: "account-who" }, "Autentificat ca");
  who.appendChild(el("b", { id: "account-email" }));
  menu.appendChild(who);
  menu.appendChild(el("hr"));
  menu.appendChild(el("a", { class: "menu-item", role: "menuitem", href: "manual.html", target: "_blank", rel: "noopener", "data-icon": "book" }, "Manual"));
  var th = el("button", { type: "button", class: "menu-item", role: "menuitem", id: "theme-btn", "data-icon": "palette" }, "Temă");
  th.hidden = true; // îl arată theme.js când e gata
  menu.appendChild(th);
  menu.appendChild(el("hr"));
  menu.appendChild(el("button", { type: "button", class: "menu-item", role: "menuitem", id: "logout-btn", "data-icon": "logout" }, "Deconectare"));
  acc.appendChild(btn);
  acc.appendChild(menu);

  hd.textContent = "";
  hd.appendChild(main);
  hd.appendChild(acc);

  function items() { return Array.prototype.filter.call(menu.querySelectorAll(".menu-item"), function (n) { return !n.hidden; }); }
  function setOpen(open, focusBtn) {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { var f = items()[0]; if (f) f.focus(); }
    else if (focusBtn) btn.focus();
  }
  btn.addEventListener("click", function () { setOpen(menu.hidden); });
  menu.addEventListener("click", function (e) { if (e.target.closest(".menu-item")) setOpen(false); });
  document.addEventListener("click", function (e) { if (!menu.hidden && !acc.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (menu.hidden) return;
    if (e.key === "Escape") { setOpen(false, true); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      var list = items(), i = list.indexOf(document.activeElement);
      i = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[i].focus(); e.preventDefault();
    }
  });

  window.TCHeader = {
    setUser: function (email) {
      document.getElementById("account-email").textContent = email || "";
      acc.hidden = !email;
      if (!email) setOpen(false);
    }
  };
})();
