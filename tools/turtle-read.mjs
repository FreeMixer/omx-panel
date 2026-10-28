// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * turtle-read.mjs — the one Turtle READER the tools use (W3C RDF 1.1 Turtle): directives
 * (`@prefix`, `@base`, `PREFIX`, `BASE`), IRIs resolved against the file's base, prefixed names,
 * `a`, blank-node property lists, collections, literals with a language tag or a datatype, numbers
 * and booleans. It reads what an LV2 bundle writes; anything outside the grammar is a thrown error
 * naming the line, never a silent skip. tools/modgui-import.mjs reads a bundle through it.
 *
 * Pure: text in, triples out. A term is { t: 'iri', v } | { t: 'bnode', v } | { t: 'lit', v, dt?, lang? }.
 */

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const TOKEN = [
  ['ws', /\s+|#[^\n]*/y],
  ['iri', /<([^<>"{}|^`\\\x00-\x20]*)>/y],
  ['long', /"""((?:[^"\\]|\\[\s\S]|"(?!""))*)"""|'''((?:[^'\\]|\\[\s\S]|'(?!''))*)'''/y],
  ['str', /"((?:[^"\\\n\r]|\\.)*)"|'((?:[^'\\\n\r]|\\.)*)'/y],
  ['dtype', /\^\^/y],
  ['directive', /@(prefix|base)\b/y],
  ['lang', /@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)/y],
  ['num', /[+-]?(?:\d+\.\d*[eE][+-]?\d+|\.?\d+[eE][+-]?\d+|\d*\.\d+|\d+)/y],
  ['bnode', /_:([A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?)/y],
  ['pname', /([A-Za-z](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?)?:((?:[A-Za-z0-9_:%-]|\\[-_~.!$&'()*+,;=/?#@%]|\.(?=[A-Za-z0-9_:%-]))*)/y],
  ['punct', /[[\]();,.]/y],
  ['word', /[A-Za-z]+/y],
];

function unescape(s) {
  return s.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[tbnrf"'\\])/g, (_, e) => {
    if (e[0] === 'u' || e[0] === 'U') return String.fromCodePoint(parseInt(e.slice(1), 16));
    return { t: '\t', b: '\b', n: '\n', r: '\r', f: '\f', '"': '"', "'": "'", '\\': '\\' }[e];
  });
}

function tokenize(text) {
  const out = [];
  let pos = 0;
  let line = 1;
  while (pos < text.length) {
    let hit = null;
    for (const [kind, re] of TOKEN) {
      re.lastIndex = pos;
      const m = re.exec(text);
      if (m) {
        hit = { kind, m };
        break;
      }
    }
    if (!hit) throw new Error(`line ${line}: unexpected '${text.slice(pos, pos + 20)}'`);
    const { kind, m } = hit;
    if (kind !== 'ws') out.push({ kind, m, line });
    line += (m[0].match(/\n/g) ?? []).length;
    pos += m[0].length;
  }
  return out;
}

/** Parse Turtle `text` read from `base` (a URL); returns its triples in document order. */
export function parseTurtle(text, base) {
  const toks = tokenize(text);
  const prefixes = new Map();
  const triples = [];
  let baseIri = base;
  let i = 0;
  let blank = 0;

  const peek = () => toks[i];
  const fail = (msg) => {
    const t = toks[Math.min(i, toks.length - 1)];
    throw new Error(`line ${t ? t.line : 0}: ${msg}`);
  };
  const take = () => toks[i++] ?? fail('unexpected end of file');
  const isPunct = (ch) => peek()?.kind === 'punct' && peek().m[0] === ch;
  const expect = (ch) => (isPunct(ch) ? i++ : fail(`expected '${ch}'`));
  // An absolute IRI is the IRI as written (Turtle, RFC 3987; serd and so lilv keep it): only a relative reference is
  // resolved against the base. URL's parser would rewrite an absolute one (a lower-cased host, a trailing '/' after a
  // bare authority), which names a different plugin: https://www.ElephantDSP.com/plugins/Room_Reverb is one.
  const resolve = (rel) => {
    const iri = unescape(rel);
    return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(iri) ? iri : new URL(iri, baseIri).href;
  };
  const newBlank = () => ({ t: 'bnode', v: `b${blank++}` });

  function pname(tok) {
    const ns = prefixes.get(tok.m[1] ?? '');
    if (ns === undefined) fail(`undeclared prefix '${tok.m[1] ?? ''}:'`);
    return { t: 'iri', v: ns + tok.m[2].replace(/\\(.)/g, '$1') };
  }

  function iriTerm() {
    const tok = take();
    if (tok.kind === 'iri') return { t: 'iri', v: resolve(tok.m[1]) };
    if (tok.kind === 'pname') return pname(tok);
    if (tok.kind === 'word' && tok.m[0] === 'a') return { t: 'iri', v: `${RDF}type` };
    return fail(`expected an IRI, got '${tok.m[0]}'`);
  }

  function literal(tok) {
    const raw = tok.kind === 'long' || tok.kind === 'str' ? (tok.m[1] ?? tok.m[2]) : null;
    if (raw !== null) {
      const v = unescape(raw);
      if (peek()?.kind === 'lang') return { t: 'lit', v, lang: take().m[1] };
      if (peek()?.kind === 'dtype') {
        i++;
        return { t: 'lit', v, dt: iriTerm().v };
      }
      return { t: 'lit', v, dt: `${XSD}string` };
    }
    if (tok.kind === 'num') {
      const s = tok.m[0];
      const dt = /[eE]/.test(s) ? 'double' : s.includes('.') ? 'decimal' : 'integer';
      return { t: 'lit', v: s, dt: `${XSD}${dt}` };
    }
    if (tok.kind === 'word' && (tok.m[0] === 'true' || tok.m[0] === 'false')) return { t: 'lit', v: tok.m[0], dt: `${XSD}boolean` };
    return null;
  }

  function object() {
    const tok = peek() ?? fail('expected an object');
    if (isPunct('[')) return blankList();
    if (isPunct('(')) return collection();
    if (tok.kind === 'bnode') return (i++, { t: 'bnode', v: `_${tok.m[1]}` });
    if (tok.kind === 'iri' || tok.kind === 'pname') return iriTerm();
    i++;
    return literal(tok) ?? fail(`unexpected '${tok.m[0]}'`);
  }

  function collection() {
    expect('(');
    const items = [];
    while (!isPunct(')')) items.push(object());
    i++;
    if (items.length === 0) return { t: 'iri', v: `${RDF}nil` };
    const head = newBlank();
    let node = head;
    items.forEach((item, k) => {
      triples.push({ s: node, p: { t: 'iri', v: `${RDF}first` }, o: item });
      const next = k === items.length - 1 ? { t: 'iri', v: `${RDF}nil` } : newBlank();
      triples.push({ s: node, p: { t: 'iri', v: `${RDF}rest` }, o: next });
      node = next;
    });
    return head;
  }

  function blankList() {
    expect('[');
    const node = newBlank();
    if (!isPunct(']')) predicateObjectList(node);
    expect(']');
    return node;
  }

  function predicateObjectList(subject) {
    for (;;) {
      const p = iriTerm();
      for (;;) {
        triples.push({ s: subject, p, o: object() });
        if (!isPunct(',')) break;
        i++;
      }
      if (!isPunct(';')) return;
      while (isPunct(';')) i++;
      if (isPunct('.') || isPunct(']') || !peek()) return;
    }
  }

  function directive(kind, sparql) {
    if (kind === 'prefix') {
      const tok = take();
      if (tok.kind !== 'pname' || tok.m[2] !== '') fail('expected a prefix name');
      const iri = take();
      if (iri.kind !== 'iri') fail('expected the prefix IRI');
      prefixes.set(tok.m[1] ?? '', resolve(iri.m[1]));
    } else {
      const iri = take();
      if (iri.kind !== 'iri') fail('expected the base IRI');
      baseIri = resolve(iri.m[1]);
    }
    if (!sparql) expect('.');
  }

  while (i < toks.length) {
    const tok = peek();
    if (tok.kind === 'directive') {
      i++;
      directive(tok.m[1], false);
      continue;
    }
    if (tok.kind === 'word' && /^(prefix|base)$/i.test(tok.m[0])) {
      i++;
      directive(tok.m[0].toLowerCase(), true);
      continue;
    }
    if (isPunct('[')) {
      const node = blankList();
      if (!isPunct('.')) predicateObjectList(node);
    } else {
      const s = tok.kind === 'bnode' ? (i++, { t: 'bnode', v: `_${tok.m[1]}` }) : isPunct('(') ? collection() : iriTerm();
      predicateObjectList(s);
    }
    expect('.');
  }
  return triples;
}
