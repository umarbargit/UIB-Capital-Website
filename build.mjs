// UIB Capital - site builder.
// Reads data/*.json and content/theses/*.md and writes a static website into dist/.
// Run with:  npm run build
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, "dist");
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return d; } };

const site = read("data/site.json", {});
const stocks = read("data/stocks.json", { positions: [] });
const perf = read("data/performance.json", { series: [], stats: {}, monthly: {}, yearly: {} });
const closed = read("data/closed.json", { positions: [] });
const crypto = read("data/crypto.json", { holdings: [] });
const angel = read("data/private.json", { investments: [] });

// ------------------------------------------------------------------ helpers
const DASH = "-";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { if (!iso) return DASH; const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z"); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtMonth = (iso) => { if (!iso) return DASH; const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z"); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const pct = (v, dp = 1, sign = true) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return `<span class="muted">${DASH}</span>`;
  const n = Number(v); const cls = sign ? (n > 0 ? "up" : n < 0 ? "down" : "") : "";
  const s = (sign && n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(n).toFixed(dp) + "%";
  return cls ? `<span class="${cls}">${s}</span>` : s;
};
const isSample = [stocks, perf, closed].some((d) => d && d.sample);
const sampleTag = (d) => (d && d.sample && !isSample ? " (sample)" : "");
const W = site.weights || { stocks: 100, crypto: 0, angel: 0 };

