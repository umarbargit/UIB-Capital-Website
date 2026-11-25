// Cookie consent. Nothing that sets cookies loads until the visitor clicks "Accept".
// IDs come from the <body> data attributes, which build.mjs fills from data/site.json.
(function () {
  var KEY = "uib-consent";
  var body = document.body;
  var GA = body.getAttribute("data-ga");
  var LI = body.getAttribute("data-li");

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    if (GA) {
      var g = document.createElement("script");
      g.async = true;
      g.src = "https://www.googletagmanager.com/gtag/js?id=" + GA;
      document.head.appendChild(g);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { dataLayer.push(arguments); };
      gtag("js", new Date());
      gtag("config", GA);
    }
    if (LI) {
      window._linkedin_partner_id = LI;
      window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
      window._linkedin_data_partner_ids.push(LI);
      if (!window.lintrk) {
        window.lintrk = function (a, b) { window.lintrk.q.push([a, b]); };
        window.lintrk.q = [];
      }
      var l = document.createElement("script");
      l.async = true;
      l.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
      document.head.appendChild(l);
    }
  }

  var bar;
  function hide() { if (bar) { bar.remove(); bar = null; } }
  function show() {
    if (bar) return;
    bar = document.createElement("div");
    bar.className = "consent";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookies");
    bar.innerHTML =
      '<p>I use cookies to see how people find this site and which pages they read. Nothing is sold. <a href="/privacy">Privacy</a></p>' +
      '<div class="consent-btns"><button type="button" class="btn" data-c="yes">Accept</button>' +
      '<button type="button" class="btn btn-ghost" data-c="no">Decline</button></div>';
    bar.addEventListener("click", function (e) {
      var v = e.target.getAttribute && e.target.getAttribute("data-c");
      if (!v) return;
      var was = get();
      set(v);
      hide();
      if (v === "yes") load();
      else if (was === "yes") location.reload(); // stop anything already running
    });
    document.body.appendChild(bar);
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-cookie-settings]");
    if (t) { e.preventDefault(); show(); }
  });

  var c = get();
  if (c === "yes") load();
  else if (c !== "no") show();
})();
