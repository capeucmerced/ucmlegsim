// js/feed.js — renders The Wire (the journalist newsfeed).
//
// Posts are fetched straight from the intake system's JSON endpoint in the
// reader's browser, so new posts appear seconds after submission with no
// site rebuild. The endpoint is the Apps Script web app from
// intake/apps-script/newsfeed_api.gs.
//
// DEPLOY: paste the /exec URL into FEED_URL below. While it is empty, feed
// containers show a quiet placeholder instead.
//
// Usage on a page:
//   <div class="wire-feed" data-outlet=""></div>
//   <script src="js/feed.js"></script>
// data-outlet="Fresno Bee" limits the feed to one outlet's posts (used
// on the per-outlet journalist pages); empty shows everyone. Filtering
// is by outlet, not name — journalist roster names stay blank so posts
// byline anonymously under the paper's nameplate.

// The DEPARTMENT account's 2026 gateway (matches INTAKE_API_URL in
// scripts/shared.R; changes once a year at turnover).
var FEED_URL = "https://script.google.com/macros/s/AKfycbwcPcwt8LTJri6lBrbarYTzzxuMyDPSR5Ek1nNXrsAzLSDEinia3oXBgt9PEshfqEjoSw/exec";
var REFRESH_SECONDS = 60;    // gentle background refresh while the page is open

(function () {
  "use strict";

  function timeLabel(iso) {
    var then = new Date(iso);
    var mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 60 * 24) return Math.round(mins / 60) + "h ago";
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function safeUrl(url) {
    url = String(url || "").trim();
    if (/^https?:\/\//i.test(url)) return url;
    // Students often paste bare domains ("nytimes.com/story") — accept
    // those as https. Anything else (javascript:, data:, …) is dropped.
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(url)) return "https://" + url;
    return "";
  }

  // Build each post with textContent (never innerHTML) so student-written
  // text can't inject markup into the page.
  function renderPost(post) {
    var item = document.createElement("article");
    item.className = "wire-post";

    var meta = document.createElement("div");
    meta.className = "wire-meta";
    var outlet = document.createElement("span");
    outlet.className = "wire-outlet";
    outlet.textContent = post.outlet || post.name;
    var byline = document.createElement("span");
    byline.className = "wire-byline";
    // Skip the name when it just repeats the outlet
    var showName = post.name && post.name !== (post.outlet || post.name);
    byline.textContent = (showName ? " · " + post.name : "") +
                         " · " + timeLabel(post.time);
    meta.appendChild(outlet);
    meta.appendChild(byline);

    var head = document.createElement("div");
    head.className = "wire-headline";
    var link = safeUrl(post.link);
    if (link) {
      var a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = post.headline;
      head.appendChild(a);
    } else {
      head.textContent = post.headline;
    }

    item.appendChild(meta);
    item.appendChild(head);

    if (post.dek) {
      var dek = document.createElement("div");
      dek.className = "wire-dek";
      dek.textContent = post.dek;
      item.appendChild(dek);
    }

    if (link) {
      var more = document.createElement("a");
      more.className = "wire-more";
      more.href = link;
      more.target = "_blank";
      more.rel = "noopener";
      more.textContent = "Full story →";
      item.appendChild(more);
    }

    return item;
  }

  function fillContainer(container, posts) {
    var only = container.getAttribute("data-outlet") || "";
    var shown = only ? posts.filter(function (p) { return p.outlet === only; }) : posts;
    var limit = parseInt(container.getAttribute("data-limit") || "0", 10);
    if (limit > 0) shown = shown.slice(0, limit);

    container.textContent = "";
    if (shown.length === 0) {
      var empty = document.createElement("p");
      empty.className = "wire-empty";
      empty.textContent = "Nothing on the wire yet.";
      container.appendChild(empty);
      return;
    }
    shown.forEach(function (p) { container.appendChild(renderPost(p)); });
  }

  var CACHE_KEY = "wire-cache-v1";

  function fillAll(posts) {
    document.querySelectorAll(".wire-feed").forEach(function (c) {
      fillContainer(c, posts);
    });
  }

  function showNote(text) {
    document.querySelectorAll(".wire-feed").forEach(function (c) {
      var note = document.createElement("p");
      note.className = "wire-empty";
      note.textContent = text;
      c.textContent = "";
      c.appendChild(note);
    });
  }

  function refresh() {
    if (document.querySelectorAll(".wire-feed").length === 0) return;

    fetch(FEED_URL)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        fillAll(data.posts || []);
        // Remember the feed so the next page load paints instantly
        // (the endpoint takes a couple of seconds to answer)
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
      })
      .catch(function () { /* keep whatever is currently shown */ });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (document.querySelectorAll(".wire-feed").length === 0) return;

    if (!FEED_URL) {
      showNote("The Wire connects when the session begins.");
      return;
    }

    // Instant paint from the last-seen feed; fall back to a fetching note
    var painted = false;
    try {
      var cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached && cached.posts) { fillAll(cached.posts); painted = true; }
    } catch (e) {}
    if (!painted) showNote("Fetching the wire…");

    refresh();
    setInterval(function () {
      if (!document.hidden) refresh();
    }, REFRESH_SECONDS * 1000);
  });
})();
