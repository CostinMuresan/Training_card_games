/* Dialog de confirmare comun pentru paginile de trainer (v81). Înlocuiește confirm() din browser.
   Folosire:  if (!(await TCUI.confirm("Mesaj", { title: "Șterge cardul", confirmLabel: "Șterge", danger: true }))) return;
   Focusul pornește pe „Anulează” (alegerea sigură); Escape și click pe fundal anulează; Tab rămâne în dialog. */
(function () {
  var open = null;
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  function confirmDialog(message, opts) {
    opts = opts || {};
    if (open) open.close(false);
    return new Promise(function (resolve) {
      var prev = document.activeElement;
      var overlay = el("div", { class: "cf-overlay" });
      var box = el("div", { class: "cf-box", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "cf-title", "aria-describedby": "cf-msg" });
      box.appendChild(el("h2", { id: "cf-title", class: "serif" }, opts.title || "Confirmare"));
      box.appendChild(el("p", { id: "cf-msg", class: "cf-msg" }, String(message || "")));
      var row = el("div", { class: "cf-actions" });
      var cancel = el("button", { type: "button", class: "btn outline", id: "cf-cancel" }, opts.cancelLabel || "Anulează");
      var ok = el("button", { type: "button", class: "btn " + (opts.danger ? "danger" : ""), id: "cf-ok" }, opts.confirmLabel || "Confirmă");
      row.appendChild(cancel); row.appendChild(ok);
      box.appendChild(row); overlay.appendChild(box);
      document.body.appendChild(overlay);
      var done = false;
      function close(result) {
        if (done) return; done = true; open = null;
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        if (prev && prev.focus && document.contains(prev)) { try { prev.focus(); } catch (e) {} }
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === "Tab") {
          e.preventDefault();
          (document.activeElement === cancel ? ok : cancel).focus();
        }
      }
      document.addEventListener("keydown", onKey, true);
      overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(false); });
      cancel.addEventListener("click", function () { close(false); });
      ok.addEventListener("click", function () { close(true); });
      open = { close: close };
      cancel.focus();
    });
  }
  window.TCUI = { confirm: confirmDialog };
})();
