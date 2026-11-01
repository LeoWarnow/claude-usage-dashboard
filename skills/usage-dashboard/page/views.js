// Claude Usage Dashboard: overview components and the detail views.

const wd = (d) => (d.getUTCDay() + 6) % 7; // Monday first
const td = (text, cls) => BX.el('td', cls, text);
const fail = (el) => { const f = BX.el('p', 'bx-fail'); f.append(BX.el('span', 'bx-fail-dot'), 'Failed to load'); el.replaceChildren(f); };
const legendItem = (color, label, cls) => { const it = BX.el('span', 'bx-legend-item'); it.append(BX.swatch(color, cls), label); return it; };
// On touch, the first tap on a mark shows its detail; a second tap on the same mark follows it.
const tapFirst = (host, event, key, show) => {
  if (event.pointerType !== 'touch' && !(window.matchMedia && window.matchMedia('(hover: none)').matches)) return true;
  if (host.__pinned === key) { host.__pinned = null; return true; }
  host.__pinned = key;
  show();
  return false;
};
const leave = (host, tip) => (event) => { if (event && event.pointerType === 'touch') return; host.__pinned = null; tip.hidden = true; };
// Data-driven empty states: show the [data-when=some] or [data-when=none] sibling.
const setWhen = (el, has) => {
  const scope = el.parentElement;
  if (!scope) return;
  scope.querySelectorAll(':scope > [data-when]').forEach((x) => { x.hidden = x.dataset.when === 'some' ? !has : has; });
};

// ---- Overview: all measures ---------------------------------------------------------

const METRIC_LABEL = {
  sessions: 'Sessions', prompts: 'Your prompts', active_hours: 'Active hours', active_days: 'Active days', longest_streak: 'Longest run of days',
  requests: 'Model requests', output: 'Output tokens', tokens: 'Total tokens', output_per_prompt: 'Output per prompt',
  subagents: 'Sub-agents launched', workflows: 'Multi-agent workflows', subagent_share: 'Sub-agent share of output',
  tool_calls: 'Tool calls', lines_added: 'Lines written', cost_usd: 'API-equivalent cost', cache_hit_rate: 'Cache hit rate',
};
dash.draw('metrics-table', (tb) => {
  if (BX.status(['summary']) !== 'ok') { tb.replaceChildren(); return; }
  const p = BX.params();
  const rows = BX.rows('summary').filter((r) => r.period === p.period && METRIC_LABEL[r.metric]);
  const order = Object.keys(METRIC_LABEL);
  rows.sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric));
  tb.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    const f = BX.valFmt(r.metric);
    const spark = td(null);
    const vals = r.spark ? String(r.spark).split(',').map((v) => (v === '' ? null : +v)) : [];
    if (vals.filter((v) => v != null).length > 1) {
      const W = 120, H = 22;
      const svg = d3.create('svg').attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('aria-hidden', 'true');
      const x = d3.scaleLinear([0, vals.length - 1], [1, W - 3]);
      const y = d3.scaleLinear([0, d3.max(vals) || 1], [H - 2, 3]);
      svg.append('path').datum(vals).attr('d', d3.line().defined((v) => v != null).x((v, i) => x(i)).y((v) => y(v)))
        .style('fill', 'none').style('stroke', BX.accent()).attr('stroke-width', 1.4);
      spark.append(svg.node());
    }
    tr.append(td(METRIC_LABEL[r.metric]), td(f(r.value), 'is-num'), td(r.prev == null ? '—' : f(r.prev), 'is-num'), td(BX.deltaText(r, r.metric), 'is-num'), spark);
    return tr;
  }));
});

// ---- Overview: signals -------------------------------------------------------------------

dash.draw('insights', (el) => {
  if (!BX.guard(el, ['insights', 'summary'])) return;
  const p = BX.params();
  const rows = BX.rows('insights').filter((r) => r.period === p.period).sort((a, b) => a.rank - b.rank).slice(0, 6);
  if (!rows.length) { el.replaceChildren(BX.el('p', 'bx-note', 'No activity in this period.')); return; }
  el.replaceChildren(...rows.map((r) => {
    const b = BX.el('button', 'bx-ins' + (r.tone === 'bad' ? ' is-bad' : ''));
    b.type = 'button';
    b.append(BX.el('span', `bx-ins-dot is-${r.tone || 'neutral'}`), BX.el('span', 'bx-ins-t', r.title), BX.el('span', 'bx-ins-go', '›'), BX.el('span', 'bx-ins-d', r.detail));
    b.setAttribute('aria-label', `${r.title}. ${r.detail} Open ${r.view}.`);
    b.addEventListener('click', () => BX.go(r.view, r.day ? { day: r.day } : {}));
    return b;
  }));
});

// ---- Calendars ---------------------------------------------------------------------------------

// Period calendar for the overview: tiles for 7 days, a month grid for 30, weeks for 90 and all time.
const periodLayout = (period, keys, W) => {
  const D = keys.map(BX.parse);
  if (period === '7d') {
    const gap = 8;
    if (W < 560) {
      const h = 56;
      return { kind: 'rows', pos: keys.map((key, i) => ({ key, d: D[i], x: 0, y: i * (h + gap), w: W, h, r: 8 })), width: W, height: keys.length * (h + gap) - gap, labels: [] };
    }
    const w = (W - gap * 6) / 7, h = Math.max(150, Math.min(230, w * 1.45));
    return { kind: 'tiles', pos: keys.map((key, i) => ({ key, d: D[i], x: i * (w + gap), y: 0, w, h, r: 10 })), width: W, height: h, labels: [] };
  }
  if (period === '30d') {
    const gap = W < 520 ? 4 : 6, top = 18;
    const first = d3.utcMonday.floor(D[0]);
    const w = (W - gap * 6) / 7, h = Math.max(38, Math.min(72, w * 0.6));
    const rows = d3.utcMonday.count(first, D[D.length - 1]) + 1;
    const names = W < 520 ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return {
      kind: 'month',
      pos: keys.map((key, i) => ({ key, d: D[i], x: wd(D[i]) * (w + gap), y: top + d3.utcMonday.count(first, D[i]) * (h + gap), w, h, r: 7 })),
      width: W, height: top + rows * (h + gap) - gap,
      labels: names.map((t, i) => ({ x: i * (w + gap) + 3, y: 11, t })),
    };
  }
  const first = d3.utcMonday.floor(D[0]);
  const weeks = d3.utcMonday.count(first, D[D.length - 1]) + 1;
  const left = 28, top = 18;
  const cell = Math.max(10, Math.min(period === '90d' ? 34 : 24, Math.floor((W - left) / weeks)));
  const gap = Math.max(2, Math.round(cell * 0.14));
  const pos = keys.map((key, i) => ({ key, d: D[i], x: left + d3.utcMonday.count(first, D[i]) * cell, y: top + wd(D[i]) * cell, w: cell - gap, h: cell - gap, r: Math.min(4, (cell - gap) / 4) }));
  const months = [];
  pos.forEach((c, i) => {
    if (i === 0 || c.d.getUTCDate() === 1) {
      const t = i === 0 || c.d.getUTCMonth() === 0 ? d3.utcFormat('%b %Y')(c.d) : d3.utcFormat('%b')(c.d);
      if (months.length && c.x - months[months.length - 1].x < (months[months.length - 1].t.length > 4 ? 60 : 34)) months.pop();
      if (c.x + 26 < left + weeks * cell) months.push({ x: c.x, y: 11, t });
    }
  });
  const days = [['Mon', 0], ['Wed', 2], ['Fri', 4]].map(([t, r]) => ({ x: 0, y: top + r * cell + (cell - gap) / 2 + 3.5, t }));
  return { kind: 'weeks', pos, width: left + weeks * cell, height: top + 7 * cell, labels: [...months, ...days] };
};

const heat = (keys, measure) => {
  const ix = BX.index();
  const vals = new Map(keys.map((k) => [k, ix.value(k, measure)]));
  const nz = [...vals.values()].filter((v) => v > 0).sort(d3.ascending);
  const th = [0.25, 0.5, 0.75].map((q) => d3.quantileSorted(nz, q));
  const level = (v) => (v > 0 ? 1 + th.filter((t) => v > t).length : 0);
  return { vals, level };
};
const cellFill = (k, v, measure, lvl, hatchId, color) => {
  if (v > 0) return color || BX.ramp(lvl);
  const r = BX.index().days.get(k);
  return r && r.tokenless && BX.MEASURE[measure].tokenish ? `url(#${hatchId})` : BX.ramp(0);
};
const hatch = (svg) => {
  const id = BX.uid('bxhatch');
  const pat = svg.append('defs').append('pattern').attr('id', id).attr('width', 4).attr('height', 4).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
  pat.append('rect').attr('width', 4).attr('height', 4).style('fill', BX.ramp(0));
  pat.append('line').attr('x2', 0).attr('y2', 4).attr('stroke-width', 1.4).style('stroke', 'var(--color-fg-muted)');
  return id;
};
const dayTip = (tip, host, event, k, measure) => {
  const ix = BX.index(), M = BX.MEASURE[measure], r = ix.days.get(k), v = ix.value(k, measure);
  tip.replaceChildren(BX.el('div', 'bx-tip-h', BX.shortDay(BX.parse(k))), BX.el('div', 'bx-tip-v', `${M.fmt(v)} ${M.unit}`));
  ix.split(k, measure).slice(0, 4).forEach((s) => BX.tipRow(tip, BX.color(s.model), BX.name(s.model), M.fmt(s.v)));
  if (r) {
    const f = (x) => ix.value(k, x);
    tip.append(BX.el('div', 'bx-tip-f', `${BX.count(f('sessions'), 'sessions')} · ${BX.count(f('prompts'), 'prompts')} · ${BX.count(f('subagents'), 'sub-agents')} · ${BX.hours(f('active_hours'))} h`));
    if (r.tokenless && M.tokenish && !v) tip.append(BX.el('div', 'bx-tip-h', 'Transcript gone before the ledger began: counts only'));
  } else tip.append(BX.el('div', 'bx-tip-f', 'No activity'));
  if (k === (BX.win('all') || {}).to) tip.append(BX.el('div', 'bx-tip-h', 'Today so far'));
  tip.hidden = false;
  BX.place(tip, host, event);
};

