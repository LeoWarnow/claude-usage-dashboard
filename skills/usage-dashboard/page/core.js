// Claude Usage Dashboard: shared helpers, theme, navigation, calculations and summary figures.

const BX = (window.BX = window.BX || {});
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
BX.day = (s) => String(s == null ? '' : s).slice(0, 10);
BX.parse = d3.utcParse('%Y-%m-%d');
BX.key = d3.utcFormat('%Y-%m-%d');
BX.num = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : +v);
BX.fmt = (v) => (BX.num(v) == null ? '—' : Math.abs(+v) >= 10000 ? compact.format(+v) : d3.format(',')(Math.round(+v)));
BX.tok = (v) => (BX.num(v) == null ? '—' : Math.abs(+v) >= 1000 ? compact.format(+v) : d3.format(',')(Math.round(+v)));
BX.hours = (v) => (BX.num(v) == null ? '—' : +v < 100 ? d3.format('.1f')(+v) : d3.format(',.0f')(+v));
BX.usd = (v) => (BX.num(v) == null ? '—' : +v >= 1000 ? '$' + compact.format(+v) : +v >= 100 ? '$' + d3.format(',.0f')(+v) : '$' + d3.format(',.2f')(+v));
BX.usdAxis = (v) => (+v >= 1000 ? '$' + compact.format(+v) : '$' + d3.format(',.0f')(+v));
BX.pct = (v) => (BX.num(v) == null ? '—' : +v >= 0.995 && +v < 1 ? '>99%' : Math.abs(+v) < 0.1 && +v !== 0 ? d3.format('.1%')(+v) : d3.format('.0%')(+v));
BX.medDay = d3.utcFormat('%b %-d, %Y');
BX.shortDay = d3.utcFormat('%a, %b %-d');
BX.longDay = d3.utcFormat('%A, %B %-d, %Y');
BX.hh = (h) => `${String(h).padStart(2, '0')}:00`;
BX.PERIODS = ['7d', '30d', '90d', 'all'];
BX.VIEWS = ['overview', 'activity', 'models', 'work', 'delegation', 'value', 'projects', 'method'];
BX.MEASURE = {
  output: { unit: 'output tokens', fmt: BX.tok, tokenish: true },
  tokens: { unit: 'tokens', fmt: BX.tok, tokenish: true },
  cost_usd: { unit: 'API-equivalent', fmt: BX.usd, tokenish: true },
  active_hours: { unit: 'active hours', fmt: BX.hours },
  sessions: { unit: 'sessions', fmt: BX.fmt },
  prompts: { unit: 'prompts', fmt: BX.fmt },
  subagents: { unit: 'sub-agents', fmt: BX.fmt },
};
BX.params = () => {
  const p = dash.params() || {};
  return {
    view: BX.VIEWS.includes(p.view) ? p.view : 'overview',
    period: BX.PERIODS.includes(p.period) ? p.period : '30d',
    measure: BX.MEASURE[p.measure] ? p.measure : 'output',
    color: p.color === 'model' ? 'model' : 'volume',
    mix: p.mix === 'share' ? 'share' : 'volume',
    mode: p.mode === 'light' || p.mode === 'dark' ? p.mode : 'auto',
    day: p.day || null,
    project: p.project || null,
  };
};
// "1 session", "2 sessions": v may be a number or an already formatted count.
BX.SINGULAR = { days: 'day', sessions: 'session', prompts: 'prompt', 'sub-agents': 'sub-agent', requests: 'request', agents: 'agent' };
BX.count = (v, unit) => `${v} ${String(v).replace(/,/g, '') === '1' ? BX.SINGULAR[unit] || unit : unit}`;
BX.motion = () => !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---- Theme: the page scopes its own tokens, so light and dark can be forced inside it.
BX.PALETTE = {
  light: ['#1B3A6B', '#0E7C7B', '#C08A1E', '#C2553D', '#6B5B95', '#4F86B8', '#7A8B3A', '#8A94A6'],
  dark: ['#86AEE8', '#3FC1BE', '#E6B04B', '#EB8A71', '#AA9AD9', '#8DBCE3', '#AEC25F', '#A3ADBE'],
};
BX.root = () => document.getElementById('review');
BX.theme = () => {
  const mode = BX.params().mode;
  if (mode !== 'auto') return mode;
  const el = BX.root();
  const bg = el ? getComputedStyle(el).getPropertyValue('--color-bg').trim() : '';
  const c = bg ? d3.color(bg) : null;
  if (!c) return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const { r, g, b } = c.rgb();
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
};
BX.col = (i) => `var(--bx-c${i % 8})`;
BX.accent = () => BX.col(0);
BX.ramp = (level) => `var(--bx-h${level})`;
BX.rampText = (level) => `var(--bx-t${level})`;
// In Auto the page follows the app: mark the wrapper dark when the app's background is dark.
BX.syncTheme = () => {
  const el = BX.root();
  if (!el) return;
  const mode = BX.params().mode;
  el.classList.toggle('is-light', mode === 'light');
  el.classList.toggle('is-dark', mode === 'dark');
  if (mode !== 'auto') { el.classList.remove('is-auto-dark'); return; }
  el.classList.remove('is-auto-dark');
  el.classList.toggle('is-auto-dark', BX.theme() === 'dark');
};