// ------------------------------------------------------------------ writing
function parseMd(file) {
  const raw = fs.readFileSync(file, "utf8");
  const meta = {}; let body = raw;
  if (raw.startsWith("---")) {
    const end = raw.indexOf("\n---", 3);
    const head = raw.slice(3, end);
    body = raw.slice(end + 4);
    for (const line of head.split("\n")) {
      const i = line.indexOf(":"); if (i < 0) continue;
      meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  const slug = path.basename(file, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return { ...meta, slug, html: marked.parse(body) };
}
const thesesDir = path.join(ROOT, "content/theses");
const posts = (fs.existsSync(thesesDir) ? fs.readdirSync(thesesDir) : [])
  .filter((f) => f.endsWith(".md"))
  .map((f) => parseMd(path.join(thesesDir, f)))
  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const tickersOf = (t) => String(t.ticker || "").toUpperCase().split(/[\s,&\/]+/).filter(Boolean);
const postFor = {};
for (const t of [...posts].reverse()) for (const k of tickersOf(t)) postFor[k] = t;

// ------------------------------------------------------------------ layout
const NAV = [["/#philosophy", "Philosophy"], ["/#portfolio", "Portfolio"], ["/#performance", "Performance"], ["/writing", "Writing"], ["#contact", "Contact"]];
function page({ title, desc, active, body, closing = true }) {
  const full = title ? `${title} | ${site.name}` : site.name;
  const d = desc || site.intro;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(d)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(d)}">
<meta name="theme-color" content="#469DDD">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
${isSample ? '<div class="sample" role="note">Preview: this site is showing sample data, not real holdings.</div>' : ""}
<header class="site-header"><div class="wrap">
<a class="brand" href="/">${esc(site.name)}</a>
<nav class="nav" aria-label="Main">${NAV.map(([h, l]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
</div></header>
<main class="wrap">
${body}
${closing ? closingBlock() : ""}
</main>
<footer class="site-footer"><div class="wrap">
<p>${esc(site.disclaimer)}</p>
<span>© ${new Date().getUTCFullYear()} ${esc(site.name)}</span>
</div></footer>
</body>
</html>`;
}

const block = (id, n, label, inner) => `<section class="block" id="${id}"><div class="label"><b>${n}</b> / ${label}</div><div>${inner}</div></section>`;

// ------------------------------------------------------------------ pieces
const st = perf.stats || {};
const pS = st.portfolio || {}, bS = st.benchmark || {};
const bench = esc(site.benchmarkName || "S&P 500");
const benchShort = bench.split(" (")[0];
const asOf = stocks.asOf || perf.asOf;
const inception = perf.series?.[0]?.date || site.startDate;

function stats() {
  return `<div class="stats">
<div class="stat"><span class="k">Since ${fmtDate(inception)}</span><span class="v">${pct(pS.sinceInception)}</span><span class="s">${benchShort} ${pct(bS.sinceInception, 1, false)}</span></div>
<div class="stat"><span class="k">Year to date</span><span class="v">${pct(pS.ytd)}</span><span class="s">${benchShort} ${pct(bS.ytd, 1, false)}</span></div>
<div class="stat"><span class="k">Largest fall</span><span class="v">${pct(pS.maxDrawdown)}</span><span class="s">${benchShort} ${pct(bS.maxDrawdown, 1, false)}</span></div>
<div class="stat"><span class="k">Positions</span><span class="v">${(stocks.positions || []).length + (crypto.holdings || []).length}</span><span class="s">${(stocks.positions || []).length} stocks, ${(crypto.holdings || []).length} crypto</span></div>
</div>`;
}

function allocation() {
  const a = [["Stocks", W.stocks ?? 0], ["Crypto", W.crypto ?? 0], ["Angel", W.angel ?? 0]];
  const cols = ["var(--c1)", "var(--c2)", "var(--c3)"];
  return `<div class="alloc"><div class="alloc-bar" role="img" aria-label="Target weights: ${a.map(([l, p]) => `${l} ${p}%`).join(", ")}">${a.map(([, p], i) => `<span style="width:${p}%;background:${cols[i]}"></span>`).join("")}</div>
<div class="alloc-legend">${a.map(([l, p], i) => `<span><span class="swatch" style="background:${cols[i]}"></span>${l} <span class="mono">${p}%</span></span>`).join("")}</div></div>`;
}

function stockTable() {
  const rows = stocks.positions || [];
  const link = (s) => (postFor[s] ? `<a href="/writing/${postFor[s].slug}">Thesis</a>` : `<span class="muted">${DASH}</span>`);
  const extra = [];
  if (stocks.undisclosedNewWeight > 0) extra.push(`<tr><td>New positions <span class="muted">(shown once the thesis is out)</span></td><td class="num">${pct(stocks.undisclosedNewWeight, 1, false)}</td><td class="num"></td><td></td><td></td></tr>`);
  if (stocks.cashWeight !== undefined) extra.push(`<tr><td>Cash</td><td class="num">${pct(stocks.cashWeight, 1, false)}</td><td class="num"></td><td></td><td></td></tr>`);
  return `<div class="sub"><h3>Stocks</h3><span>Interactive Brokers, ${fmtDate(asOf)}</span></div>
<div class="table-box"><table>
<thead><tr><th scope="col">Holding</th><th scope="col" class="num">Weight</th><th scope="col" class="num">Return</th><th scope="col" style="padding-left:24px">Since</th><th scope="col"></th></tr></thead>
<tbody>${rows.map((p) => `<tr><td><strong>${esc(p.symbol)}</strong> <span class="muted">${esc(p.name)}</span></td><td class="num">${pct(p.weight, 1, false)}</td><td class="num">${pct(p.returnPct)}</td><td class="muted" style="padding-left:24px">${fmtMonth(p.firstBought)}</td><td>${link(p.symbol)}</td></tr>`).join("")}${extra.join("")}</tbody>
</table></div>`;
}

function cryptoTable() {
  const h = crypto.holdings || [];
  const basis = h.find((x) => x.returnBasis)?.returnBasis || "";
  const since = basis.startsWith("since 20") ? `since ${fmtDate(basis.slice(6))}` : basis;
  return `<div class="sub"><h3>Crypto${sampleTag(crypto)}</h3><span>Market prices, ${fmtDate(crypto.asOf)}</span></div>
<div class="table-box"><table>
<thead><tr><th scope="col">Holding</th><th scope="col" class="num">Weight</th><th scope="col" class="num">Return</th><th scope="col" style="padding-left:24px">Held in</th><th scope="col"></th></tr></thead>
<tbody>${h.map((x) => `<tr><td><strong>${esc(x.symbol)}</strong> <span class="muted">${esc(x.name)}</span></td><td class="num">${pct(x.weight, 1, false)}</td><td class="num">${pct(x.returnPct)}</td><td class="muted" style="padding-left:24px">Cold storage</td><td>${postFor[x.symbol] ? `<a href="/writing/${postFor[x.symbol].slug}">Thesis</a>` : ""}</td></tr>`).join("")}</tbody>
</table></div>
<p class="note">Weight within the crypto part of the portfolio. Return ${esc(since)}.</p>`;
}

function angelTable() {
  const inv = angel.investments || [];
  return `<div class="sub"><h3>Angel${sampleTag(angel)}</h3><span>Updated on new rounds</span></div>
${inv.length ? `<div class="table-box"><table><thead><tr><th scope="col">Company</th><th scope="col">Round</th><th scope="col">Why</th><th scope="col" class="num">Mark</th></tr></thead>
<tbody>${inv.map((i) => `<tr><td><strong>${esc(i.company)}</strong> <span class="muted">${esc(i.sector)}</span></td><td class="muted">${esc(i.round)}, ${esc(i.year)}</td><td style="white-space:normal">${esc(i.note)}</td><td class="num">${esc(i.markup || DASH)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nothing yet.</p>`}`;
}

function chart() {
  const s = perf.series || [];
  if (s.length < 2) return `<div class="chart"><div class="chart-empty">The chart fills in as the first days of data come through.</div></div>`;
  const step = Math.max(1, Math.floor(s.length / 400));
  const pts = s.filter((_, i) => i % step === 0 || i === s.length - 1);
  const vals = pts.flatMap((p) => [p.port, p.bench].filter((v) => v !== undefined));
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const Wd = 1000, H = 320, L = 44, B = 26;
  const x = (i) => L + (i / (pts.length - 1)) * (Wd - L - 4);
  const y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (H - B - 6);
  const line = (k) => pts.map((p, i) => (p[k] === undefined ? null : `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`)).filter(Boolean).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const last = pts[pts.length - 1];
  const font = 'font-size="12" fill="var(--muted)" font-family="JetBrains Mono, monospace"';
  return `<div class="chart">
<div class="legend"><span><i style="background:var(--c1)"></i>${esc(site.name)}</span><span><i style="background:var(--bench)"></i>${bench}</span></div>
<svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Growth of 100 since ${fmtDate(pts[0].date)}: ${esc(site.name)} ${last.port.toFixed(1)}, ${bench} ${last.bench ? last.bench.toFixed(1) : "n/a"}">
${ticks.map((t) => `<line x1="${L}" x2="${Wd}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 10}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" ${font}>${t.toFixed(0)}</text>`).join("")}
<text x="${L}" y="${H - 4}" ${font}>${fmtDate(pts[0].date)}</text>
<text x="${Wd}" y="${H - 4}" text-anchor="end" ${font}>${fmtDate(last.date)}</text>
<polyline points="${line("bench")}" fill="none" stroke="var(--bench)" stroke-width="1.5"/>
<polyline points="${line("port")}" fill="none" stroke="var(--c1)" stroke-width="2.25"/>
</svg>
<p class="note">Growth of 100 from the start. ${W.stocks}% stocks and ${W.crypto}% crypto, time-weighted and after costs. Money added or taken out isn't counted as a gain or loss.</p></div>`;
}

function sleeves() {
  const rows = [["Portfolio", st.portfolio, true], ["Stocks", st.stocks], ["Crypto", st.crypto], [benchShort, st.benchmark]];
  return `<div class="sub"><h3>By part</h3><span>&nbsp;</span></div><div class="table-box"><table><thead><tr><th scope="col"></th><th scope="col" class="num">Since start</th><th scope="col" class="num">Year to date</th><th scope="col" class="num">Largest fall</th></tr></thead>
<tbody>${rows.map(([l, x, b]) => `<tr><td>${b ? `<strong>${l}</strong>` : l}</td><td class="num">${pct(x?.sinceInception)}</td><td class="num">${pct(x?.ytd)}</td><td class="num">${pct(x?.maxDrawdown)}</td></tr>`).join("")}</tbody></table></div>`;
}

function monthly() {
  const m = perf.monthly?.portfolio || {}, yr = perf.yearly || {};
  const years = Object.keys(m).sort().reverse();
  if (!years.length) return `<div class="sub"><h3>Month by month</h3><span>&nbsp;</span></div><p class="empty">The first month shows here at the end of the month.</p>`;
  return `<div class="sub"><h3>Month by month</h3><span>&nbsp;</span></div><div class="table-box"><table class="monthly">
<thead><tr><th scope="col">Year</th>${MONTHS.map((x) => `<th scope="col">${x}</th>`).join("")}<th scope="col">Year</th><th scope="col">${benchShort}</th></tr></thead>
<tbody>${years.map((y) => `<tr><th scope="row">${y}</th>${MONTHS.map((_, i) => { const v = m[y]?.[String(i + 1).padStart(2, "0")]; return `<td>${v === undefined ? "" : pct(v, 1)}</td>`; }).join("")}<td><strong>${pct(yr.portfolio?.[y])}</strong></td><td>${pct(yr.benchmark?.[y], 1, false)}</td></tr>`).join("")}</tbody>
</table></div>`;
}

function closedList() {
  const c = closed.positions || [];
  if (!c.length) return `<div class="sub"><h3>Closed positions</h3><span>&nbsp;</span></div><p class="empty">None yet.</p>`;
  return `<div class="sub"><h3>Closed positions</h3><span>${c.length} closed, ${c.filter((x) => (x.returnPct ?? 0) > 0).length} winners</span></div>
<div class="table-box"><table><thead><tr><th scope="col">Holding</th><th scope="col">Bought</th><th scope="col">Sold</th><th scope="col" class="num">Result</th><th scope="col"></th></tr></thead>
<tbody>${c.map((p) => `<tr><td><strong>${esc(p.symbol)}</strong> <span class="muted">${esc(p.name)}</span></td><td class="muted">${fmtMonth(p.opened)}</td><td class="muted">${fmtMonth(p.closed)}</td><td class="num">${pct(p.returnPct)}</td><td style="padding-left:16px">${postFor[p.symbol] ? `<a href="/writing/${postFor[p.symbol].slug}">Note</a>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

function postList(list) {
  if (!list.length) return `<p class="empty">Nothing published yet.</p>`;
  return `<ul class="posts">${list.map((t) => `<li><a href="/writing/${t.slug}"><span class="meta">${fmtDate(t.date)}${t.ticker ? `<br>${esc(t.ticker)}` : ""}</span><span><h3>${esc(t.title)}</h3><p>${esc(t.summary || "")}</p></span></a></li>`).join("")}</ul>`;
}

function closingBlock() {
  const u = site.newsletter?.username;
  const li = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>`;
  const mail = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
  return `<section class="closing" id="contact"><h2>Curious?</h2>
<p>If you want to talk about any of it, get in touch.</p>
<div class="contact">
${site.contact ? `<a class="btn" href="mailto:${esc(site.contact)}">${mail}<span>${esc(site.contact)}</span></a>` : ""}
${site.linkedin ? `<a class="btn btn-ghost" href="${esc(site.linkedin)}" target="_blank" rel="noopener">${li}<span>LinkedIn</span></a>` : ""}
</div>
${u ? `<form class="subscribe" action="https://buttondown.com/api/emails/embed-subscribe/${esc(u)}" method="post" target="_blank"><label for="email" style="position:absolute;left:-9999px">Email address</label><input id="email" name="email" type="email" required placeholder="Email address" autocomplete="email"><button type="submit">Get new posts</button></form>` : ""}
</section>`;
}

// ------------------------------------------------------------------ pages
const pages = {};
pages["index.html"] = page({
  active: "/",
  body: `<section class="hero">
<h1>${esc(site.headline)}</h1>
<p>${esc(site.intro)}</p>
<div class="live"><i aria-hidden="true"></i>Updated ${fmtDate(asOf)}</div>
</section>
${block("about", "01", "Who I am", `<h2>About</h2><div class="prose">${(site.about || []).map((p) => `<p>${esc(p)}</p>`).join("")}</div>`)}
${block("philosophy", "02", "Philosophy", `<h2>How I invest</h2><ol class="principles">${(site.principles || []).map((p) => `<li><div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div></li>`).join("")}</ol>`)}
${block("portfolio", "03", "Portfolio", `<h2>What I own</h2>${allocation()}${stockTable()}${cryptoTable()}${angelTable()}<p class="note">${esc(site.scope || "")}</p>`)}
${block("performance", "04", "Performance", `<h2>How it's done</h2>${stats()}${chart()}${sleeves()}<a class="more" href="/performance">Monthly returns and closed positions</a>`)}
${block("writing", "05", "Writing", `<h2>Theses and notes</h2>${postList(posts.slice(0, 5))}${posts.length > 5 ? `<a class="more" href="/writing">Everything I've written</a>` : ""}`)}`,
});
pages["performance.html"] = page({
  title: "Performance", active: "/#performance", desc: `${site.name} performance against the ${site.benchmarkName}.`,
  body: `<section class="hero" style="padding:80px 0 48px"><h1>Performance</h1><p>${W.stocks}% stocks and ${W.crypto}% crypto, compared with the ${bench}. Time-weighted and after costs.</p></section>
${block("record", "04", "Performance", `${stats()}${chart()}${sleeves()}${monthly()}${closedList()}`)}`,
});
pages["writing.html"] = page({
  title: "Writing", active: "/writing", desc: `Theses and notes from ${site.name}.`,
  body: `<section class="hero" style="padding:80px 0 48px"><h1>Writing</h1><p>Why I bought, why I sold and what I think. Dated, so you can check me against what happened next.</p></section>
${block("all", "05", "Writing", postList(posts))}`,
});
for (const t of posts) {
  pages[`writing/${t.slug}.html`] = page({
    title: t.title, active: "/writing", desc: t.summary,
    body: `<article class="article"><a href="/writing">All writing</a>
<p class="meta">${fmtDate(t.date)}${t.ticker ? ` | ${esc(t.ticker)}` : ""}${t.type ? ` | ${esc(t.type)}` : ""}</p>
<h1>${esc(t.title)}</h1>
${t.summary ? `<p class="lead">${esc(t.summary)}</p>` : ""}
<div class="body">${t.html}</div></article>`,
  });
}
pages["404.html"] = page({ title: "Not found", closing: false, body: `<section class="hero"><h1>Nothing here.</h1><p><a href="/">Back to the home page</a></p></section>` });

// ------------------------------------------------------------------ write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "writing"), { recursive: true });
for (const [f, html] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, f), html);
fs.cpSync(path.join(ROOT, "public"), OUT, { recursive: true });
console.log(`Built ${Object.keys(pages).length} pages into dist/${isSample ? " (SAMPLE data)" : ""}.`);