dash.draw('mini-atlas', (el) => {
  if (!BX.guard(el)) return;
  const p = BX.params(), ix = BX.index(), w = BX.win(p.period);
  if (!w) return;
  const keys = d3.utcDay.range(BX.parse(w.from), d3.utcDay.offset(BX.parse(w.to), 1)).map(BX.key);
  const W = Math.max(280, el.clientWidth || 800);
  const L = periodLayout(p.period, keys, W);
  const measure = 'output';
  const { vals, level } = heat(keys, measure);
  const big = L.kind === 'tiles' || L.kind === 'rows' || L.kind === 'month';
  const scroll = BX.el('div', 'bx-scroll');
  el.replaceChildren(scroll);
  const svg = d3.create('svg').attr('width', L.width).attr('height', L.height).attr('viewBox', `0 0 ${L.width} ${L.height}`).attr('role', 'img').attr('aria-label', 'Output tokens per day in the period');
  scroll.append(svg.node());
  const hid = hatch(svg);
  svg.append('g').selectAll('text').data(L.labels).join('text').attr('x', (d) => d.x).attr('y', (d) => d.y).text((d) => d.t);
  const today = (BX.win('all') || {}).to;
  const g = svg.append('g').selectAll('g').data(L.pos).join('g').attr('class', 'bx-cell').attr('transform', (c) => `translate(${c.x},${c.y})`);
  g.append('rect').attr('width', (c) => c.w).attr('height', (c) => c.h).attr('rx', (c) => c.r)
    .style('fill', (c) => cellFill(c.key, vals.get(c.key), measure, level(vals.get(c.key)), hid))
    .attr('stroke-dasharray', (c) => (c.key === today ? '3 2' : null)).style('stroke', (c) => (c.key === today ? 'var(--color-fg-muted)' : null));
  if (big) {
    g.each(function (c) {
      const cg = d3.select(this);
      const v = vals.get(c.key);
      const split = ix.split(c.key, measure), tot = d3.sum(split, (s) => s.v);
      const label = L.kind === 'month' ? (c.key === keys[0] || c.d.getUTCDate() === 1 ? d3.utcFormat('%b %-d')(c.d) : String(c.d.getUTCDate())) : d3.utcFormat(L.kind === 'rows' ? '%a, %b %-d' : '%a %-d')(c.d);
      const lv = v > 0 ? level(v) : 0, ink = BX.rampText(lv), strong = lv >= 3;
      cg.append('text').style('fill', ink).attr('x', 8).attr('y', 15).text(label);
      if (v > 0 && (L.kind !== 'month' || c.w >= 70)) cg.append('text').attr('class', 'bx-lab-serif').style('fill', ink).attr('x', L.kind === 'rows' ? c.w - 8 : 8).attr('text-anchor', L.kind === 'rows' ? 'end' : 'start')
        .attr('y', L.kind === 'month' ? c.h - 14 : L.kind === 'rows' ? 22 : 46).style('font-size', L.kind === 'tiles' ? '20px' : '15px').text(BX.tok(v));
      const ns = ix.value(c.key, 'sessions');
      if (((L.kind === 'month' && c.w >= 100 && c.h >= 60) || L.kind === 'tiles') && ns) cg.append('text').style('fill', ink).attr('x', L.kind === 'tiles' ? 8 : c.w - 8).attr('y', L.kind === 'tiles' ? 66 : 15).attr('text-anchor', L.kind === 'tiles' ? 'start' : 'end').text(`${ns} session${ns > 1 ? 's' : ''}`);
      if (L.kind === 'tiles' || L.kind === 'rows') {
        const r = ix.days.get(c.key), hrs = r ? r.hours : [], mx = d3.max(hrs) || 0;
        const x0 = 8, ww = c.w - 16, y0 = L.kind === 'rows' ? 30 : c.h - 52, hh = L.kind === 'rows' ? 16 : 30;
        if (mx) hrs.forEach((n, i) => { if (n) cg.append('rect').attr('x', x0 + (i * ww) / 24).attr('y', y0 + hh - Math.max(1.5, (n / mx) * hh)).attr('width', Math.max(1, ww / 24 - 1.5)).attr('height', Math.max(1.5, (n / mx) * hh)).attr('rx', 1).style('fill', ink).attr('fill-opacity', strong ? 0.75 : 0.4); });
      }
      if (tot > 0) {
        let x = 6;
        const ww = c.w - 12, yb = c.h - 8;
        split.forEach((s) => { const wv = (s.v / tot) * ww; cg.append('rect').attr('x', x).attr('y', yb).attr('width', Math.max(0, wv - 1)).attr('height', 3.5).attr('rx', 1.5).style('fill', BX.color(s.model)); x += wv; });
      }
    });
  }
  const tip = BX.tipBox(el);
  const cellOf = (event) => { const n = event.target.closest && event.target.closest('.bx-cell'); return n ? d3.select(n).datum() : null; };
  svg.on('pointermove', (event) => { if (event.pointerType === 'touch') return; const c = cellOf(event); if (c) dayTip(tip, el, event, c.key, measure); else tip.hidden = true; });
  svg.on('pointerleave', leave(el, tip));
  svg.on('click', (event) => { const c = cellOf(event); if (c && tapFirst(el, event, c.key, () => dayTip(tip, el, event, c.key, measure))) BX.goDay(c.key); });
  if (L.width > W) scroll.scrollLeft = scroll.scrollWidth;
});

// Full-history atlas for the Activity view, with weekly and weekday margins.
dash.draw('atlas', {
  mount(el) {
    const scroll = BX.el('div', 'bx-scroll');
    const tip = BX.el('div', 'bx-tip');
    tip.hidden = true;
    el.replaceChildren(scroll, tip);
    return { scroll, tip, first: true, keys: [] };
  },
  update(el, m) {
    const st = BX.status(BX.ALL);
    el.classList.toggle('dash-skeleton', st === 'loading');
    if (st !== 'ok') { m.tip.hidden = true; if (st === 'error') fail(m.scroll); else m.scroll.replaceChildren(); return; }
    const p = BX.params(), ix = BX.index(), w = BX.win(p.period), all = BX.win('all');
    if (!all) return;
    const W = Math.max(300, el.clientWidth || 900);
    const last = BX.parse(all.to);
    const first = W < 560 ? new Date(Math.max(+BX.parse(all.from), +d3.utcMonday.offset(d3.utcMonday.floor(last), -12))) : BX.parse(all.from);
    const keys = d3.utcDay.range(first, d3.utcDay.offset(last, 1)).map(BX.key);
    m.keys = keys;
    const M = BX.MEASURE[p.measure];
    const inW = BX.inWin(p.period);
    const hadFocus = m.scroll.contains(document.activeElement);
    const week0 = d3.utcMonday.floor(first);
    const weeks = d3.utcMonday.count(week0, last) + 1;
    const LM = 30, RM = 86, T = 62;
    const cell = Math.max(12, Math.min(30, Math.floor((W - LM - RM - 10) / weeks)));
    const gap = Math.max(2, Math.round(cell * 0.16)), size = cell - gap;
    const gridW = weeks * cell, width = Math.max(W, LM + gridW + 10 + RM), height = T + 7 * cell + 30;
    const { vals, level } = heat(keys, p.measure);
    const sel = BX.selDay(), today = all.to;
    const svg = d3.create('svg').attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)
      .attr('tabindex', 0).attr('role', 'group').attr('aria-label', 'Calendar of every day; arrow keys move the selected day');
    m.scroll.replaceChildren(svg.node());
    if (hadFocus) svg.node().focus({ preventScroll: true });
    const hid = hatch(svg);
    const xOf = (d) => LM + d3.utcMonday.count(week0, d) * cell;
    const yOf = (d) => T + wd(d) * cell;
    const months = [];
    keys.forEach((k, i) => {
      const d = BX.parse(k);
      if (i === 0 || d.getUTCDate() === 1) {
        const x = xOf(d);
        const t = i === 0 || d.getUTCMonth() === 0 ? d3.utcFormat('%b %Y')(d) : d3.utcFormat('%b')(d);
        if (months.length && x - months[months.length - 1].x < (months[months.length - 1].t.length > 4 ? 60 : 34)) months.pop();
        if (x + 24 < LM + gridW) months.push({ x, t });
      }
    });
    svg.append('g').selectAll('text').data(months).join('text').attr('x', (d) => d.x).attr('y', 11).text((d) => d.t);
    svg.append('g').selectAll('text').data([['Mon', 0], ['Wed', 2], ['Fri', 4], ['Sun', 6]]).join('text').attr('x', 0).attr('y', (d) => T + d[1] * cell + size / 2 + 3.5).text((d) => d[0]);
    const wk = new Map(), wkKeys = new Map();
    keys.forEach((k) => { const x = xOf(BX.parse(k)); wk.set(x, (wk.get(x) || 0) + vals.get(k)); wkKeys.set(x, [...(wkKeys.get(x) || []), k]); });
    if (p.measure === 'sessions') wkKeys.forEach((ks, x) => wk.set(x, ix.distinct(ks)));
    const wmax = d3.max(wk.values()) || 1;
    const inWeeks = new Set(keys.filter(inW).map((k) => xOf(BX.parse(k))));
    const topBars = svg.append('g').selectAll('rect').data([...wk.entries()]).join('rect')
      .attr('x', (d) => d[0]).attr('width', size).attr('y', (d) => T - 8 - (d[1] / wmax) * 34).attr('height', (d) => Math.max(d[1] > 0 ? 1 : 0, (d[1] / wmax) * 34)).attr('rx', 1.5)
      .style('fill', (d) => (inWeeks.has(d[0]) ? BX.accent() : 'var(--color-fg-muted)')).attr('fill-opacity', (d) => (inWeeks.has(d[0]) ? 0.85 : 0.3));
    const wdTot = new Array(7).fill(0);
    keys.filter(inW).forEach((k) => { wdTot[wd(BX.parse(k))] += vals.get(k); });
    if (p.measure === 'sessions') for (let i = 0; i < 7; i++) wdTot[i] = ix.distinct(keys.filter((k) => inW(k) && wd(BX.parse(k)) === i));
    const dmax = d3.max(wdTot) || 1, rx0 = LM + gridW + 10;
    const right = svg.append('g');
    right.selectAll('rect').data(wdTot).join('rect').attr('x', rx0).attr('y', (d, i) => T + i * cell).attr('height', size).attr('width', (d) => (d / dmax) * 36).attr('rx', 1.5).style('fill', BX.accent()).attr('fill-opacity', 0.8);
    right.selectAll('text').data(wdTot).join('text').attr('x', (d) => rx0 + (d / dmax) * 36 + 5).attr('y', (d, i) => T + i * cell + size / 2 + 3.5).text((d) => (cell >= 13 ? M.fmt(d) : ''));
    const hue = (k) => { if (p.color === 'model') { const s = ix.split(k, p.measure)[0]; return s ? BX.color(s.model) : BX.accent(); } return BX.accent(); };
    const cells = svg.append('g').selectAll('g').data(keys.map((k) => ({ k, d: BX.parse(k) }))).join('g')
      .attr('class', (c) => 'bx-cell' + (c.k === sel ? ' is-sel' : '')).attr('transform', (c) => `translate(${xOf(c.d)},${yOf(c.d)})`);
    cells.append('rect').attr('width', size).attr('height', size).attr('rx', Math.min(3, size / 4))
      .style('fill', (c) => cellFill(c.k, vals.get(c.k), p.measure, level(vals.get(c.k)), hid, p.color === 'model' ? hue(c.k) : null))
      .attr('fill-opacity', (c) => { const v = vals.get(c.k); const b = v > 0 && p.color === 'model' ? [1, 0.3, 0.52, 0.76, 1][level(v)] : 1; return inW(c.k) ? b : b * 0.45; })
      .attr('stroke-dasharray', (c) => (c.k === today && c.k !== sel ? '3 2' : null)).style('stroke', (c) => (c.k === today && c.k !== sel ? 'var(--color-fg-muted)' : null));
    if (m.first && BX.motion()) cells.style('opacity', 0).transition().duration(380).delay((c) => d3.utcMonday.count(week0, c.d) * 14 + wd(c.d) * 8).ease(d3.easeCubicOut).style('opacity', 1);
    if (w) {
      const a = new Date(Math.max(+first, +BX.parse(w.from))), b = BX.parse(w.to);
      const x0 = xOf(a), x1 = xOf(b) + size, yb = T + 7 * cell + 6;
      svg.append('path').attr('d', `M${x0},${yb} v5 H${x1} v-5`).style('stroke', 'var(--color-fg)').attr('stroke-width', 1.2).style('fill', 'none');
      svg.append('text').attr('class', 'bx-lab-strong').attr('x', Math.max(LM, Math.min(x0, LM + gridW - 100))).attr('y', yb + 20).text('Reporting period');
    }
    const tip = m.tip;
    const cellOf = (event) => { const g = event.target.closest && event.target.closest('.bx-cell'); return g ? d3.select(g).datum() : null; };
    svg.on('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const c = cellOf(event);
      if (!c) { tip.hidden = true; return; }
      dayTip(tip, el, event, c.k, p.measure);
      topBars.attr('stroke-width', (d) => (d[0] === xOf(c.d) ? 1.5 : 0)).style('stroke', 'var(--color-fg)');
    });
    svg.on('pointerleave', (event) => { leave(el, tip)(event); topBars.attr('stroke-width', 0); });
    svg.on('click', (event) => {
      const c = cellOf(event);
      if (!c) return;
      tip.hidden = true;
      dash.setParams({ day: c.k });
      if (window.innerWidth < 1180) { const d = document.getElementById('day'); if (d) setTimeout(() => d.scrollIntoView({ behavior: BX.motion() ? 'smooth' : 'auto', block: 'start' }), 60); }
    });
    svg.on('keydown', (event) => {
      const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const i = m.keys.indexOf(BX.selDay());
      const next = m.keys[Math.max(0, Math.min(m.keys.length - 1, (i < 0 ? m.keys.length - 1 : i) + step))];
      if (next) dash.setParams({ day: next });
    });
    if (m.first) m.scroll.scrollLeft = m.scroll.scrollWidth;
    m.first = false;
  },
});

