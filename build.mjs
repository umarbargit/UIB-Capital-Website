// UIB Capital – site builder.
// Reads data/*.json and content/theses/*.md, writes a static website into dist/.
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
const priv = read("data/private.json", { investments: [] });

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { if (!iso) return "—"; const d = new Date(iso + "T00:00:00Z"); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtMonth = (iso) => { if (!iso) return "—"; const d = new Date(iso + "T00:00:00Z"); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const pct = (v, dp = 1, sign = true) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '<span class="muted">—</span>';
  const n = Number(v); const cls = sign ? (n > 0 ? "up" : n < 0 ? "down" : "") : "";
  const s = (sign && n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(dp) + "%";
  return cls ? `<span class="${cls}">${s}</span>` : s;
};
const isSample = [stocks, perf, closed].some((d) => d && d.sample);
const sampleTag = (d) => (d && d.sample && !isSample ? ' <span class="pill">Sample</span>' : "");

// ------------------------------------------------------------------ theses
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
const theses = (fs.existsSync(thesesDir) ? fs.readdirSync(thesesDir) : [])
  .filter((f) => f.endsWith(".md"))
  .map((f) => parseMd(path.join(thesesDir, f)))
  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const thesisFor = Object.fromEntries(theses.filter((t) => t.ticker).map((t) => [t.ticker.toUpperCase(), t]));

// ------------------------------------------------------------------ layout
const NAV = [["/", "Home"], ["/portfolio", "Portfolio"], ["/performance", "Performance"], ["/theses", "Theses"], ["/about", "About"]];
function page({ title, desc, active, body }) {
  const full = title ? `${title} · ${site.name}` : `${site.name} — ${site.tagline}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc || site.intro)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(desc || site.intro)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
${isSample ? '<div class="sample" role="note"><strong>Preview:</strong> this site is showing SAMPLE data, not real holdings or results.</div>' : ""}
<header class="site-header"><div class="wrap">
<a class="brand" href="/"><span class="brand-mark" aria-hidden="true">U</span><span class="brand-name">${esc(site.name)}</span></a>
<nav class="nav" aria-label="Main">${NAV.map(([h, l]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
<p>${esc(site.disclaimer)}</p>
<span>© ${new Date().getUTCFullYear()} ${esc(site.name)}</span>
</div></footer>
</body>
</html>`;
}

// ------------------------------------------------------------------ pieces
const pS = perf.stats?.portfolio || {}, bS = perf.stats?.benchmark || {};
const bench = esc(site.benchmarkName || "S&P 500");
const asOf = stocks.asOf || perf.asOf;

function statsBlock() {
  const nPos = (stocks.positions || []).length;
  return `<section aria-label="Headline numbers" style="padding-top:0"><div class="stats">
<div class="stat"><span class="stat-label">Since inception (${fmtMonth(perf.series?.[0]?.date || site.startDate)})</span><span class="stat-value">${pct(pS.sinceInception)}</span><span class="stat-label">${bench}: ${pct(bS.sinceInception, 1, false)}</span></div>
<div class="stat"><span class="stat-label">Year to date</span><span class="stat-value">${pct(pS.ytd)}</span><span class="stat-label">${bench}: ${pct(bS.ytd, 1, false)}</span></div>
<div class="stat"><span class="stat-label">Largest fall from a peak</span><span class="stat-value">${pct(pS.maxDrawdown)}</span><span class="stat-label">${bench}: ${pct(bS.maxDrawdown, 1, false)}</span></div>
<div class="stat"><span class="stat-label">Stock positions held</span><span class="stat-value">${nPos}</span><span class="stat-label">${(() => { const n = theses.filter((t) => t.type !== "View").length; return `${n} ${n === 1 ? "thesis" : "theses"} published`; })()}</span></div>
</div></section>`;
}

function allocationBlock() {
  const a = site.allocation || []; const cols = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--bench)"];
  return `<div><div class="alloc-bar" role="img" aria-label="Allocation: ${a.map((x) => `${esc(x.label)} ${x.pct}%`).join(", ")}">${a.map((x, i) => `<span style="width:${x.pct}%;background:${cols[i % 4]}"></span>`).join("")}</div>
<div class="alloc-legend">${a.map((x, i) => `<span><span class="swatch" style="background:${cols[i % 4]}"></span>${esc(x.label)} <span class="mono">${x.pct}%</span></span>`).join("")}</div></div>`;
}

function stockTable(limit) {
  const rows = (stocks.positions || []).slice(0, limit || 999);
  const t = (s) => thesisFor[s] ? `<a href="/theses/${thesisFor[s].slug}">Read</a>` : '<span class="muted">—</span>';
  const extra = [];
  if (!limit && stocks.undisclosedNewWeight > 0) extra.push(`<tr><td><strong>New positions</strong> <span class="muted">shown once the thesis is published</span></td><td class="num">${pct(stocks.undisclosedNewWeight, 1, false)}</td><td class="num">—</td><td>—</td><td>—</td></tr>`);
  if (!limit && stocks.cashWeight !== undefined) extra.push(`<tr><td><strong>Cash</strong></td><td class="num">${pct(stocks.cashWeight, 1, false)}</td><td class="num">—</td><td>—</td><td>—</td></tr>`);
  return `<div class="card"><div class="card-head"><h3 class="h3">Public stocks</h3><span class="mono muted" style="font-size:13px">From Interactive Brokers · updated ${fmtDate(asOf)}</span></div>
<div class="table-box"><table>
<thead><tr><th scope="col">Holding</th><th scope="col" class="num">Weight</th><th scope="col" class="num">Return since bought</th><th scope="col">First bought</th><th scope="col">Thesis</th></tr></thead>
<tbody>${rows.map((p) => `<tr><td><strong>${esc(p.symbol)}</strong> <span class="muted">${esc(p.name)}</span></td><td class="num">${pct(p.weight, 1, false)}</td><td class="num">${pct(p.returnPct)}</td><td class="muted">${fmtMonth(p.firstBought)}</td><td>${t(p.symbol)}</td></tr>`).join("")}${extra.join("")}</tbody>
</table></div>
${limit && (stocks.positions || []).length > limit ? `<div style="padding:12px 22px;border-top:1px solid var(--line-soft)"><a class="link-more" href="/portfolio">All ${(stocks.positions || []).length} holdings →</a></div>` : ""}
</div>`;
}

function cryptoCard() {
  return `<div class="card card-pad stack" style="gap:14px"><div class="section-head" style="margin:0"><h3 class="h3">Crypto${sampleTag(crypto)}</h3><span class="mono muted" style="font-size:13px">Updated ${fmtMonth(crypto.asOf)}</span></div>
<div class="rows">${(crypto.holdings || []).map((h) => `<div class="row"><span><strong>${esc(h.symbol)}</strong> <span class="muted">${esc(h.name)}</span></span><span class="mono">${pct(h.weight, 0, false)} · ${pct(h.returnPct, 0)}</span></div>`).join("")}</div>
<p class="muted" style="margin:0;font-size:13px">Weight within crypto · return since bought. Kept separate from the stock record.</p></div>`;
}

function privateCard() {
  return `<div class="card card-pad stack" style="gap:14px"><div class="section-head" style="margin:0"><h3 class="h3">Private &amp; angel${sampleTag(priv)}</h3><span class="mono muted" style="font-size:13px">Updated on new rounds</span></div>
<div class="rows">${(priv.investments || []).map((i) => `<div class="row"><span><strong>${esc(i.company)}</strong> <span class="muted">${esc(i.sector)}</span><br><span class="muted" style="font-size:14px">${esc(i.note)}</span></span><span class="muted">${esc(i.round)} · ${esc(i.year)}${i.markup ? ` · ${esc(i.markup)}` : ""}</span></div>`).join("")}</div>
<p class="muted" style="margin:0;font-size:13px">No market price, so no live return.</p></div>`;
}

function chart() {
  const s = perf.series || [];
  if (s.length < 2) return `<div class="card chart"><p class="muted">The chart appears after the first few days of data.</p></div>`;
  const step = Math.max(1, Math.floor(s.length / 400));
  const pts = s.filter((_, i) => i % step === 0 || i === s.length - 1);
  const vals = pts.flatMap((p) => [p.port, p.bench].filter((v) => v !== undefined));
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const W = 1000, H = 300, L = 48, B = 26;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - 8);
  const y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (H - B - 8);
  const line = (k) => pts.map((p, i) => (p[k] === undefined ? null : `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`)).filter(Boolean).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
  const last = pts[pts.length - 1];
  return `<div class="card chart">
<div class="legend"><span><span class="legend-line" style="background:var(--c1)"></span>${esc(site.name)}</span><span><span class="legend-line" style="background:var(--bench)"></span>${bench}</span></div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Growth of 100 since ${fmtDate(pts[0].date)}: ${esc(site.name)} ${last.port.toFixed(1)}, ${bench} ${last.bench ? last.bench.toFixed(1) : "n/a"}">
${ticks.map((t) => `<line x1="${L}" x2="${W - 8}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--line-soft)" stroke-width="1"/><text x="${L - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${t.toFixed(0)}</text>`).join("")}
<text x="${L}" y="${H - 6}" font-size="12" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${fmtMonth(pts[0].date)}</text>
<text x="${W - 8}" y="${H - 6}" text-anchor="end" font-size="12" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${fmtMonth(last.date)}</text>
<polyline points="${line("bench")}" fill="none" stroke="var(--bench)" stroke-width="2" stroke-dasharray="6 5"/>
<polyline points="${line("port")}" fill="none" stroke="var(--c1)" stroke-width="2.5"/>
</svg>
<p class="muted" style="margin:10px 0 0;font-size:13px">Growth of 100 invested at the start. ${esc(perf.method || "")}.</p></div>`;
}

function monthlyTable() {
  const m = perf.monthly?.portfolio || {}, yr = perf.yearly || {};
  const years = Object.keys(m).sort().reverse();
  if (!years.length) return "";
  return `<div class="card table-box"><table class="monthly">
<thead><tr><th scope="col">Year</th>${MONTHS.map((x) => `<th scope="col">${x}</th>`).join("")}<th scope="col">Year</th><th scope="col">${bench.split(" (")[0]}</th></tr></thead>
<tbody>${years.map((y) => `<tr><th scope="row" class="yr">${y}</th>${MONTHS.map((_, i) => { const v = m[y]?.[String(i + 1).padStart(2, "0")]; return `<td>${v === undefined ? '<span class="muted">·</span>' : pct(v, 1)}</td>`; }).join("")}<td class="yr">${pct(yr.portfolio?.[y])}</td><td>${pct(yr.benchmark?.[y], 1, false)}</td></tr>`).join("")}</tbody>
</table></div>`;
}

function closedTable() {
  const c = closed.positions || [];
  if (!c.length) return `<p class="muted">No closed positions yet.</p>`;
  const wins = c.filter((x) => (x.returnPct ?? 0) > 0).length;
  const avg = c.reduce((a, x) => a + (x.returnPct ?? 0), 0) / c.length;
  return `<p style="margin:0 0 14px">Closed positions: <strong>${c.length}</strong> · winners <strong>${wins}</strong> · average result <strong class="mono">${pct(avg)}</strong></p>
<div class="card table-box"><table><thead><tr><th scope="col">Holding</th><th scope="col">Bought</th><th scope="col">Sold</th><th scope="col" class="num">Result</th><th scope="col">Note</th></tr></thead>
<tbody>${c.map((p) => `<tr><td><strong>${esc(p.symbol)}</strong> <span class="muted">${esc(p.name)}</span></td><td class="muted">${fmtMonth(p.opened)}</td><td class="muted">${fmtMonth(p.closed)}</td><td class="num">${pct(p.returnPct)}</td><td>${thesisFor[p.symbol] ? `<a href="/theses/${thesisFor[p.symbol].slug}">Read</a>` : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody></table></div>`;
}

function thesisCards(list) {
  return `<div class="grid-3">${list.map((t) => `<article class="card thesis-card">
<span class="mono muted" style="font-size:13px">${fmtDate(t.date)}${t.ticker ? ` · ${esc(t.ticker)}` : ""} · ${esc(t.type || "Note")}</span>
<h3><a href="/theses/${t.slug}">${esc(t.title)}</a></h3>
<p>${esc(t.summary || "")}</p>
${t.ticker && (stocks.positions || []).find((p) => p.symbol === t.ticker.toUpperCase()) ? `<span class="mono" style="font-size:13px">Position return: ${pct((stocks.positions || []).find((p) => p.symbol === t.ticker.toUpperCase()).returnPct)}</span>` : ""}
<a class="link-more" href="/theses/${t.slug}">Read</a>
</article>`).join("")}</div>`;
}

function subscribeBlock() {
  const u = site.newsletter?.username;
  if (!u) return "";
  return `<form class="subscribe" action="https://buttondown.com/api/emails/embed-subscribe/${esc(u)}" method="post" target="_blank">
<h3 class="h3">Get new theses by email</h3>
<label for="email">Email address</label>
<div class="fields"><input id="email" name="email" type="email" required placeholder="you@example.com" autocomplete="email"><button type="submit">Subscribe</button></div>
</form>`;
}

// ------------------------------------------------------------------ pages
const pages = {};
pages["index.html"] = page({
  active: "/",
  body: `<section class="hero">
<p class="eyebrow"><span class="dot" aria-hidden="true"></span>Synced from Interactive Brokers · updated ${fmtDate(asOf)}</p>
<h1 class="display">${esc(site.tagline)}</h1>
<p class="lead">${esc(site.intro)}</p>
</section>
${statsBlock()}
<section><div class="section-head"><h2 class="h2">Portfolio</h2><span class="muted" style="font-size:14px">Weights only — amounts are not shown</span></div>
<div class="stack">${allocationBlock()}${stockTable(5)}</div></section>
<section><div class="section-head"><h2 class="h2">Performance</h2><a class="link-more" href="/performance">Full record →</a></div>${chart()}</section>
<section><div class="section-head"><h2 class="h2">Latest theses</h2><a class="link-more" href="/theses">All writing →</a></div>${thesisCards(theses.slice(0, 3))}</section>`,
});
pages["portfolio.html"] = page({
  title: "Portfolio", active: "/portfolio", desc: `What ${site.name} holds today, as percentages.`,
  body: `<section class="hero" style="padding-bottom:24px"><h1 class="display" style="font-size:clamp(32px,5vw,48px)">Portfolio</h1><p class="lead">What I hold today. Weights and returns only — amounts are never shown.</p></section>
<div class="stack">${allocationBlock()}${stockTable()}<div class="grid-2">${cryptoCard()}${privateCard()}</div></div>`,
});
pages["performance.html"] = page({
  title: "Performance", active: "/performance", desc: `${site.name} performance against the ${site.benchmarkName}.`,
  body: `<section class="hero" style="padding-bottom:24px"><h1 class="display" style="font-size:clamp(32px,5vw,48px)">Performance</h1><p class="lead">Public stocks only, compared with the ${bench}. Time-weighted and after costs, so money added or withdrawn doesn't count as a gain or loss.</p></section>
${statsBlock()}
<section>${chart()}</section>
<section><div class="section-head"><h2 class="h2">Month by month</h2></div>${monthlyTable()}</section>
<section><div class="section-head"><h2 class="h2">Closed positions</h2></div>${closedTable()}</section>`,
});
pages["theses.html"] = page({
  title: "Theses", active: "/theses", desc: `Every investment thesis published by ${site.name}.`,
  body: `<section class="hero" style="padding-bottom:24px"><h1 class="display" style="font-size:clamp(32px,5vw,48px)">Theses</h1><p class="lead">Why I bought, why I sold, and what I think — dated, so the record can be checked.</p></section>${thesisCards(theses)}`,
});
pages["about.html"] = page({
  title: "About", active: "/about",
  body: `<section class="hero" style="padding-bottom:0"><h1 class="display" style="font-size:clamp(32px,5vw,48px)">About</h1></section>
<div class="grid-2" style="align-items:start;padding-top:24px"><div class="stack" style="gap:14px">${(site.about || []).map((p) => `<p style="margin:0;font-size:17px;line-height:1.7">${esc(p)}</p>`).join("")}${site.contact ? `<p style="margin:0">Contact: <a href="mailto:${esc(site.contact)}">${esc(site.contact)}</a></p>` : ""}</div>${subscribeBlock()}</div>`,
});
for (const t of theses) {
  pages[`theses/${t.slug}.html`] = page({
    title: t.title, active: "/theses", desc: t.summary,
    body: `<article class="article"><a href="/theses">← All theses</a>
<p class="eyebrow" style="margin-top:28px">${fmtDate(t.date)}${t.ticker ? ` · ${esc(t.ticker)}` : ""} · ${esc(t.type || "Note")}</p>
<h1>${esc(t.title)}</h1>
${t.summary ? `<p class="lead" style="margin-bottom:28px">${esc(t.summary)}</p>` : ""}
<div class="body">${t.html}</div></article>`,
  });
}
pages["404.html"] = page({ title: "Not found", body: `<section class="hero"><h1 class="display">Page not found</h1><p class="lead"><a href="/">Back to the home page</a></p></section>` });

// ------------------------------------------------------------------ write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "theses"), { recursive: true });
for (const [f, html] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, f), html);
fs.cpSync(path.join(ROOT, "public"), OUT, { recursive: true });
console.log(`Built ${Object.keys(pages).length} pages into dist/${isSample ? " (SAMPLE data)" : ""}.`);
