// js/tabs.js — opens a page's tab from the link that led there.
//
// Quarto's tabsets (::: {.panel-tabset}) always open on the first tab.
// A link ending in "#tab-<label>" opens the tab whose label matches
// instead, e.g.
//   committees.html#tab-agriculture-and-natural-resources
// The label is matched after lowercasing and turning every run of other
// characters into "-", the same rule as tab_slug() in scripts/shared.R,
// which writes these links. Loaded on every page (include-after-body in
// _quarto.yml); a page without a matching tab is left alone.

(function () {
  "use strict";

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function openFromHash() {
    var m = /^#tab-(.+)$/.exec(window.location.hash);
    if (!m) return;
    var want = decodeURIComponent(m[1]);
    var links = document.querySelectorAll(".panel-tabset .nav-tabs .nav-link");
    for (var i = 0; i < links.length; i++) {
      if (slug(links[i].textContent) !== want) continue;
      links[i].click();
      var set = links[i].closest(".panel-tabset");
      if (set) {
        // Below the fixed navbar, after the tab has switched
        setTimeout(function () {
          var top = set.getBoundingClientRect().top + window.pageYOffset - 90;
          window.scrollTo(0, Math.max(0, top));
        }, 60);
      }
      return;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", openFromHash);
  } else {
    openFromHash();
  }
  window.addEventListener("hashchange", openFromHash);
})();