dash.draw('atlas-legend', (el) => {
  if (!BX.guard(el, ['usage_daily', 'sessions'])) return;
  const p = BX.params(), ix = BX.index();
  const onOverview = !!el.closest('#view-overview');
  const measure = onOverview ? 'output' : p.measure;
  const items = [];
  if (!onOverview && p.color === 'model') {
    const seen = new Set();
    ix.days.forEach((r) => r.m.forEach((a, model) => { if (a[measure] > 0) seen.add(model); }));
    ix.models.filter((mm) => seen.has(mm)).forEach((mm) => items.push(legendItem(BX.color(mm), BX.name(mm))));
  } else {
    const it = BX.el('span', 'bx-legend-item');
    it.append(onOverview ? 'Output tokens: less' : 'Less');
    [0, 1, 2, 3, 4].forEach((i) => it.append(BX.swatch(BX.ramp(i))));
    it.append('more');
    items.push(it);
  }
  if (!onOverview) { const d = BX.swatch(BX.accent()); d.style.opacity = 0.35; const it = BX.el('span', 'bx-legend-item'); it.append(d, 'Outside the period'); items.push(it); }
  const t = BX.el('span', 'bx-legend-item');
  const ts = BX.el('span', 'bx-sw');
  ts.style.border = '1.5px dashed var(--color-fg-muted)';
  t.append(ts, 'Today, so far');
  items.push(t);
  if (BX.MEASURE[measure].tokenish) items.push(legendItem(null, 'Transcript gone, counts only', 'is-hatch'));
  el.replaceChildren(...items);
});

// ---- Overview: compact cards ------------------------------------------------------------------

dash.draw('mini-mix', (el) => {
  if (!BX.guard(el, ['model_table', 'usage_daily', 'summary'])) return;
  const p = BX.params();
  const rows = BX.rows('model_table').filter((r) => r.period === p.period).sort((a, b) => a.rank - b.rank);
  if (!rows.length) { el.replaceChildren(BX.el('p', 'bx-note', 'No model requests in this period.')); return; }
  const bar = BX.el('div', 'bx-stack');
  bar.style.height = '16px';
  rows.forEach((r) => { const s = BX.el('span'); s.style.width = `${r.share * 100}%`; s.style.background = BX.color(r.model); bar.append(s); });
  const list = BX.el('div', 'bx-bars');
  const top = rows.slice(0, 4);
  const rest = rows.slice(4);
  const lines = top.map((r) => ({ name: r.model_name, color: BX.color(r.model), share: r.share, out: r.output, cost: r.cost_usd }));
  if (rest.length) lines.push({ name: `${rest.length} more`, color: BX.col(7), share: d3.sum(rest, (r) => r.share), out: d3.sum(rest, (r) => r.output), cost: d3.sum(rest, (r) => r.cost_usd) });
  lines.forEach((l) => {
    const row = BX.el('div', 'bx-bar');
    row.style.gridTemplateColumns = 'minmax(0, 1fr) auto auto';
    const name = BX.el('span', 'bx-bar-name');
    name.append(BX.swatch(l.color), BX.el('span', null, l.name));
    row.append(name, BX.el('span', 'bx-bar-val', `${BX.tok(l.out)} · ${BX.usd(l.cost)}`), BX.el('b', 'bx-num', BX.pct(l.share)));
    list.append(row);
  });
  el.replaceChildren(bar, list);
});

dash.draw('mini-rhythm', (el) => {
  if (!BX.guard(el, ['hourly', 'summary'])) return;
  const inW = BX.inWin(BX.params().period);
  const hrs = new Array(24).fill(0);
  BX.rows('hourly').forEach((r) => { if (inW(r.date) && +r.hour >= 0 && +r.hour < 24) hrs[+r.hour] += +r.requests || 0; });
  const W = Math.max(240, el.clientWidth || 360), H = 150, mb = 20, mt = 22;
  const svg = BX.svg(el, W, H, 'Model requests by hour of day');
  const x = d3.scaleBand(d3.range(24), [0, W]).padding(0.22);
  const y = d3.scaleLinear([0, d3.max(hrs) || 1], [H - mb, mt]);
  const peak = hrs.indexOf(d3.max(hrs));
  svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', H - mb).attr('y2', H - mb).attr('stroke-width', 1).style('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('rect').data(hrs).join('rect').attr('x', (d, i) => x(i)).attr('width', x.bandwidth()).attr('y', (d) => y(d)).attr('height', (d) => y(0) - y(d)).attr('rx', 2)
    .style('fill', (d, i) => (i === peak ? BX.accent() : 'var(--color-fg-muted)')).attr('fill-opacity', (d, i) => (i === peak ? 1 : 0.35));
  svg.append('g').selectAll('text').data([0, 6, 12, 18]).join('text').attr('x', (h) => x(h)).attr('y', H - 5).text(BX.hh);
  if (hrs[peak]) svg.append('text').attr('class', 'bx-lab-strong').attr('x', Math.max(0, Math.min(x(peak) + x.bandwidth() / 2, W - 2))).attr('y', y(hrs[peak]) - 7)
    .attr('text-anchor', x(peak) > W - 70 ? 'end' : x(peak) < 40 ? 'start' : 'middle').text(`${BX.fmt(hrs[peak])} at ${BX.hh(peak)}`);
  const tip = BX.tipBox(el);
  svg.append('g').selectAll('rect').data(hrs.map((n, i) => ({ n, i }))).join('rect').attr('x', (d) => x(d.i) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H - mb).style('fill', 'transparent')
    .on('pointermove', (event, d) => { tip.replaceChildren(BX.el('div', 'bx-tip-h', `${BX.hh(d.i)} to ${BX.hh(d.i + 1)}`), BX.el('div', 'bx-tip-v', `${BX.count(BX.fmt(d.n), 'requests')}`)); tip.hidden = false; BX.place(tip, el, event); })
    .on('pointerleave', () => { tip.hidden = true; });
});

dash.draw('gauge', (el) => {
  const p = BX.params();
  const r = BX.sumRow(p.period, 'subagent_share');
  el.setAttribute('data-where', `period=${p.period}&metric=subagent_share`);
  if (!r) { el.replaceChildren(); return; }
  const v = +r.value || 0, prev = r.prev == null ? null : +r.prev;
  const S = 132, R = 56, T = 11;
  const svg = d3.create('svg').attr('viewBox', `0 0 ${S} ${S}`).attr('role', 'img').attr('aria-label', `Sub-agents wrote ${BX.pct(v)} of output`);
  el.replaceChildren(svg.node());
  const g = svg.append('g').attr('transform', `translate(${S / 2},${S / 2})`);
  const arc = d3.arc().innerRadius(R - T).outerRadius(R).cornerRadius(T / 2);
  g.append('path').attr('d', arc({ startAngle: 0, endAngle: 2 * Math.PI })).style('fill', 'var(--bx-soft)');
  g.append('path').attr('d', arc({ startAngle: 0, endAngle: 2 * Math.PI * Math.min(1, v) })).style('fill', BX.accent());
  if (prev != null && p.period !== 'all') {
    const a = 2 * Math.PI * Math.min(1, prev) - Math.PI / 2;
    g.append('line').attr('x1', Math.cos(a) * (R - T - 3)).attr('y1', Math.sin(a) * (R - T - 3)).attr('x2', Math.cos(a) * (R + 3)).attr('y2', Math.sin(a) * (R + 3))
      .style('stroke', 'var(--color-fg)').attr('stroke-width', 2).attr('stroke-linecap', 'round');
  }
  g.append('text').attr('text-anchor', 'middle').attr('y', 8).style('font-size', '26px').text(BX.pct(v));
  if (prev != null && p.period !== 'all') g.append('text').attr('text-anchor', 'middle').attr('y', 26).style('font-size', '10.5px').style('font-family', 'var(--bx-sans)').style('fill', 'var(--color-fg-muted)').text(`prior ${BX.pct(prev)}`);
});

