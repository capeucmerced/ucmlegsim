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
//   <div class="wire-feed" data-journalist=""></div>
//   <script src="js/feed.js"></script>
// data-journalist="Name" limits the feed to one journalist's posts
// (used on the per-journalist pages); empty shows everyone.

// BETA deployment (instructor's personal account). At the department
// deploy, this swaps to the department web app's /exec URL.
var FEED_URL = "https://script.google.com/macros/s/AKfycbzV8j7CpZvdkmS44vdWTzUxw0_tLufgwN0gz-QCdswe_5wujNiS4YXVLZVkQUqGDMLJ/exec";
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
    return /^https?:\/\//i.test(url) ? url : "";
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
    byline.textContent = " · " + post.name + (post.handle ? " " + post.handle : "") +
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
    var only = container.getAttribute("data-journalist") || "";
    var shown = only ? posts.filter(function (p) { return p.name === only; }) : posts;
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