BX.status = (ids) => {
  const s = ids.map((id) => dash.data(id).status);
  if (s.every((x) => x === 'ok')) return 'ok';
  if (s.some((x) => x === 'loading' || x === undefined)) return 'loading';
  return 'error';
};
BX.rows = (id) => {
  const d = dash.data(id);
  return d.status === 'ok' && Array.isArray(d.data) ? d.data : [];
};
BX.el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
BX.ALL = ['usage_daily', 'sessions', 'subagents', 'hourly', 'summary'];
BX.guard = (el, ids) => {
  const st = BX.status(ids || BX.ALL);
  el.classList.toggle('dash-skeleton', st === 'loading');
  if (st === 'ok') return true;
  el.replaceChildren();
  if (st === 'error') {
    const p = BX.el('p', 'bx-fail');
    p.append(BX.el('span', 'bx-fail-dot'), 'Failed to load');
    el.append(p);
  }
  return false;
};
BX.swatch = (color, cls) => {
  const s = BX.el('span', 'bx-sw' + (cls ? ' ' + cls : ''));
  s.style.background = color;
  return s;
};
BX.tipBox = (host) => {
  const t = BX.el('div', 'bx-tip');
  t.hidden = true;
  host.append(t);
  return t;
};
BX.place = (tip, host, event) => {
  const box = host.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = event.clientX - box.left + 16, y = event.clientY - box.top + 16;
  if (x + w > box.width) x = event.clientX - box.left - w - 16;
  if (y + h > box.height + 60) y = event.clientY - box.top - h - 12;
  tip.style.left = Math.max(0, Math.min(x, box.width - w)) + 'px';
  tip.style.top = Math.max(-60, y) + 'px';
};
BX.tipRow = (tip, color, name, value) => {
  const r = BX.el('div', 'bx-tip-r');
  r.append(color ? BX.swatch(color) : BX.el('span'), BX.el('span', null, name), BX.el('span', null, value));
  tip.append(r);
};
BX.measureText = (svg, texts, cls) => {
  const t = svg.append('text').attr('class', cls || null).style('visibility', 'hidden');
  const w = d3.max(texts, (s) => t.text(s).node().getComputedTextLength()) || 0;
  t.remove();
  return w;
};
BX.svg = (el, W, H, label) => {
  const svg = d3.create('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', label);
  el.replaceChildren(svg.node());
  return svg;
};
BX.grid = (svg, y, ticks, x0, x1, fmt) => {
  svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', x0).attr('x2', x1).attr('y1', y).attr('y2', y)
    .attr('stroke-width', 1).style('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('text').data(ticks).join('text').attr('x', x0 - 8).attr('y', (d) => y(d) + 3.5).attr('text-anchor', 'end').text(fmt);
};
BX.scrollTop = () => {
  const r = BX.root();
  if (r && r.getBoundingClientRect().top < 0) r.scrollIntoView({ behavior: BX.motion() ? 'smooth' : 'auto', block: 'start' });
};
// Open a view; from anything but the tab strip, focus moves to the view's title.
BX.go = (view, extra, opts) => {
  const o = opts || {};
  dash.setParams({ view, ...(extra || {}) });
  dash.setLink(view);
  BX.scrollTop();
  setTimeout(() => {
    const target = o.target && document.getElementById(o.target);
    if (target) target.scrollIntoView({ behavior: BX.motion() ? 'smooth' : 'auto', block: 'start' });
    if (!o.fromTabs) {
      const h = document.querySelector(`#view-${view} [data-focus]:not([hidden])`);
      if (h) h.focus({ preventScroll: true });
    }
  }, 80);
};
BX.goDay = (k) => { if (k) BX.go('activity', { day: k }); };

// ---- Period windows come from the collector's summary (it knows "today").
BX.windows = () => {
  const w = {};
  BX.rows('summary').forEach((r) => { if (r.metric === 'sessions') w[r.period] = { from: BX.day(r.from), to: BX.day(r.to) }; });
  return w;
};
BX.win = (period) => BX.windows()[period || BX.params().period] || null;
BX.inWin = (period) => {
  const w = BX.win(period);
  return (k) => !!w && BX.day(k) >= w.from && BX.day(k) <= w.to;
};
BX.prevWin = (period) => {
  const p = period || BX.params().period;
  const w = BX.win(p);
  if (!w || p === 'all') return null;
  const n = { '7d': 7, '30d': 30, '90d': 90 }[p];
  const from = d3.utcDay.offset(BX.parse(w.from), -n);
  return { from: BX.key(from), to: BX.key(d3.utcDay.offset(BX.parse(w.from), -1)) };
};
BX.weekly = (period) => ['all', '90d'].includes(period || BX.params().period);
BX.buckets = (period) => {
  const w = BX.win(period);
  if (!w) return { keys: [], weekly: false, of: () => null };
  const weekly = BX.weekly(period);
  const s = BX.parse(w.from), e = BX.parse(w.to);
  const keys = (weekly ? d3.utcMonday.range(d3.utcMonday.floor(s), d3.utcDay.offset(e, 1)) : d3.utcDay.range(s, d3.utcDay.offset(e, 1))).map(BX.key);
  return { keys, weekly, of: (k) => (weekly ? BX.key(d3.utcMonday.floor(BX.parse(BX.day(k)))) : BX.day(k)) };
};
BX.bucketLabel = (b, weekly) => (weekly ? `Week of ${d3.utcFormat('%b %-d, %Y')(BX.parse(b))}` : BX.shortDay(BX.parse(b)));
BX.xTicks = (keys, weekly, x, minGap, W) => {
  const out = [];
  keys.forEach((k, i) => {
    const d = BX.parse(k);
    const want = weekly ? i === 0 || BX.parse(keys[i - 1]).getUTCMonth() !== d.getUTCMonth() : true;
    const px = x(k);
    if (want && (!out.length || px - out[out.length - 1].px >= minGap) && px + 22 <= W && px - 22 >= 0) out.push({ px, t: d3.utcFormat(weekly ? '%b' : '%b %-d')(d) });
  });
  return out;
};

// ---- One pass over the sources: per day, per model, every measure.
let memo = null;
BX.index = () => {
  const U = BX.rows('usage_daily'), S = BX.rows('sessions'), A = BX.rows('subagents'), H = BX.rows('hourly');
  if (memo && memo.U === U && memo.S === S && memo.A === A && memo.H === H) return memo.ix;
  const days = new Map(), names = new Map(), weight = new Map(), span = new Map();
  const get = (k) => {
    let r = days.get(k);
    if (!r) days.set(k, (r = { m: new Map(), hours: new Array(24).fill(0), tokenless: false, sids: new Set() }));
    return r;
  };
  const atom = (r, model) => {
    let a = r.m.get(model);
    if (!a) r.m.set(model, (a = { output: 0, tokens: 0, cost_usd: 0, requests: 0, fresh: 0, cache_read: 0, cache_write: 0, sub_output: 0, active_hours: 0, sessions: 0, prompts: 0, subagents: 0, direct: 0, workflow: 0 }));
    return a;
  };
  for (const u of U) {
    const model = u.model || '';
    const k = BX.day(u.date);
    const a = atom(get(k), model);
    const i = +u.input || 0, o = +u.output || 0, cr = +u.cache_read || 0, cw = +u.cache_write || 0;
    a.output += o; a.fresh += i; a.cache_read += cr; a.cache_write += cw; a.tokens += i + o + cr + cw;
    a.requests += +u.requests || 0; a.cost_usd += +u.cost_usd || 0;
    if (u.role === 'subagent') a.sub_output += o;
    names.set(model, u.model_name || model);
    weight.set(model, (weight.get(model) || 0) + o);
    const sp = span.get(model) || [k, k];
    span.set(model, [k < sp[0] ? k : sp[0], k > sp[1] ? k : sp[1]]);
  }
  for (const s of S) {
    const model = s.model || '';
    const r = get(BX.day(s.date));
    const a = atom(r, model);
    a.sessions += 1; a.prompts += +s.prompts || 0; a.active_hours += (+s.active_min || 0) / 60;
    r.sids.add(s.session);
    if (s.tokens_known === false || s.tokens_known === 'false') r.tokenless = true;
    if (!names.has(model)) names.set(model, s.model_name || model || 'Unknown');
  }
  for (const x of A) {
    const a = atom(get(BX.day(x.date)), x.model || '');
    a.subagents += 1;
    if (x.workflow) a.workflow += 1; else a.direct += 1;
  }
  for (const h of H) {
    const hr = +h.hour;
    if (hr >= 0 && hr < 24) get(BX.day(h.date)).hours[hr] += +h.requests || 0;
  }
  const keys = [...days.keys()].sort();
  const models = [...weight.entries()].sort((a, b) => b[1] - a[1]).map((d) => d[0]).filter((m) => m);
  const atoms = (k) => { const r = days.get(k); return r ? [...r.m.entries()] : []; };
  const ix = {
    days, names, models, span, atoms, first: keys[0], last: keys[keys.length - 1],
    value: (k, f) => atoms(k).reduce((t, [, a]) => t + a[f], 0),
    split: (k, f) => atoms(k).map(([m, a]) => ({ model: m, v: a[f] })).filter((d) => d.v > 0).sort((a, b) => b.v - a.v),
    active: (k) => { const r = days.get(k); return !!r && [...r.m.values()].some((a) => a.requests || a.prompts || a.sessions); },
    sum: (inW, f) => { let t = 0; days.forEach((r, k) => { if (inW(k)) r.m.forEach((a) => { t += a[f]; }); }); return t; },
    distinct: (keys) => { const u = new Set(); keys.forEach((k) => { const r = days.get(k); if (r) r.sids.forEach((x) => u.add(x)); }); return u.size; },
  };
  memo = { U, S, A, H, ix };
  return ix;
};
BX.color = (model) => {
  const i = BX.index().models.indexOf(model);
  return i >= 0 && i < 6 ? BX.col(i + 1) : BX.col(7);
};
BX.name = (model) => (model ? BX.index().names.get(model) || model : 'Unknown model');
BX.selDay = () => {
  const p = BX.params(), ix = BX.index();
  if (p.day && BX.parse(p.day)) return p.day;
  const w = BX.win(p.period);
  const end = w ? w.to : ix.last;
  const keys = [...ix.days.keys()].filter((k) => k <= end && ix.active(k)).sort();
  return keys[keys.length - 1] || ix.last || null;
};
// Values for one bucket table: rows of {b, [model or '_']: value}.
BX.bucketTable = (period, field, perModel) => {
  const ix = BX.index(), b = BX.buckets(period), inW = BX.inWin(period);
  const rows = new Map(b.keys.map((k) => [k, { b: k }]));
  const seen = new Map();
  ix.days.forEach((r, k) => {
    if (!inW(k)) return;
    const row = rows.get(b.of(k));
    if (!row) return;
    if (field === 'sessions' && !perModel) {
      const u = seen.get(row.b) || new Set();
      r.sids.forEach((x) => u.add(x));
      seen.set(row.b, u);
      row._ = u.size;
      return;
    }
    r.m.forEach((a, model) => {
      const key = perModel ? model : '_';
      row[key] = (row[key] || 0) + a[field];
    });
  });
  return { rows: [...rows.values()], keys: b.keys, weekly: b.weekly };
};

// ---- Calculations ---------------------------------------------------------

dash.calc('daily', {
  title: 'Totals per day',
  description: 'Every model, session and sub-agent added up for each day.',
  inputs: ['usage_daily', 'sessions', 'subagents'],
  fn: (usage_daily, sessions, subagents) => {
    const by = new Map();
    const at = (d) => {
      const k = String(d).slice(0, 10);
      if (!by.has(k)) by.set(k, { date: k, output: 0, thinking: 0, tokens: 0, requests: 0, cost_usd: 0, active_hours: 0, lines_added: 0, sessions: 0, prompts: 0, subagents: 0 });
      return by.get(k);
    };
    usage_daily.forEach((r) => {
      const t = at(r.date);
      t.output += +r.output || 0; t.thinking += +r.thinking || 0; t.requests += +r.requests || 0; t.cost_usd += +r.cost_usd || 0;
      t.tokens += (+r.input || 0) + (+r.output || 0) + (+r.cache_read || 0) + (+r.cache_write || 0);
    });
    sessions.forEach((r) => {
      const t = at(r.date);
      t.sessions += 1; t.prompts += +r.prompts || 0; t.active_hours += (+r.active_min || 0) / 60; t.lines_added += +r.lines_added || 0;
    });
    subagents.forEach((r) => { at(r.date).subagents += 1; });
    return [...by.values()].map((t) => ({ ...t, cost_usd: Math.round(t.cost_usd * 100) / 100, active_hours: Math.round(t.active_hours * 10) / 10 }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  },
});

dash.calc('model_table', {
  title: 'Models by period',
  description: 'Output, requests and API-equivalent value per model for each reporting period, with its share of output and first and last day of use.',
  inputs: ['usage_daily', 'summary'],
  fn: (usage_daily, summary) => {
    const day = (s) => String(s).slice(0, 10);
    const span = {};
    usage_daily.forEach((r) => {
      const s = span[r.model] || (span[r.model] = { first: day(r.date), last: day(r.date), name: r.model_name || r.model });
      if (day(r.date) < s.first) s.first = day(r.date);
      if (day(r.date) > s.last) s.last = day(r.date);
    });
    const out = [];
    summary.filter((s) => s.metric === 'sessions').forEach((w) => {
      const by = {};
      usage_daily.filter((r) => day(r.date) >= day(w.from) && day(r.date) <= day(w.to)).forEach((r) => {
        const t = by[r.model] || (by[r.model] = { output: 0, requests: 0, cost_usd: 0 });
        t.output += +r.output || 0; t.requests += +r.requests || 0; t.cost_usd += +r.cost_usd || 0;
      });
      const total = Object.values(by).reduce((a, t) => a + t.output, 0);
      Object.entries(by).sort((a, b) => b[1].output - a[1].output).forEach(([model, t], i) => {
        out.push({ key: `${w.period}|${model}`, period: w.period, rank: i + 1, model, model_name: span[model].name,
          first_used: span[model].first, last_used: span[model].last, share: total ? t.output / total : 0,
          output: t.output, requests: t.requests, cost_usd: Math.round(t.cost_usd * 100) / 100 });
      });
    });
    return out;
  },
});

dash.calc('tool_mix', {
  title: 'Tool calls by kind of work',
  description: 'Tool calls per work category for each reporting period, with its share and the most used tools in it.',
  inputs: ['tools', 'summary'],
  fn: (tools, summary) => {
    const day = (s) => String(s).slice(0, 10);
    const out = [];
    summary.filter((s) => s.metric === 'sessions').forEach((w) => {
      const cat = {};
      tools.filter((r) => day(r.date) >= day(w.from) && day(r.date) <= day(w.to)).forEach((r) => {
        const c = cat[r.category] || (cat[r.category] = { calls: 0, tools: {} });
        c.calls += +r.calls || 0;
        c.tools[r.tool] = (c.tools[r.tool] || 0) + (+r.calls || 0);
      });
      const total = Object.values(cat).reduce((a, c) => a + c.calls, 0);
      Object.entries(cat).sort((a, b) => b[1].calls - a[1].calls).forEach(([category, c], i) => {
        const top = Object.entries(c.tools).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} ${n.toLocaleString('en')}`).join(' · ');
        out.push({ key: `${w.period}|${category}`, period: w.period, rank: i + 1, category, calls: c.calls, share: total ? c.calls / total : 0, top_tools: top });
      });
    });
    return out;
  },
});

dash.calc('workflows', {
  title: 'Multi-agent workflows',
  description: 'One row per workflow: its day, parent session, agents launched, output tokens and API-equivalent value.',
  inputs: ['subagents', 'sessions'],
  fn: (subagents, sessions) => {
    const titles = {};
    sessions.forEach((s) => { titles[s.session] = s.title; });
    const by = {};
    subagents.filter((a) => a.workflow).forEach((a) => {
      const d = String(a.date).slice(0, 10);
      const w = by[a.workflow] || (by[a.workflow] = { workflow: a.workflow, date: d, session: a.session, title: titles[a.session] || 'Untitled session', agents: 0, output: 0, cost_usd: 0 });
      w.agents += 1; w.output += +a.output || 0; w.cost_usd += +a.cost_usd || 0;
      if (d < w.date) w.date = d;
    });
    return Object.values(by).map((w) => ({ ...w, cost_usd: Math.round(w.cost_usd * 100) / 100 })).sort((a, b) => b.agents - a.agents);
  },
});

dash.calc('projects', {
  title: 'Projects by period',
  description: 'Sessions, active days, output and API-equivalent value per project folder for each reporting period.',
  inputs: ['sessions', 'summary'],
  fn: (sessions, summary) => {
    const day = (s) => String(s).slice(0, 10);
    const out = [];
    summary.filter((s) => s.metric === 'sessions').forEach((w) => {
      const by = {};
      sessions.filter((r) => day(r.date) >= day(w.from) && day(r.date) <= day(w.to)).forEach((r) => {
        const p = by[r.project] || (by[r.project] = { ids: new Set(), days: new Set(), output: 0, cost_usd: 0, active_hours: 0, subagents: 0 });
        p.ids.add(r.session); p.days.add(day(r.date));
        p.output += +r.output || 0; p.cost_usd += +r.cost_usd || 0; p.active_hours += (+r.active_min || 0) / 60; p.subagents += +r.subagents || 0;
      });
      const total = Object.values(by).reduce((a, p) => a + p.output, 0);
      Object.entries(by).sort((a, b) => b[1].output - a[1].output || b[1].ids.size - a[1].ids.size).forEach(([project, p], i) => {
        out.push({ key: `${w.period}|${project}`, period: w.period, rank: i + 1, project, sessions: p.ids.size, days: p.days.size,
          output: p.output, share: total ? p.output / total : 0, cost_usd: Math.round(p.cost_usd * 100) / 100,
          active_hours: Math.round(p.active_hours * 10) / 10, subagents: p.subagents });
      });
    });
    return out;
  },
});

dash.calc('insights', {
  title: 'What changed',
  description: 'For each reporting period: the largest change in each theme against the period before (volume, cost, delegation, efficiency), the busiest day, the leading or newly adopted model and the leading project.',
  inputs: ['summary', 'daily', 'model_table', 'projects'],
  fn: (summary, daily, model_table, projects) => {
    const day = (s) => String(s).slice(0, 10);
    const n = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toLocaleString('en'));
    const pct = (v) => Math.round(v * 100) + '%';
    const usd = (v) => '$' + Math.round(v).toLocaleString('en');
    const date = (k) => new Date(k + 'T00:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const M = {
      output: { label: 'Output tokens', theme: 'volume', view: 'models', f: n },
      active_hours: { label: 'Active hours', theme: 'volume', view: 'activity', f: (v) => v.toFixed(1) },
      sessions: { label: 'Sessions', theme: 'volume', view: 'activity', f: n },
      cost_usd: { label: 'API-equivalent cost', theme: 'cost', view: 'value', f: usd },
      subagents: { label: 'Sub-agents', theme: 'delegation', view: 'delegation', f: n },
      subagent_share: { label: 'Sub-agent share of output', theme: 'delegation', view: 'delegation', rate: true },
      cache_hit_rate: { label: 'Cache hit rate', theme: 'efficiency', view: 'value', rate: true, good: 1 },
    };
    const out = [];
    summary.filter((s) => s.metric === 'sessions').forEach((w) => {
      const P = w.period, from = day(w.from), to = day(w.to);
      const add = (kind, tone, title, detail, view, target, value) => out.push({ key: `${P}|${kind}`, period: P, rank: out.filter((o) => o.period === P).length + 1, kind, tone, title, detail, view, day: target || null, value });
      const rows = summary.filter((s) => s.period === P && M[s.metric] && s.prev != null && s.value != null);
      const moves = rows.map((s) => {
        const m = M[s.metric];
        const size = m.rate ? Math.abs(s.value - s.prev) * 10 : s.prev > 0 && s.value > 0 ? Math.abs(Math.log(s.value / s.prev)) : 0;
        return { s, m, size };
      }).filter((x) => x.size > 0.02);
      const best = {};
      moves.forEach((x) => { if (!best[x.m.theme] || x.size > best[x.m.theme].size) best[x.m.theme] = x; });
      if (best.volume && best.volume.s.metric !== 'output') { const o = moves.find((x) => x.s.metric === 'output'); if (o && o.size > 0.1) best.volume = o; }
      ['volume', 'cost', 'delegation', 'efficiency'].map((t) => best[t]).filter(Boolean).sort((a, b) => b.size - a.size).forEach((x, i) => {
        const { s, m } = x, up = s.value >= s.prev;
        let title, detail;
        if (m.rate) {
          const pts = Math.abs(s.value - s.prev) * 100;
          title = `${m.label} ${up ? 'up' : 'down'} ${pts.toFixed(1)} pts`;
          detail = `${pct(s.value)} against ${pct(s.prev)} in the period before.`;
          if (s.metric === 'cache_hit_rate' && !up) { const d = moves.find((y) => y.s.metric === 'subagent_share'); if (d && d.s.value > d.s.prev) detail += ' Sub-agents start from a fresh context, so more input is written to the cache instead of read from it.'; }
        } else {
          const r = s.value / s.prev;
          title = r >= 2 ? `${m.label} grew ${r.toFixed(1)}×` : `${m.label} ${up ? 'up' : 'down'} ${pct(Math.abs(r - 1))}`;
          detail = `${m.f(s.value)} against ${m.f(s.prev)} in the period before.`;
        }
        const tone = m.good ? (up ? 'good' : Math.abs(s.value - s.prev) >= 0.03 ? 'bad' : 'neutral') : 'neutral';
        add('move' + i, tone, title, detail, m.view, null, s.value);
      });
      const peak = daily.filter((d) => d.date >= from && d.date <= to).sort((a, b) => b.output - a.output)[0];
      if (peak && peak.output) add('peak', 'neutral', `Busiest day: ${date(peak.date)}`, `${n(peak.output)} output tokens, ${BX.count(peak.sessions, 'sessions')}, ${BX.count(peak.subagents, 'sub-agents')}.`, 'activity', peak.date, peak.output);
      const models = model_table.filter((m) => m.period === P);
      const fresh = P === 'all' ? null : models.filter((m) => m.first_used > from && m.share >= 0.05).sort((a, b) => b.share - a.share)[0];
      if (fresh) add('model', 'neutral', `New model: ${fresh.model_name}`, `First used ${date(fresh.first_used)}; wrote ${pct(fresh.share)} of output.`, 'models', null, fresh.share);
      else if (models[0]) add('model', 'neutral', `${models[0].model_name} leads`, `${models[0].share >= 0.995 && models[0].share < 1 ? '>99%' : pct(models[0].share)} of output across ${BX.count(n(models[0].requests), 'requests')}.`, 'models', null, models[0].share);
      const proj = projects.filter((p) => p.period === P && p.rank === 1)[0];
      if (proj) add('project', 'neutral', `Focus: ${proj.project}`, `${pct(proj.share)} of output across ${BX.count(proj.sessions, 'sessions')} on ${BX.count(proj.days, 'days')}.`, 'projects', null, proj.share);
    });
    return out;
  },
});

// ---- Controls and navigation (HTML; scripts only listen and set state) ---------

// Query inside the page only: the host marks its own elements with data-* attributes too.
const $$ = (sel) => (BX.root() || document).querySelectorAll(sel);
$$('[data-period]').forEach((b) => b.addEventListener('click', () => {
  const period = b.dataset.period;
  const p = BX.params();
  const keep = p.day && BX.inWin(period)(p.day);
  dash.setParams(keep ? { period } : { period, day: null });
}));
$$('[data-theme-choice]').forEach((b) => b.addEventListener('click', () => dash.setParams({ mode: b.dataset.themeChoice })));
$$('[data-view]').forEach((b) => {
  const fromTabs = b.getAttribute('role') === 'tab';
  const open = () => BX.go(b.dataset.view, b.dataset.measure ? { measure: b.dataset.measure } : {}, { fromTabs, target: b.dataset.target });
  b.addEventListener('click', open);
  if (b.getAttribute('role') === 'button') b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
});
$$('.bx-tabs').forEach((list) => list.addEventListener('keydown', (event) => {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[event.key];
  if (step == null) return;
  event.preventDefault();
  const next = tabs[(i + step + tabs.length) % tabs.length];
  next.focus();
  BX.go(next.dataset.view, {}, { fromTabs: true });
}));
$$('[data-color]').forEach((b) => b.addEventListener('click', () => dash.setParams({ color: b.dataset.color })));
$$('[data-mix]').forEach((b) => b.addEventListener('click', () => dash.setParams({ mix: b.dataset.mix })));
$$('#bx-measure').forEach((s) => s.addEventListener('change', () => dash.setParams({ measure: s.value })));
$$('[data-step]').forEach((b) => b.addEventListener('click', () => {
  if (BX.status(BX.ALL) !== 'ok') return;
  const ix = BX.index();
  const keys = [...ix.days.keys()].filter((k) => ix.active(k)).sort();
  const cur = BX.selDay();
  const next = +b.dataset.step > 0 ? keys.find((k) => k > cur) : [...keys].reverse().find((k) => k < cur);
  if (next) dash.setParams({ day: next });
}));
// A link that names a view (#models) opens it; #day opens the activity view.
(() => {
  const h = (location.hash || '').slice(1);
  if (BX.VIEWS.includes(h) && h !== BX.params().view) dash.setParams({ view: h });
  else if (h === 'day') dash.setParams({ view: 'activity' });
})();

dash.onData(() => {
  const p = BX.params();
  BX.syncTheme();
  $$('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === p.period)));
  $$('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === p.mode)));
  $$('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === p.color)));
  $$('[data-mix]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mix === p.mix)));
  $$('.bx-tabs [data-view]').forEach((b) => {
    const on = b.dataset.view === p.view;
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
    if (on && b.parentElement && b.parentElement.scrollWidth > b.parentElement.clientWidth) {
      const l = b.parentElement;
      const x = b.offsetLeft - l.offsetLeft;
      if (x < l.scrollLeft || x + b.offsetWidth > l.scrollLeft + l.clientWidth) l.scrollLeft = Math.max(0, x - 24);
    }
  });
  $$('.bx-view').forEach((s) => { s.hidden = s.id !== 'view-' + p.view; });
  $$('#bx-measure').forEach((s) => { if (s !== document.activeElement) s.value = p.measure; });
  const all = p.period === 'all';
  $$('.bx-when-compare').forEach((e) => { e.hidden = all; });
  $$('.bx-when-all').forEach((e) => { e.hidden = !all; });
  $$('.bx-delta').forEach((e) => { e.hidden = all; });
});
// The app's own theme can change while the page is open.
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', () => BX.syncTheme());
}
new MutationObserver(() => BX.syncTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] });

// ---- Figures from the summary --------------------------------------------------

BX.sumRow = (period, metric) => BX.rows('summary').find((r) => r.period === period && r.metric === metric) || null;
const fromSummary = (el, fmt, field) => {
  const p = BX.params();
  const metric = el.dataset.metric;
  el.setAttribute('data-where', `period=${p.period}&metric=${metric}`);
  const r = BX.sumRow(p.period, metric);
  const v = r ? r[field || el.dataset.field] : null;
  el.textContent = v == null || v === '' ? '—' : fmt(v, r);
};
BX.SHARE = new Set(['cache_hit_rate', 'subagent_share']);
BX.TOKEN = new Set(['output', 'tokens', 'output_per_prompt']);
BX.valFmt = (metric) => (metric === 'active_hours' ? BX.hours : metric === 'cost_usd' ? BX.usd : BX.SHARE.has(metric) ? BX.pct : BX.TOKEN.has(metric) ? BX.tok : BX.fmt);

BX.fromSummary = fromSummary;
dash.draw('pct-prev', (el) => fromSummary(el, BX.pct));
dash.draw('date', (el) => {
  const w = new URLSearchParams(el.getAttribute('data-where') || '');
  const r = BX.sumRow(w.get('period'), w.get('metric'));
  const v = r ? r[el.dataset.field] : null;
  el.textContent = v ? BX.medDay(BX.parse(BX.day(v))) : '—';
});
dash.draw('period-date', (el) => {
  const p = BX.params();
  el.setAttribute('data-where', `period=${p.period}&metric=sessions`);
  const r = BX.sumRow(p.period, 'sessions');
  const v = r ? r[el.dataset.field] : null;
  el.textContent = v ? BX.medDay(BX.parse(BX.day(v))) : '—';
});
dash.draw('val', (el) => fromSummary(el, (v) => (el.dataset.unit ? BX.count(BX.valFmt(el.dataset.metric)(v), el.dataset.unit) : BX.valFmt(el.dataset.metric)(v))));
dash.draw('usd', (el) => fromSummary(el, BX.usd));
dash.draw('pct', (el) => fromSummary(el, BX.pct));
dash.draw('txt', (el) => fromSummary(el, (v) => String(v)));
dash.draw('chg', (el) => fromSummary(el, (v) => (+v >= 1 ? `grew ${(1 + +v).toFixed(1)}×` : +v > 0.02 ? `rose ${BX.pct(+v)}` : +v < -0.02 ? `fell ${BX.pct(-v)}` : 'held steady')));
dash.draw('per-hour', (el) => {
  const p = BX.params();
  el.setAttribute('data-where', `period=${p.period}&metric=cost_usd`);
  const c = BX.sumRow(p.period, 'cost_usd'), h = BX.sumRow(p.period, 'active_hours');
  el.textContent = c && h && +h.value > 0 ? BX.usd(+c.value / +h.value) : '—';
});
dash.draw('dir', (el) => fromSummary(el, (v) => (+v > 0.02 ? 'grew' : +v < -0.02 ? 'fell' : 'held steady, moving')));
dash.draw('delta-word', (el) => fromSummary(el, (v) => `${+v >= 0 ? 'up' : 'down'} ${BX.pct(Math.abs(+v))} on the period before`));
// Change against the prior period: points for rates, a multiple above 2x, else a percentage.
BX.deltaText = (r, metric) => {
  if (!r || r.prev == null || r.value == null) return '—';
  const v = +r.value, p = +r.prev;
  if (BX.SHARE.has(metric)) { const d = (v - p) * 100; return `${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '■'} ${Math.abs(d).toFixed(1)} pts`; }
  if (!p) return '—';
  const ratio = v / p;
  if (ratio >= 2) return `▲ ${ratio.toFixed(1)}×`;
  return `${ratio > 1.005 ? '▲' : ratio < 0.995 ? '▼' : '■'} ${BX.pct(Math.abs(ratio - 1))}`;
};
dash.draw('delta', (el) => {
  const p = BX.params();
  const metric = el.dataset.metric;
  el.setAttribute('data-where', `period=${p.period}&metric=${metric}`);
  const r = BX.sumRow(p.period, metric);
  el.textContent = BX.deltaText(r, metric);
  const v = r && r.prev != null ? +r.value - +r.prev : null;
  // Colour only a material change in a measure with a known good direction.
  const judged = el.dataset.polarity === 'good-up';
  const material = v != null && (BX.SHARE.has(metric) ? Math.abs(v) >= 0.03 : r.prev && Math.abs(v / r.prev) >= 0.05);
  el.classList.toggle('is-up', judged && material && v > 0);
  el.classList.toggle('is-down', judged && material && v < 0);
});
dash.draw('prev', (el) => {
  const p = BX.params();
  const metric = el.dataset.metric;
  el.setAttribute('data-where', `period=${p.period}&metric=${metric}`);
  const r = BX.sumRow(p.period, metric);
  el.textContent = r && r.prev != null ? `prior ${BX.valFmt(metric)(r.prev)}` : '—';
});
let uid = 0;
BX.uid = (p) => `${p}-${++uid}`;
dash.draw('spark', (el) => {
  const p = BX.params();
  const metric = el.dataset.metric;
  const r = BX.sumRow(p.period, metric);
  const parse = (s) => (s ? String(s).split(',').map((v) => (v === '' || Number.isNaN(+v) ? null : +v)) : []);
  const vals = parse(r && r.spark), prev = p.period === 'all' ? [] : parse(r && r.spark_prev);
  const rate = BX.SHARE.has(metric);
  const pts = (arr) => arr.map((v, i) => ({ i, v })).filter((d) => d.v != null);
  const cur = pts(vals), old = pts(prev);
  if (cur.length < 2) { el.replaceChildren(); return; }
  const W = Math.max(80, el.clientWidth || 160), H = Math.max(28, el.clientHeight || 44);
  const svg = BX.svg(el, W, H, 'Trend over the period, with the period before as a dashed line');
  const n = Math.max(vals.length, prev.length);
  const x = d3.scaleLinear([0, n - 1], [2, W - 4]);
  const all = [...cur, ...old].map((d) => d.v);
  let lo = 0, hi = d3.max(all) || 1;
  if (rate) { const mid = (d3.min(all) + d3.max(all)) / 2, half = Math.max(0.05, (d3.max(all) - d3.min(all)) / 2 + 0.01); lo = Math.max(0, mid - half); hi = Math.min(1, lo + 2 * half); lo = Math.max(0, hi - 2 * half); }
  const y = d3.scaleLinear([lo, hi], [H - 3, 5]);
  const line = d3.line().x((d) => x(d.i)).y((d) => y(d.v));
  if (old.length > 1) svg.append('path').datum(old).attr('d', line).style('fill', 'none').style('stroke', 'var(--color-fg-muted)').attr('stroke-width', 1.1).attr('stroke-dasharray', '2 3').attr('opacity', 0.75);
  if (!rate) {
    const id = BX.uid('bxg');
    const g = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    [[0, 0.32], [0.6, 0.07], [1, 0]].forEach(([o, a]) => g.append('stop').attr('offset', o).style('stop-color', BX.accent()).style('stop-opacity', a));
    svg.append('path').datum(cur).attr('d', d3.area().x((d) => x(d.i)).y0(H - 1).y1((d) => y(d.v))).style('fill', `url(#${id})`);
  }
  svg.append('path').datum(cur).attr('d', line).style('fill', 'none').style('stroke', BX.accent()).attr('stroke-width', 1.8).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
  const e = cur[cur.length - 1];
  svg.append('circle').attr('cx', x(e.i)).attr('cy', y(e.v)).attr('r', 3).style('fill', BX.accent()).style('stroke', 'var(--color-panel)').attr('stroke-width', 1.5);
});