dash.draw('mini-projects', (el) => {
  if (!BX.guard(el, ['projects', 'summary'])) return;
  const p = BX.params();
  const rows = BX.rows('projects').filter((r) => r.period === p.period).sort((a, b) => a.rank - b.rank).slice(0, 5);
  if (!rows.length) { el.replaceChildren(BX.el('p', 'bx-note', 'No sessions in this period.')); return; }
  el.replaceChildren(...rows.map((r, i) => {
    const row = BX.el('div', 'bx-bar is-click');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    const name = BX.el('span', 'bx-bar-name');
    name.append(BX.el('span', null, r.project));
    const track = BX.el('div', 'bx-bar-track');
    const f = BX.el('div', 'bx-bar-fill');
    f.style.width = `${r.share * 100}%`;
    f.style.background = i === 0 ? BX.accent() : 'var(--color-fg-muted)';
    f.style.opacity = i === 0 ? '1' : '0.5';
    track.append(f);
    row.append(name, track, BX.el('span', 'bx-bar-val', `${BX.pct(r.share)} · ${BX.count(r.sessions, 'sessions')}`));
    const open = () => BX.go('projects', { project: r.project }, { target: 'project-table' });
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return row;
  }));
});

dash.draw('mini-value', (el) => {
  if (!BX.guard(el)) return;
  const p = BX.params();
  const { rows, keys, weekly } = BX.bucketTable(p.period, 'cost_usd', false);
  const W = Math.max(240, el.clientWidth || 420), H = 96, mt = 18, mb = 16;
  const svg = BX.svg(el, W, H, 'API-equivalent cost over the period');
  const x = d3.scaleBand(keys, [0, W]).padding(0.2);
  const y = d3.scaleLinear([0, d3.max(rows, (r) => r._ || 0) || 1], [H - mb, mt]);
  svg.append('text').attr('x', 0).attr('y', 10).text(`API-equivalent cost per ${weekly ? 'week' : 'day'}`);
  svg.append('g').selectAll('rect').data(rows).join('rect').attr('x', (d) => x(d.b)).attr('width', x.bandwidth()).attr('y', (d) => y(d._ || 0)).attr('height', (d) => y(0) - y(d._ || 0)).attr('rx', 1.5)
    .style('fill', BX.accent()).attr('fill-opacity', 0.8);
  const e = keys.length ? BX.parse(keys[keys.length - 1]) : null, s = keys.length ? BX.parse(keys[0]) : null;
  if (s) svg.append('text').attr('x', 0).attr('y', H - 2).text(d3.utcFormat('%b %-d')(s));
  if (e && keys.length > 1) svg.append('text').attr('x', W).attr('y', H - 2).attr('text-anchor', 'end').text(d3.utcFormat('%b %-d')(e));
  const tip = BX.tipBox(el);
  svg.append('g').selectAll('rect').data(rows).join('rect').attr('x', (d) => x(d.b) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H).style('fill', 'transparent')
    .on('pointermove', (event, d) => { tip.replaceChildren(BX.el('div', 'bx-tip-h', BX.bucketLabel(d.b, weekly)), BX.el('div', 'bx-tip-v', BX.usd(d._ || 0))); tip.hidden = false; BX.place(tip, el, event); })
    .on('pointerleave', () => { tip.hidden = true; });
});

// ---- Activity: day inspector ---------------------------------------------------------------------

const dailyRow = (k) => BX.rows('daily').find((r) => r.date === k) || null;
const dayReady = () => BX.status(['daily', ...BX.ALL]) === 'ok';
dash.draw('day-title', (el) => { const k = dayReady() ? BX.selDay() : null; el.textContent = k ? BX.longDay(BX.parse(k)) : '—'; });
dash.draw('day-sub', (el) => {
  if (!dayReady()) { el.textContent = '—'; return; }
  const k = BX.selDay(), r = dailyRow(k);
  if (!r) { el.textContent = 'No activity on this day.'; return; }
  const day = BX.index().days.get(k);
  const on = (day ? day.hours : []).map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
  const span = on.length ? ` · ${BX.hh(on[0])} to ${BX.hh(on[on.length - 1] + 1)}` : '';
  el.textContent = `${BX.count(r.sessions, 'sessions')} · ${BX.count(r.prompts, 'prompts')} · ${BX.count(r.subagents, 'sub-agents')}${span}${k === (BX.win('all') || {}).to ? ' · today, so far' : ''}`;
});
const dayStat = (fmt) => (el) => {
  const k = dayReady() ? BX.selDay() : null;
  const r = k ? dailyRow(k) : null;
  if (r) el.setAttribute('data-where', `date=${k}`); else el.removeAttribute('data-where');
  const v = r ? r[el.dataset.field] : null;
  el.textContent = v == null ? '—' : fmt(v, el.dataset.field);
};
dash.draw('day-stat', dayStat((v, f) => (f === 'active_hours' ? BX.hours(v) : ['output', 'thinking'].includes(f) ? BX.tok(v) : BX.fmt(v))));
dash.draw('day-usd', dayStat(BX.usd));
dash.draw('day-count', dayStat((v) => `(${BX.fmt(v)})`));

dash.draw('day-models', (el) => {
  if (!BX.guard(el)) return;
  const ix = BX.index(), k = BX.selDay();
  const split = ix.split(k, 'output');
  if (!split.length) { el.replaceChildren(BX.el('p', 'bx-note', 'No model requests with token counts on this day.')); return; }
  const total = d3.sum(split, (s) => s.v);
  el.replaceChildren(...split.map((s) => {
    const a = ix.days.get(k).m.get(s.model);
    const row = BX.el('div', 'bx-bar');
    row.style.gridTemplateColumns = 'minmax(0, 7rem) minmax(0, 1fr) auto';
    const name = BX.el('span', 'bx-bar-name');
    name.append(BX.swatch(BX.color(s.model)), BX.el('span', null, BX.name(s.model)));
    const track = BX.el('div', 'bx-bar-track');
    const fill = BX.el('div', 'bx-bar-fill');
    fill.style.width = `${(s.v / total) * 100}%`;
    fill.style.background = BX.color(s.model);
    track.append(fill);
    row.append(name, track, BX.el('span', 'bx-bar-val', BX.pct(s.v / total)));
    row.append(BX.el('span', 'bx-bar-sub', `${BX.tok(s.v)} output · ${BX.count(BX.fmt(a.requests), 'requests')} · ${BX.usd(a.cost_usd)}`));
    return row;
  }));
});

dash.draw('day-hours', (el) => {
  if (!BX.guard(el)) return;
  const day = BX.index().days.get(BX.selDay());
  const hrs = day ? day.hours : new Array(24).fill(0);
  const W = Math.max(240, el.clientWidth || 360), H = 120, mb = 18, mt = 6;
  const svg = BX.svg(el, W, H, 'Model requests per hour');
  const x = d3.scaleBand(d3.range(24), [0, W]).padding(0.2);
  const y = d3.scaleLinear([0, d3.max(hrs) || 1], [H - mb, mt]);
  svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', H - mb).attr('y2', H - mb).attr('stroke-width', 1).style('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('text').data([0, 6, 12, 18]).join('text').attr('x', (d) => x(d)).attr('y', H - 4).text(BX.hh);
  const tip = BX.tipBox(el);
  svg.append('g').selectAll('rect').data(hrs.map((n, i) => ({ i, n }))).join('rect')
    .attr('x', (d) => x(d.i)).attr('width', x.bandwidth()).attr('y', (d) => y(d.n)).attr('height', (d) => y(0) - y(d.n)).attr('rx', 1.5).style('fill', BX.accent())
    .on('pointermove', (event, d) => { tip.replaceChildren(BX.el('div', 'bx-tip-h', `${BX.hh(d.i)} to ${BX.hh(d.i + 1)}`), BX.el('div', 'bx-tip-v', `${BX.count(BX.fmt(d.n), 'requests')}`)); tip.hidden = false; BX.place(tip, el, event); })
    .on('pointerleave', () => { tip.hidden = true; });
});

dash.draw('day-sessions', (tb) => {
  if (!dayReady()) { tb.replaceChildren(); return; }
  const k = BX.selDay();
  const rows = BX.rows('sessions').filter((r) => BX.day(r.date) === k).sort((a, b) => (+b.output || 0) - (+a.output || 0) || (+b.prompts || 0) - (+a.prompts || 0));
  tb.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    tr.append(td(r.title, 'is-title'), td(r.project, 'is-muted is-sec'), td(r.model_name, 'is-model is-sec'), td(BX.fmt(r.prompts), 'is-num is-sec'),
      td(BX.fmt(r.active_min), 'is-num is-sec'), td(BX.tok(r.output), 'is-num'), td(BX.fmt(r.subagents), 'is-num is-sec'), td(BX.fmt(r.lines_added), 'is-num is-sec'), td(d3.format(',.2f')(+r.cost_usd || 0), 'is-num'));
    return tr;
  }));
});
dash.draw('day-agents', (tb) => {
  if (!dayReady()) { tb.replaceChildren(); return; }
  const k = BX.selDay();
  const rows = BX.rows('subagents').filter((r) => BX.day(r.date) === k).sort((a, b) => (a.time < b.time ? -1 : 1));
  tb.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.id;
    tr.append(td(r.time, 'is-muted'), td(r.type, 'is-sec'), td(r.description, 'is-title'), td(r.model_name, 'is-model is-sec'), td(BX.fmt(r.tool_calls), 'is-num is-sec'), td(BX.tok(r.output), 'is-num'), td(d3.format(',.2f')(+r.cost_usd || 0), 'is-num is-sec'));
    return tr;
  }));
});

// ---- Models -------------------------------------------------------------------------------------------

