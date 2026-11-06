// In-memory full text search (port of SearchEngine.swift).

export function identifierWords(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-. ]+/g, " ").toLowerCase().split(" ").filter(Boolean);
}

export function stem(w) {
  if (w.length <= 4) return w;
  for (const s of ["ations", "ation", "ions", "ion", "ers", "er", "ing", "ors", "or", "ed", "es", "en", "s", "e"])
    if (w.endsWith(s) && w.length - s.length >= 4) return w.slice(0, -s.length);
  return w;
}

function tokenize(q) {
  const out = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) out.push((m[1] || m[2]).toLowerCase());
  return out;
}

function codeWords(code) {
  const set = new Set();
  for (const id of code.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []) for (const w of identifierWords(id)) if (w.length > 1) set.add(w);
  return [...set].join(" ");
}

const W = { title: 10, tags: 7, category: 5, summary: 5, folder: 4, code: 2, content: 2 };

/** docs: {id, kind: note|prompt|script|folder, title, summary, content, tags[], category, folderPath[], project, status, isFavorite, modifiedAt} */
export class SearchIndex {
  constructor(docs = []) { this.rebuild(docs); }
  rebuild(docs) {
    this.entries = docs.map((d) => ({
      d,
      title: (d.title + " " + identifierWords(d.title).join(" ")).toLowerCase(),
      tags: (d.tags || []).join(" ").toLowerCase(),
      summary: (d.summary || "").toLowerCase(),
      category: (d.category || "").toLowerCase(),
      folder: (d.folderPath || []).join(" / ").toLowerCase(),
      content: (d.content || "").toLowerCase(),
      words: d.kind === "script" ? codeWords(d.content || "") : "",
    }));
  }
  get count() { return this.entries.length; }

  tagCounts() {
    const c = {};
    for (const e of this.entries) for (const t of e.d.tags || []) c[t] = (c[t] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  search(q, limit = 300) {
    const raw = (q.text || "").trim();
    const terms = q.mode === "exact" ? [] : tokenize(raw);
    const stems = terms.map(stem);
    const hits = [];
    for (const e of this.entries) {
      const d = e.d;
      if (q.kinds?.size && !q.kinds.has(d.kind)) continue;
      if (q.favoritesOnly && !d.isFavorite) continue;
      if (q.projects?.size && !q.projects.has(d.project)) continue;
      if (q.categories?.size && !q.categories.has(d.category)) continue;
      if (q.statuses?.size && !q.statuses.has(d.status)) continue;
      if (q.tags?.size) {
        const lt = new Set((d.tags || []).map((t) => t.toLowerCase()));
        if (![...q.tags].every((t) => lt.has(t.toLowerCase()))) continue;
      }
      if (!raw) { hits.push({ id: d.id, kind: d.kind, score: d.modifiedAt / 1e13, fields: [], snippet: firstLine(d), ranges: [], line: null, count: 0 }); continue; }
      if (q.mode === "exact") { const h = exact(e, raw, q.caseSensitive); if (h) hits.push(h); continue; }
      let score = 0;
      const fields = new Set();
      let ok = true;
      for (let k = 0; k < terms.length; k++) {
        const term = terms[k], st = stems[k];
        let s = 0;
        for (const f of ["title", "tags", "summary", "category", "folder"]) {
          const txt = e[f];
          if (txt.includes(term)) { s += W[f] * (boundary(txt, term) ? 1.5 : 1); fields.add(f); }
          else if (st !== term && txt.includes(st)) { s += W[f] * 0.6; fields.add(f); }
        }
        if (e.content.includes(term) || (st !== term && e.content.includes(st))) {
          const f = d.kind === "script" ? "code" : "content";
          s += W[f] * (1 + Math.log2(Math.max(1, Math.min(10, occurrences(e.content, term.length >= 3 ? term : st)))));
          fields.add(f);
        } else if (e.words && e.words.includes(st)) { s += W.code; fields.add("code"); }
        if (!s) { ok = false; break; }
        score += s;
      }
      if (!ok) continue;
      const phrase = terms.join(" ");
      if (terms.length > 1 && (e.title.includes(phrase) || e.content.includes(phrase))) score *= 1.5;
      if (d.isFavorite) score *= 1.1;
      score += d.modifiedAt / 1e13;
      const sn = snippet(d.content || "", [...terms, ...stems.filter((x) => !terms.includes(x))], false);
      hits.push({ id: d.id, kind: d.kind, score, fields: Object.keys(W).filter((f) => fields.has(f)), snippet: sn.text || firstLine(d), ranges: sn.text ? sn.ranges : [], line: sn.line, count: sn.count });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}

function boundary(text, term) {
  const i = text.indexOf(term);
  return i === 0 || (i > 0 && !/[\p{L}\p{N}]/u.test(text[i - 1]));
}
function occurrences(text, term) {
  if (!term) return 0;
  let n = 0, i = 0;
  while ((i = text.indexOf(term, i)) >= 0 && n < 50) { n++; i += term.length; }
  return n;
}
function firstLine(d) {
  if (d.summary) return d.summary;
  const l = (d.content || "").split("\n").find((x) => x.trim());
  return (l || "").trim().slice(0, 140);
}
function exact(e, needle, cs) {
  const d = e.d;
  const has = (s) => cs ? (s || "").includes(needle) : (s || "").toLowerCase().includes(needle.toLowerCase());
  const fields = [];
  if (has(d.title)) fields.push("title");
  if (has(d.summary)) fields.push("summary");
  if (has((d.tags || []).join(" "))) fields.push("tags");
  if (has((d.folderPath || []).join("/"))) fields.push("folder");
  if (has(d.content)) fields.push(d.kind === "script" ? "code" : "content");
  if (!fields.length) return null;
  const sn = snippet(d.content || "", [needle], cs);
  return { id: d.id, kind: d.kind, score: fields.reduce((a, f) => a + W[f], 0) + sn.count, fields, snippet: sn.text || firstLine(d), ranges: sn.ranges, line: sn.line, count: sn.count };
}

export function snippet(content, terms, cs) {
  if (!content || !terms.length) return { text: "", ranges: [], line: null, count: 0 };
  const norm = (s) => (cs ? s : s.toLowerCase());
  const nterms = terms.map(norm).filter(Boolean);
  let best = null, total = 0;
  const lines = content.split("\n");
  for (let n = 0; n < lines.length && total <= 200; n++) {
    const l = norm(lines[n]);
    if (nterms.some((t) => l.includes(t))) { total++; if (!best) best = { line: lines[n], no: n + 1 }; }
  }
  if (!best) return { text: "", ranges: [], line: null, count: 0 };
  let text = best.line.trim();
  if (text.length > 160) {
    const i = Math.max(0, norm(text).indexOf(nterms[0]) - 50);
    text = (i > 0 ? "…" : "") + text.slice(i, i + 160) + "…";
  }
  const ranges = [];
  const lt = norm(text);
  for (const t of nterms) { let i = 0; while ((i = lt.indexOf(t, i)) >= 0) { ranges.push([i, i + t.length]); i += t.length; } }
  ranges.sort((a, b) => a[0] - b[0]);
  return { text, ranges, line: best.no, count: total };
}