dash.draw('model-shift', (el) => {
  if (!BX.guard(el)) return;
  const p = BX.params(), ix = BX.index();
  const { rows, keys, weekly } = BX.bucketTable(p.period, 'output', true);
  const series = ix.models.filter((m) => rows.some((r) => (r[m] || 0) > 0));
  const share = p.mix === 'share';
  const data = rows.map((r) => {
    const tot = d3.sum(series, (m) => r[m] || 0);
    const o = { b: r.b, tot };
    series.forEach((m) => { o[m] = share ? (tot ? (r[m] || 0) / tot : 0) : r[m] || 0; });
    return o;
  });
  const periodTot = d3.sum(data, (d) => d.tot);
  const periodShare = new Map(series.map((m) => [m, periodTot ? d3.sum(rows, (r) => r[m] || 0) / periodTot : 0]));
  const W = Math.max(300, el.clientWidth || 900), H = 280, mt = 10, mb = 26;
  const svg = BX.svg(el, W, H, 'Output tokens by model over time');
  const labels = series.filter((m) => periodShare.get(m) >= 0.005);
  const mr = W < 600 ? 0 : Math.min(230, Math.max(BX.measureText(svg, labels.map((m) => `${BX.name(m)} ${BX.pct(periodShare.get(m))}`), 'bx-lab-strong') + 14, BX.measureText(svg, ['Share of the period'])) + 24);
  const max = share ? 1 : d3.max(data, (d) => d.tot) || 1;
  const y = d3.scaleLinear([0, max], [H - mb, mt]).nice();
  const ticks = share ? [0, 0.25, 0.5, 0.75, 1] : y.ticks(4);
  const yf = share ? d3.format('.0%') : BX.tok;
  const ml = BX.measureText(svg, ticks.map(yf)) + 10;
  const x = d3.scaleBand(keys, [ml, W - mr]).paddingInner(keys.length > 40 ? 0.12 : 0.24);
  BX.grid(svg, y, ticks, ml, W - mr, yf);
  const stacked = d3.stack().keys(series)(data);
  const bw = Math.min(x.bandwidth(), 34), off = (x.bandwidth() - bw) / 2;
  svg.append('g').selectAll('g').data(stacked).join('g').style('fill', (s) => BX.color(s.key)).attr('fill-opacity', BX.theme() === 'dark' ? 0.85 : 0.92)
    .selectAll('rect').data((s) => s).join('rect').attr('x', (d) => x(d.data.b) + off).attr('width', bw)
    .attr('y', (d) => y(d[1])).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1]) - (d[1] > d[0] ? 1 : 0)));
  svg.append('g').selectAll('rect').data(data.filter((d) => !d.tot)).join('rect').attr('x', (d) => x(d.b) + off).attr('width', bw).attr('y', H - mb - 2).attr('height', 2).style('fill', 'var(--color-fg-muted)').attr('fill-opacity', 0.35);
  svg.append('g').selectAll('text').data(BX.xTicks(keys, weekly, (k) => x(k) + x.bandwidth() / 2, 48, W - mr)).join('text').attr('x', (d) => d.px).attr('y', H - 8).attr('text-anchor', 'middle').text((d) => d.t);
  if (mr) {
    const g = svg.append('g');
    const items = labels.map((m, i) => ({ m, y: mt + 8 + i * 20 }));
    g.append('text').attr('x', W - mr + 14).attr('y', mt).text('Share of the period');
    items.forEach((it) => {
      g.append('rect').attr('x', W - mr + 14).attr('y', it.y + 4).attr('width', 9).attr('height', 9).attr('rx', 2).style('fill', BX.color(it.m));
      g.append('text').attr('class', 'bx-lab-strong').attr('x', W - mr + 28).attr('y', it.y + 12.5).text(`${BX.name(it.m)} ${BX.pct(periodShare.get(it.m))}`);
    });
  } else {
    const lg = BX.el('div', 'bx-legend');
    labels.forEach((m) => lg.append(legendItem(BX.color(m), `${BX.name(m)} ${BX.pct(periodShare.get(m))}`)));
    el.append(lg);
  }
  const tip = BX.tipBox(el);
  svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (d) => x(d.b) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', mt).attr('height', H - mb - mt).style('fill', 'transparent')
    .style('cursor', weekly ? 'default' : 'pointer')
    .on('pointermove', (event, d) => {
      tip.replaceChildren(BX.el('div', 'bx-tip-h', BX.bucketLabel(d.b, weekly)), BX.el('div', 'bx-tip-v', d.tot ? `${BX.tok(d.tot)} output tokens` : 'No activity'));
      series.filter((m) => d[m] > 0).sort((a, b) => d[b] - d[a]).forEach((m) => BX.tipRow(tip, BX.color(m), BX.name(m), share ? BX.pct(d[m]) : BX.tok(d[m])));
      tip.hidden = false; BX.place(tip, el, event);
    })
    .on('pointerleave', () => { tip.hidden = true; })
    .on('click', (event, d) => { if (!weekly && d.tot) BX.goDay(d.b); });
});

dash.draw('model-life', (el) => {
  if (!BX.guard(el, ['usage_daily', 'summary'])) return;
  const ix = BX.index(), all = BX.win('all'), w = BX.win();
  if (!all) return;
  const models = ix.models.filter((m) => ix.span.has(m));
  const weekOut = new Map();
  BX.rows('usage_daily').forEach((u) => { const k = `${u.model}|${BX.key(d3.utcMonday.floor(BX.parse(BX.day(u.date))))}`; weekOut.set(k, (weekOut.get(k) || 0) + (+u.output || 0)); });
  const W = Math.max(280, el.clientWidth || 520), row = 26, TOP = 8;
  const H = TOP + models.length * row + 24;
  const svg = BX.svg(el, W, H, 'When each model was in use');
  const LM = Math.min(W * 0.36, BX.measureText(svg, models.map(BX.name), 'bx-lab-strong') + 14);
  const x = d3.scaleUtc([BX.parse(all.from), d3.utcDay.offset(BX.parse(all.to), 1)], [LM, W - 10]);
  if (w) svg.append('rect').attr('x', x(BX.parse(w.from))).attr('width', Math.max(2, x(d3.utcDay.offset(BX.parse(w.to), 1)) - x(BX.parse(w.from)))).attr('y', 0).attr('height', H - 22).style('fill', 'var(--bx-soft)');
  const xt = x.ticks(W < 480 ? 3 : 5);
  svg.append('g').selectAll('text').data(xt).join('text').attr('x', x).attr('y', H - 6).attr('text-anchor', 'middle').text(d3.utcFormat('%b'));
  const maxW = d3.max(weekOut.values()) || 1;
  const r = d3.scaleSqrt([0, maxW], [0, row / 2 - 2]);
  models.forEach((m, i) => {
    const [a, b] = ix.span.get(m), yy = TOP + i * row + row / 2;
    svg.append('text').attr('class', 'bx-lab-strong').attr('x', 0).attr('y', yy + 4).text(BX.name(m));
    svg.append('line').attr('x1', x(BX.parse(a))).attr('x2', Math.max(x(BX.parse(a)) + 3, x(d3.utcDay.offset(BX.parse(b), 1)))).attr('y1', yy).attr('y2', yy)
      .style('stroke', BX.color(m)).attr('stroke-width', 4).attr('stroke-linecap', 'round').attr('opacity', 0.55);
    const best = [...weekOut.entries()].filter(([k]) => k.startsWith(m + '|')).sort((p, q) => q[1] - p[1])[0];
    if (best) svg.append('circle').attr('cx', x(d3.utcDay.offset(BX.parse(best[0].split('|')[1]), 3))).attr('cy', yy).attr('r', Math.max(3, r(best[1]))).style('fill', BX.color(m));
  });
});

dash.draw('model-table', (tb) => {
  if (BX.status(['model_table', 'usage_daily', 'summary']) !== 'ok') { tb.replaceChildren(); return; }
  const p = BX.params();
  const rows = BX.rows('model_table').filter((r) => r.period === p.period).sort((a, b) => a.rank - b.rank);
  tb.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    const name = td(null, 'is-model');
    name.append(BX.swatch(BX.color(r.model)), ' ', r.model_name);
    const share = td(null);
    const wrap = BX.el('div', 'bx-bar');
    wrap.style.gridTemplateColumns = 'minmax(4rem, 1fr) 3rem';
    const track = BX.el('div', 'bx-bar-track');
    const fill = BX.el('div', 'bx-bar-fill');
    fill.style.width = `${(+r.share || 0) * 100}%`;
    fill.style.background = BX.color(r.model);
    track.append(fill);
    wrap.append(track, BX.el('span', 'bx-bar-val', BX.pct(r.share)));
    share.append(wrap);
    tr.append(name, share, td(BX.tok(r.output), 'is-num is-sec'), td(BX.fmt(r.requests), 'is-num is-sec'), td(d3.format(',.2f')(+r.cost_usd || 0), 'is-num'), td(BX.medDay(BX.parse(BX.day(r.last_used))), 'is-muted is-sec'));
    return tr;
  }));
});

// ---- Ways of working --------------------------------------------------------------------------------

dash.draw('rhythm', (el) => {
  if (!BX.guard(el, ['hourly', 'summary'])) return;
  const inW = BX.inWin(BX.params().period);
  const grid = d3.range(7).map(() => new Array(24).fill(0));
  BX.rows('hourly').forEach((r) => {
    if (!inW(r.date)) return;
    const d = BX.parse(BX.day(r.date));
    if (d && +r.hour >= 0 && +r.hour < 24) grid[wd(d)][+r.hour] += +r.requests || 0;
  });
  const flat = grid.flat(), max = d3.max(flat) || 1, total = d3.sum(flat) || 1;
  const colT = d3.range(24).map((h) => d3.sum(grid, (row) => row[h])), rowT = grid.map((row) => d3.sum(row));
  const W = Math.max(300, el.clientWidth || 560);
  const LM = 34, RM = 50, TOP = 40;
  const cw = (W - LM - RM) / 24, ch = Math.max(18, Math.min(30, cw * 1.1)), s = Math.max(4, Math.min(cw, ch) - 3);
  const H = TOP + 7 * ch + 22;
  const svg = BX.svg(el, W, H, 'Model requests by weekday and hour');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cmax = d3.max(colT) || 1, rmax = d3.max(rowT) || 1;
  svg.append('g').selectAll('rect').data(colT).join('rect').attr('x', (d, h) => LM + h * cw + (cw - s) / 2).attr('width', s).attr('y', (d) => TOP - 6 - (d / cmax) * 28).attr('height', (d) => (d / cmax) * 28).attr('rx', 1.5).style('fill', BX.accent()).attr('fill-opacity', 0.55);
  svg.append('g').selectAll('rect').data(rowT).join('rect').attr('x', W - RM + 6).attr('y', (d, i) => TOP + i * ch + (ch - s) / 2).attr('width', (d) => (d / rmax) * (RM - 10)).attr('height', s).attr('rx', 1.5).style('fill', BX.accent()).attr('fill-opacity', 0.55);
  svg.append('g').selectAll('text').data(days).join('text').attr('x', 0).attr('y', (d, i) => TOP + i * ch + ch / 2 + 3.5).text((d) => d);
  svg.append('g').selectAll('text').data([0, 6, 12, 18]).join('text').attr('x', (h) => LM + h * cw + cw / 2).attr('y', H - 6).attr('text-anchor', 'middle').text(BX.hh);
  const op = d3.scaleSqrt([0, max], [0.08, 1]);
  const tip = BX.tipBox(el);
  const pts = [];
  grid.forEach((row, i) => row.forEach((n, h) => pts.push({ i, h, n })));
  svg.append('g').selectAll('rect').data(pts).join('rect')
    .attr('x', (d) => LM + d.h * cw + (cw - s) / 2).attr('y', (d) => TOP + d.i * ch + (ch - s) / 2).attr('width', s).attr('height', s).attr('rx', Math.min(3, s / 4))
    .style('fill', (d) => (d.n ? BX.accent() : 'var(--bx-soft)')).attr('fill-opacity', (d) => (d.n ? op(d.n) : 1))
    .on('pointermove', (event, d) => {
      tip.replaceChildren(BX.el('div', 'bx-tip-h', `${days[d.i]}, ${BX.hh(d.h)} to ${BX.hh(d.h + 1)}`), BX.el('div', 'bx-tip-v', `${BX.count(BX.fmt(d.n), 'requests')}`), BX.el('div', 'bx-tip-f', `${BX.pct(d.n / total)} of the period's requests`));
      tip.hidden = false; BX.place(tip, el, event);
    })
    .on('pointerleave', () => { tip.hidden = true; });
});

const mixRows = () => BX.rows('tool_mix').filter((r) => r.period === BX.params().period).sort((a, b) => a.rank - b.rank);
const topMark = (el, rows, field, fmt) => {
  el.setAttribute('data-where', `period=${BX.params().period}&rank=1`);
  const r = rows[0];
  el.textContent = r ? fmt(r[field]) : '—';
};
dash.draw('mix-top', (el) => topMark(el, mixRows(), 'category', String));
dash.draw('mix-top-share', (el) => topMark(el, mixRows(), 'share', BX.pct));
dash.draw('tool-mix', (el) => {
  if (!BX.guard(el, ['tool_mix', 'tools', 'summary'])) return;
  const rows = mixRows();
  if (!rows.length) { el.replaceChildren(BX.el('p', 'bx-note', 'No tool calls in this period.')); return; }
  el.replaceChildren(...rows.map((r, i) => {
    const row = BX.el('div', 'bx-bar');
    const name = BX.el('span', 'bx-bar-name');
    name.append(BX.el('span', null, r.category));
    const track = BX.el('div', 'bx-bar-track');
    const fill = BX.el('div', 'bx-bar-fill');
    fill.style.width = `${r.share * 100}%`;
    fill.style.background = i === 0 ? BX.accent() : 'var(--color-fg-muted)';
    fill.style.opacity = i === 0 ? '1' : '0.45';
    track.append(fill);
    row.append(name, track, BX.el('span', 'bx-bar-val', `${BX.pct(r.share)} · ${BX.fmt(r.calls)}`), BX.el('span', 'bx-bar-sub', r.top_tools));
    return row;
  }));
});

dash.draw('landscape', (el) => {
  if (!BX.guard(el, ['sessions', 'summary', 'usage_daily'])) return;
  const inW = BX.inWin(BX.params().period);
  const by = new Map();
  BX.rows('sessions').forEach((r) => {
    if (!inW(r.date) || r.tokens_known === false || r.tokens_known === 'false') return;
    const s = by.get(r.session) || { id: r.session, title: r.title, project: r.project, model: r.model, first: BX.day(r.date), min: 0, out: 0, subs: 0, prompts: 0, cost: 0, topOut: -1, top: BX.day(r.date) };
    s.min += +r.active_min || 0; s.out += +r.output || 0; s.subs += +r.subagents || 0; s.prompts += +r.prompts || 0; s.cost += +r.cost_usd || 0;
    if ((+r.output || 0) > s.topOut) { s.topOut = +r.output || 0; s.model = r.model; s.top = BX.day(r.date); }
    if (BX.day(r.date) < s.first) s.first = BX.day(r.date);
    by.set(r.session, s);
  });
  const pts = [...by.values()].filter((s) => s.out > 0).map((s) => ({ ...s, min: Math.max(1, s.min) }));
  const W = Math.max(300, el.clientWidth || 900), H = 340, mt = 22, mb = 34;
  const svg = BX.svg(el, W, H, 'Sessions by active time and output');
  if (!pts.length) { svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle').text('No sessions with token counts in this period'); return; }
  const y = d3.scaleLog([Math.min(1e3, d3.min(pts, (d) => d.out) / 1.6), Math.max(1e4, d3.max(pts, (d) => d.out) * 1.6)], [H - mb, mt]).clamp(true);
  const yt = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8].filter((t) => t >= y.domain()[0] && t <= y.domain()[1]);
  const ml = BX.measureText(svg, yt.map(BX.tok)) + 12;
  const x = d3.scaleLog([0.8, Math.max(120, d3.max(pts, (d) => d.min) * 1.4)], [ml + 6, W - 12]).clamp(true);
  const xt = [[1, '1 min'], [5, '5 min'], [15, '15 min'], [60, '1 h'], [240, '4 h'], [960, '16 h'], [3840, '64 h']].filter(([v]) => v <= x.domain()[1]);
  BX.grid(svg, y, yt, ml, W - 12, BX.tok);
  svg.append('g').selectAll('line').data(xt).join('line').attr('x1', (d) => x(d[0])).attr('x2', (d) => x(d[0])).attr('y1', mt).attr('y2', H - mb).attr('stroke-width', 1).style('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('text').data(xt).join('text').attr('x', (d) => x(d[0])).attr('y', H - mb + 16).attr('text-anchor', 'middle').text((d) => d[1]);
  // Isolines of output per active minute.
  const clip = BX.uid('bxclip');
  svg.append('clipPath').attr('id', clip).append('rect').attr('x', ml).attr('y', mt).attr('width', W - 12 - ml).attr('height', H - mb - mt);
  const iso = svg.append('g').attr('clip-path', `url(#${clip})`);
  [1e3, 1e4, 1e5].forEach((rate) => {
    const x0 = x.domain()[0], x1 = x.domain()[1];
    iso.append('line').attr('x1', x(x0)).attr('y1', y(rate * x0)).attr('x2', x(x1)).attr('y2', y(rate * x1)).style('stroke', 'var(--color-fg-muted)').attr('stroke-width', 1).attr('stroke-dasharray', '3 4').attr('opacity', 0.45);
  });
  const isoLab = [1e3, 1e4, 1e5].map((rate) => {
    const xm = Math.sqrt(x.domain()[0] * x.domain()[1]);
    const lx = Math.min(x.domain()[1], Math.max(x.domain()[0], y.domain()[1] / rate / 1.6, xm / 4));
    return { rate, x: x(lx), y: y(rate * lx) };
  }).filter((d) => d.y > mt + 10 && d.y < H - mb - 10 && d.x < W - 80);
  svg.append('g').selectAll('text').data(isoLab).join('text').attr('x', (d) => d.x + 4).attr('y', (d) => d.y - 4).style('font-size', '10px').text((d) => `${BX.tok(d.rate)}/min`);
  const medX = d3.median(pts, (d) => d.min), medY = d3.median(pts, (d) => d.out);
  svg.append('line').attr('x1', x(medX)).attr('x2', x(medX)).attr('y1', mt).attr('y2', H - mb).style('stroke', 'var(--color-fg)').attr('opacity', 0.25).attr('stroke-width', 1);
  svg.append('line').attr('x1', ml).attr('x2', W - 12).attr('y1', y(medY)).attr('y2', y(medY)).style('stroke', 'var(--color-fg)').attr('opacity', 0.25).attr('stroke-width', 1);
  svg.append('text').attr('x', W - 12).attr('y', H - 4).attr('text-anchor', 'end').text('Active time →');
  svg.append('text').attr('x', ml).attr('y', mt - 8).text('↑ Output tokens · lines mark the medians');
  const r = d3.scaleSqrt([0, Math.max(1, d3.max(pts, (d) => d.subs))], [3.5, 18]);
  const tip = BX.tipBox(el);
  svg.append('g').selectAll('circle').data(pts.sort((a, b) => b.subs - a.subs)).join('circle')
    .attr('cx', (d) => x(d.min)).attr('cy', (d) => y(d.out)).attr('r', (d) => r(d.subs))
    .style('fill', (d) => BX.color(d.model)).attr('fill-opacity', 0.72).style('stroke', 'var(--color-panel)').attr('stroke-width', 1).style('cursor', 'pointer')
    .on('pointermove', (event, d) => {
      tip.replaceChildren(BX.el('div', 'bx-tip-h', `${BX.medDay(BX.parse(d.first))} · ${d.project}`), BX.el('div', 'bx-tip-t', d.title));
      BX.tipRow(tip, BX.color(d.model), BX.name(d.model), BX.usd(d.cost));
      tip.append(BX.el('div', 'bx-tip-f', `${BX.tok(d.out)} output · ${BX.hours(d.min / 60)} h active · ${BX.count(d.prompts, 'prompts')} · ${BX.count(d.subs, 'sub-agents')}`));
      tip.hidden = false; BX.place(tip, el, event);
    })
    .on('pointerleave', leave(el, tip))
    .on('click', (event, d) => { if (tapFirst(el, event, d.id, () => { tip.hidden = false; BX.place(tip, el, event); })) BX.goDay(d.top); });
  const lg = BX.el('div', 'bx-legend');
  [...new Set(pts.map((d) => d.model))].sort((a, b) => BX.index().models.indexOf(a) - BX.index().models.indexOf(b)).forEach((m) => lg.append(legendItem(BX.color(m), BX.name(m))));
  el.append(lg);
});

// ---- Delegation ------------------------------------------------------------------------------------------

dash.draw('agents-time', (el) => {
  if (!BX.guard(el, ['subagents', 'usage_daily', 'summary'])) return;
  const p = BX.params();
  const dir = BX.bucketTable(p.period, 'direct', false), wf = BX.bucketTable(p.period, 'workflow', false);
  const out = BX.bucketTable(p.period, 'output', false), sub = BX.bucketTable(p.period, 'sub_output', false);
  const data = dir.rows.map((r, i) => ({ b: r.b, direct: r._ || 0, workflow: wf.rows[i]._ || 0, share: (out.rows[i]._ || 0) ? (sub.rows[i]._ || 0) / out.rows[i]._ : null }));
  const W = Math.max(300, el.clientWidth || 560), H = 290, mt = 70, mb = 26;
  const svg = BX.svg(el, W, H, 'Sub-agents launched over time with their share of output');
  const max = d3.max(data, (d) => d.direct + d.workflow) || 1;
  const y = d3.scaleLinear([0, max], [H - mb, mt]).nice();
  const ticks = y.ticks(4);
  const ml = BX.measureText(svg, ticks.map(BX.fmt)) + 10;
  const x = d3.scaleBand(dir.keys, [ml, W - 40]).paddingInner(dir.keys.length > 40 ? 0.15 : 0.28);
  BX.grid(svg, y, ticks, ml, W - 40, BX.fmt);
  const bw = Math.min(x.bandwidth(), 30), off = (x.bandwidth() - bw) / 2;
  svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (d) => x(d.b) + off).attr('width', bw).attr('y', (d) => y(d.direct)).attr('height', (d) => y(0) - y(d.direct)).style('fill', BX.accent());
  svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (d) => x(d.b) + off).attr('width', bw).attr('y', (d) => y(d.direct + d.workflow)).attr('height', (d) => Math.max(0, y(d.direct) - y(d.direct + d.workflow) - (d.direct ? 1 : 0))).style('fill', BX.accent()).attr('fill-opacity', 0.42);
  svg.append('g').selectAll('text').data(BX.xTicks(dir.keys, dir.weekly, (k) => x(k) + x.bandwidth() / 2, 46, W - 40)).join('text').attr('x', (d) => d.px).attr('y', H - 8).attr('text-anchor', 'middle').text((d) => d.t);
  const ys = d3.scaleLinear([0, 1], [52, 18]);
  svg.append('line').attr('x1', ml).attr('x2', W - 40).attr('y1', ys(0)).attr('y2', ys(0)).attr('stroke-width', 1).style('stroke', 'var(--cds-chart-grid)');
  svg.append('text').attr('x', ml).attr('y', 10).text('Share of output from sub-agents');
  const avg = BX.sumRow(p.period, 'subagent_share');
  if (avg && avg.value != null) {
    svg.append('line').attr('x1', ml).attr('x2', W - 40).attr('y1', ys(+avg.value)).attr('y2', ys(+avg.value)).style('stroke', 'var(--color-fg-muted)').attr('stroke-dasharray', '4 3').attr('stroke-width', 1);
    svg.append('text').attr('x', W - 36).attr('y', ys(+avg.value) + 3.5).text(BX.pct(+avg.value));
  }
  svg.append('path').datum(data.filter((d) => d.share != null)).attr('d', d3.line().x((d) => x(d.b) + x.bandwidth() / 2).y((d) => ys(d.share)))
    .style('fill', 'none').style('stroke', 'var(--color-fg)').attr('stroke-width', 1.6).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
  svg.append('g').selectAll('circle').data(data.filter((d) => d.share != null)).join('circle').attr('cx', (d) => x(d.b) + x.bandwidth() / 2).attr('cy', (d) => ys(d.share)).attr('r', 2).style('fill', 'var(--color-fg)');
  const lg = BX.el('div', 'bx-legend');
  const dimmed = BX.swatch(BX.accent());
  dimmed.style.opacity = 0.42;
  const it = BX.el('span', 'bx-legend-item');
  it.append(dimmed, 'Workflow agents');
  lg.append(legendItem(BX.accent(), 'Direct sub-agents'), it, legendItem('var(--color-fg)', 'Share of output', 'is-line'), legendItem('var(--color-fg-muted)', 'Period average', 'is-line'));
  el.append(lg);
  const tip = BX.tipBox(el);
  svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (d) => x(d.b) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H - mb).style('fill', 'transparent')
    .on('pointermove', (event, d) => {
      tip.replaceChildren(BX.el('div', 'bx-tip-h', BX.bucketLabel(d.b, dir.weekly)), BX.el('div', 'bx-tip-v', `${BX.count(BX.fmt(d.direct + d.workflow), 'agents')}`));
      BX.tipRow(tip, BX.accent(), 'Direct', BX.fmt(d.direct));
      BX.tipRow(tip, BX.accent(), 'Workflow', BX.fmt(d.workflow));
      if (d.share != null) tip.append(BX.el('div', 'bx-tip-f', `${BX.pct(d.share)} of output from sub-agents`));
      tip.hidden = false; BX.place(tip, el, event);
    })
    .on('pointerleave', () => { tip.hidden = true; })
    .on('click', (event, d) => { if (!dir.weekly && d.direct + d.workflow) BX.goDay(d.b); });
});

dash.draw('workflows', (tb) => {
  if (BX.status(['workflows', 'summary']) !== 'ok') { tb.replaceChildren(); return; }
  const inW = BX.inWin(BX.params().period);
  const rows = BX.rows('workflows').filter((w) => inW(w.date)).sort((a, b) => b.agents - a.agents || b.output - a.output);
  tb.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.workflow;
    tr.className = 'is-click';
    tr.tabIndex = 0;
    tr.append(td(d3.utcFormat('%b %-d')(BX.parse(BX.day(r.date))), 'is-muted is-nowrap'), td(r.title, 'is-title'), td(BX.fmt(r.agents), 'is-num'), td(d3.format(',.2f')(+r.cost_usd || 0), 'is-num is-sec'));
    tr.addEventListener('click', () => BX.goDay(r.date));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') BX.goDay(r.date); });
    return tr;
  }));
});

// ---- Value -------------------------------------------------------------------------------------------------

dash.draw('value-time', (el) => {
  if (!BX.guard(el)) return;
  const p = BX.params(), ix = BX.index();
  const { rows, keys, weekly } = BX.bucketTable(p.period, 'cost_usd', true);
  const series = ix.models.filter((m) => rows.some((r) => (r[m] || 0) > 0));
  const stacked = d3.stack().keys(series).value((d, k) => d[k] || 0)(rows);
  let run = 0;
  const cum = rows.map((r) => ({ b: r.b, v: (run += d3.sum(series, (m) => r[m] || 0)) }));
  const W = Math.max(300, el.clientWidth || 560), H = 290, mt = 70, mb = 26;
  const svg = BX.svg(el, W, H, 'API-equivalent cost over time by model, with running total');
  const max = d3.max(stacked.length ? stacked[stacked.length - 1] : [], (d) => d[1]) || 1;
  const y = d3.scaleLinear([0, max], [H - mb, mt]).nice();
  const ticks = y.ticks(4);
  const ml = BX.measureText(svg, ticks.map(BX.usdAxis)) + 10;
  const x = d3.scaleBand(keys, [ml, W - 8]).paddingInner(keys.length > 40 ? 0.15 : 0.28);
  BX.grid(svg, y, ticks, ml, W - 8, BX.usdAxis);
  const bw = Math.min(x.bandwidth(), 30), off = (x.bandwidth() - bw) / 2;
  svg.append('g').selectAll('g').data(stacked).join('g').style('fill', (s) => BX.color(s.key)).selectAll('rect').data((s) => s).join('rect')
    .attr('x', (d) => x(d.data.b) + off).attr('width', bw).attr('y', (d) => y(d[1])).attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])));
  svg.append('g').selectAll('text').data(BX.xTicks(keys, weekly, (k) => x(k) + x.bandwidth() / 2, 46, W)).join('text').attr('x', (d) => d.px).attr('y', H - 8).attr('text-anchor', 'middle').text((d) => d.t);
  const yc = d3.scaleLinear([0, run || 1], [52, 20]);
  svg.append('line').attr('x1', ml).attr('x2', W - 8).attr('y1', yc(0)).attr('y2', yc(0)).attr('stroke-width', 1).style('stroke', 'var(--cds-chart-grid)');
  svg.append('text').attr('x', ml).attr('y', 10).text('Running total');
  svg.append('path').datum(cum).attr('d', d3.line().x((d) => x(d.b) + x.bandwidth() / 2).y((d) => yc(d.v))).style('fill', 'none').style('stroke', 'var(--color-fg)').attr('stroke-width', 1.6).attr('stroke-linejoin', 'round');
  if (cum.length) {
    const e = cum[cum.length - 1], ex = x(e.b) + x.bandwidth() / 2;
    svg.append('circle').attr('cx', ex).attr('cy', yc(e.v)).attr('r', 3).style('fill', 'var(--color-fg)');
    svg.append('text').attr('class', 'bx-lab-strong').attr('x', Math.max(ml + 60, Math.min(ex - 6, W - 8))).attr('y', 10).attr('text-anchor', 'end').text(BX.usd(e.v));
  }
  const lg = BX.el('div', 'bx-legend');
  series.forEach((m) => lg.append(legendItem(BX.color(m), BX.name(m))));
  el.append(lg);
  const tip = BX.tipBox(el);
  svg.append('g').selectAll('rect').data(rows).join('rect').attr('x', (d) => x(d.b) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', 0).attr('height', H - mb).style('fill', 'transparent')
    .on('pointermove', (event, d) => {
      const tot = d3.sum(series, (m) => d[m] || 0);
      tip.replaceChildren(BX.el('div', 'bx-tip-h', BX.bucketLabel(d.b, weekly)), BX.el('div', 'bx-tip-v', BX.usd(tot)));
      series.filter((m) => (d[m] || 0) > 0).sort((a, b) => d[b] - d[a]).forEach((m) => BX.tipRow(tip, BX.color(m), BX.name(m), BX.usd(d[m])));
      tip.hidden = false; BX.place(tip, el, event);
    })
    .on('pointerleave', () => { tip.hidden = true; })
    .on('click', (event, d) => { if (!weekly) BX.goDay(d.b); });
});

dash.draw('token-mix', (el) => {
  if (!BX.guard(el)) return;
  const ix = BX.index(), inW = BX.inWin(BX.params().period);
  const t = { cache_read: ix.sum(inW, 'cache_read'), cache_write: ix.sum(inW, 'cache_write'), output: ix.sum(inW, 'output'), fresh: ix.sum(inW, 'fresh') };
  const total = t.fresh + t.cache_write + t.cache_read + t.output;
  if (!total) { el.replaceChildren(BX.el('p', 'bx-note', 'No token counts in this period.')); return; }
  const parts = [['cache_read', 'Cache read', 1], ['cache_write', 'Cache write', 0.5], ['output', 'Output', 0.32], ['fresh', 'Fresh input', 0.7]];
  const bar = BX.el('div', 'bx-mix-bar'), legend = BX.el('div', 'bx-mix-legend is-four');
  parts.forEach(([f, label, o], i) => {
    const color = i === 0 ? BX.accent() : 'var(--color-fg-muted)';
    const seg = BX.el('div', 'bx-mix-seg');
    seg.style.width = `${(t[f] / total) * 100}%`;
    seg.style.background = color;
    seg.style.opacity = o;
    bar.append(seg);
    const it = BX.el('div', 'bx-mix-item');
    const head = BX.el('span', 'bx-legend-item');
    const sw = BX.swatch(color);
    sw.style.opacity = o;
    head.append(sw, label);
    it.append(head, BX.el('b', null, BX.tok(t[f])), BX.el('span', null, `${t[f] / total < 0.001 ? '<0.1%' : d3.format('.1%')(t[f] / total)} of all tokens`));
    legend.append(it);
  });
  el.replaceChildren(bar, legend);
});

dash.draw('cache-trend', (el) => {
  if (!BX.guard(el)) return;
  const p = BX.params();
  const cr = BX.bucketTable(p.period, 'cache_read', false), fr = BX.bucketTable(p.period, 'fresh', false), cw = BX.bucketTable(p.period, 'cache_write', false);
  const data = cr.rows.map((r, i) => { const inp = (r._ || 0) + (fr.rows[i]._ || 0) + (cw.rows[i]._ || 0); return { b: r.b, v: inp ? (r._ || 0) / inp : null }; });
  const vals = data.filter((d) => d.v != null);
  const W = Math.max(300, el.clientWidth || 560), H = 140, mt = 24, mb = 22;
  const svg = BX.svg(el, W, H, 'Cache hit rate over time');
  if (!vals.length) return;
  const lo = Math.max(0, Math.min(0.9, Math.floor((d3.min(vals, (d) => d.v) - 0.01) * 20) / 20));
  const y = d3.scaleLinear([lo, 1], [H - mb, mt]);
  const ticks = d3.range(lo, 1.0001, (1 - lo) / 2).map((v) => Math.round(v * 100) / 100);
  const ml = BX.measureText(svg, ticks.map(d3.format('.0%'))) + 10;
  const x = d3.scalePoint(cr.keys, [ml + 26, W - 44]);
  BX.grid(svg, y, ticks, ml, W - 44, d3.format('.0%'));
  svg.append('text').attr('x', ml).attr('y', 10).text('Cache hit rate');
  svg.append('path').datum(vals).attr('d', d3.line().x((d) => x(d.b)).y((d) => y(d.v))).style('fill', 'none').style('stroke', BX.accent()).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
  svg.append('g').selectAll('circle').data(vals).join('circle').attr('cx', (d) => x(d.b)).attr('cy', (d) => y(d.v)).attr('r', 2).style('fill', BX.accent());
  svg.append('g').selectAll('text').data(BX.xTicks(cr.keys, cr.weekly, x, 46, W - 44)).join('text').attr('x', (d) => d.px).attr('y', H - 6).attr('text-anchor', 'middle').text((d) => d.t);
  const e = vals[vals.length - 1];
  svg.append('circle').attr('cx', x(e.b)).attr('cy', y(e.v)).attr('r', 3.5).style('fill', BX.accent());
  svg.append('text').attr('class', 'bx-lab-strong').attr('x', x(e.b) + 7).attr('y', y(e.v) + 4).text(BX.pct(e.v));
});

// ---- Projects ----------------------------------------------------------------------------------------------

const projRows = () => BX.rows('projects').filter((r) => r.period === BX.params().period).sort((a, b) => a.rank - b.rank);
dash.draw('proj-top', (el) => topMark(el, projRows(), 'project', String));
dash.draw('proj-top-share', (el) => topMark(el, projRows(), 'share', BX.pct));
dash.draw('project-timeline', (el) => {
  if (!BX.guard(el, ['projects', 'sessions', 'summary'])) return;
  const p = BX.params(), w = BX.win(p.period);
  const top = projRows().slice(0, 10);
  if (!top.length || !w) { el.replaceChildren(BX.el('p', 'bx-note', 'No sessions in this period.')); return; }
  const pick = p.project && top.some((t) => t.project === p.project) ? p.project : top[0].project;
  const names = new Set(top.map((r) => r.project));
  const inW = BX.inWin(p.period);
  const dots = new Map();
  BX.rows('sessions').forEach((r) => {
    if (!inW(r.date) || !names.has(r.project)) return;
    const k = `${r.project}|${BX.day(r.date)}`;
    const d = dots.get(k) || { project: r.project, date: BX.day(r.date), out: 0, n: 0, prompts: 0 };
    d.out += +r.output || 0; d.n += 1; d.prompts += +r.prompts || 0;
    dots.set(k, d);
  });
  const W = Math.max(300, el.clientWidth || 900), row = 30, TOP = 22;
  const H = TOP + top.length * row + 26;
  const svg = BX.svg(el, W, H, 'Project activity over the period');
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const label = (r) => trunc(r.project, W < 560 ? 16 : 32);
  const LM = Math.min(W * 0.34, BX.measureText(svg, top.map(label), 'bx-lab-strong') + 14);
  const RM = W < 560 ? 52 : 110;
  const x = d3.scaleUtc([BX.parse(w.from), d3.utcDay.offset(BX.parse(w.to), 1)], [LM + 8, W - RM - 10]);
  const rmax = d3.max([...dots.values()], (d) => d.out) || 1;
  const r = d3.scaleSqrt([0, rmax], [2.5, Math.min(11, row / 2 - 2)]);
  const xt = x.ticks(W < 560 ? 3 : 6);
  svg.append('g').selectAll('line').data(xt).join('line').attr('x1', x).attr('x2', x).attr('y1', TOP - 6).attr('y2', H - 22).attr('stroke-width', 1).style('stroke', 'var(--cds-chart-grid)');
  svg.append('g').selectAll('text').data(xt).join('text').attr('x', x).attr('y', H - 6).attr('text-anchor', 'middle').text(d3.utcFormat(p.period === 'all' ? '%b' : '%b %-d'));
  svg.append('text').attr('x', W - 4).attr('y', 12).attr('text-anchor', 'end').text('Output');
  const g = svg.append('g').selectAll('g').data(top).join('g').attr('transform', (d, i) => `translate(0,${TOP + i * row})`);
  g.append('line').attr('x1', LM + 8).attr('x2', W - RM - 10).attr('y1', row / 2).attr('y2', row / 2).attr('stroke-width', 1).style('stroke', 'var(--bx-hair)');
  g.append('text').attr('class', 'bx-lab-strong').attr('x', 0).attr('y', row / 2 + 4).text(label);
  g.append('text').attr('x', W - 4).attr('y', row / 2 + 4).attr('text-anchor', 'end').text((d) => BX.tok(d.output));
  const tip = BX.tipBox(el);
  const rowOf = new Map(top.map((t, i) => [t.project, i]));
  svg.append('g').selectAll('circle').data([...dots.values()]).join('circle')
    .attr('cx', (d) => x(d3.utcHour.offset(BX.parse(d.date), 12))).attr('cy', (d) => TOP + rowOf.get(d.project) * row + row / 2).attr('r', (d) => (d.out ? r(d.out) : 2.5))
    .style('fill', (d) => (d.project === pick ? BX.accent() : 'var(--color-fg)')).attr('fill-opacity', (d) => (d.project === pick ? 0.9 : 0.4)).style('cursor', 'pointer')
    .on('pointermove', (event, d) => {
      tip.replaceChildren(BX.el('div', 'bx-tip-h', BX.shortDay(BX.parse(d.date))), BX.el('div', 'bx-tip-t', d.project), BX.el('div', 'bx-tip-v', `${BX.tok(d.out)} output tokens`), BX.el('div', 'bx-tip-f', `${BX.count(d.n, 'sessions')} · ${BX.count(d.prompts, 'prompts')}`));
      tip.hidden = false; BX.place(tip, el, event);
    })
    .on('pointerleave', leave(el, tip))
    .on('click', (event, d) => { if (tapFirst(el, event, d.project + d.date, () => { tip.hidden = false; BX.place(tip, el, event); })) BX.goDay(d.date); });
});
dash.draw('project-table', (tb) => {
  if (BX.status(['projects', 'summary']) !== 'ok') { tb.replaceChildren(); return; }
  const rows = projRows();
  const pick = BX.params().project;
  tb.replaceChildren(...rows.map((r) => {
    const tr = document.createElement('tr');
    tr.dataset.key = r.key;
    tr.className = 'is-click' + (r.project === pick ? ' is-picked' : '');
    tr.tabIndex = 0;
    const choose = () => dash.setParams({ project: r.project === pick ? null : r.project });
    tr.addEventListener('click', choose);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(); });
    const share = td(null);
    const wrap = BX.el('div', 'bx-bar');
    wrap.style.gridTemplateColumns = 'minmax(4rem, 1fr) 3rem';
    const track = BX.el('div', 'bx-bar-track');
    const fill = BX.el('div', 'bx-bar-fill');
    fill.style.width = `${r.share * 100}%`;
    fill.style.background = BX.accent();
    track.append(fill);
    wrap.append(track, BX.el('span', 'bx-bar-val', BX.pct(r.share)));
    share.append(wrap);
    tr.append(td(r.project, 'is-title'), share, td(BX.fmt(r.sessions), 'is-num is-sec'), td(BX.fmt(r.days), 'is-num is-sec'), td(BX.hours(r.active_hours), 'is-num is-sec'), td(BX.fmt(r.subagents), 'is-num is-sec'), td(BX.tok(r.output), 'is-num'), td(d3.format(',.2f')(+r.cost_usd || 0), 'is-num is-sec'));
    return tr;
  }));
});

// ---- Data-driven switches and announcements ----------------------------------------------------

dash.draw('when-day', (el) => {
  const k = BX.status(['sessions', 'subagents']) === 'ok' ? BX.selDay() : null;
  const rows = k ? BX.rows(el.dataset.kind).filter((r) => BX.day(r.date) === k) : [];
  setWhen(el, rows.length > 0);
});
dash.draw('when-workflows', (el) => {
  const inW = BX.inWin(BX.params().period);
  setWhen(el, BX.rows('workflows').some((w) => inW(w.date)));
});
const VIEW_NAME = { overview: 'Overview', activity: 'Activity', models: 'Models', work: 'Ways of working', delegation: 'Delegation', value: 'Value', projects: 'Projects', method: 'Method' };
dash.draw('announce', (el) => {
  const p = BX.params();
  const day = p.view === 'activity' && p.day && BX.parse(p.day) ? `, ${BX.longDay(BX.parse(p.day))}` : '';
  el.textContent = `${VIEW_NAME[p.view]}${day}, ${p.period === 'all' ? 'all time' : 'last ' + p.period.replace('d', ' days')}`;
});
