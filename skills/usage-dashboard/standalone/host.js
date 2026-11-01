// Standalone host: a small stand-in for the claude.ai Dashboard runtime, so the same page runs as a
// plain HTML artifact (or a local file). Its data comes in window.__DASH_DATA and its default view in
// window.__DASH_PARAMS. It provides the dash.* calls the page uses: data, calc, draw, onData, params,
// setParams, setLink.
(() => {
  const DATA = window.__DASH_DATA || {};
  const DEFAULTS = window.__DASH_PARAMS || {};
  const KEY = 'usage-dashboard-params';
  const KEEP = ['view', 'period', 'mode'];
  const remembered = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  };
  const remember = (p) => {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(KEEP.map((k) => [k, p[k]])))); } catch (e) { /* storage unavailable */ }
  };
  let params = { ...DEFAULTS, ...remembered() };
  const store = {}, calcs = {}, draws = new Map(), onDataFns = [];
  const report = (where, e) => console.error(`[usage dashboard] ${where}: ${e && e.message ? e.message : e}`);
  let scheduled = false;
  let started = false;
  const schedule = () => {
    if (scheduled || !started) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  };
  for (const [id, rows] of Object.entries(DATA)) store[id] = { status: 'ok', data: rows, meta: [] };

  window.dash = {
    data: (id) => store[id] || { status: 'missing', data: [], meta: [] },
    calc: (id, spec) => { calcs[id] = spec; store[id] = { status: 'loading', data: [], meta: [] }; },
    loader: () => {},
    draw: (name, spec) => { if (spec) draws.set(name, spec); else schedule(); },
    onData: (fn) => { onDataFns.push(fn); try { fn(); } catch (e) { report('onData', e); } },
    params: () => ({ ...params }),
    setParams: (p) => { params = p === null ? { ...DEFAULTS } : { ...params, ...p }; remember(params); schedule(); },
    resetParams: () => { params = { ...DEFAULTS }; remember(params); schedule(); },
    colors: [],
    setLink: (name) => { try { history.replaceState(null, '', '#' + name); } catch (e) { /* sandboxed frame */ } },
    refresh: () => {},
  };

  const made = new WeakMap();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
  function render() {
    for (const fn of onDataFns) { try { fn(); } catch (e) { report('onData', e); } }
    for (const [name, spec] of draws) {
      document.querySelectorAll(`[data-draw="${name}"]`).forEach((el) => {
        if (el.closest('[hidden]')) return;
        try {
          if (typeof spec === 'function') spec(el);
          else {
            if (!made.has(el)) { el.replaceChildren(); made.set(el, spec.mount ? spec.mount(el) : undefined); if (ro) ro.observe(el); }
            if (spec.update) spec.update(el, made.get(el));
          }
        } catch (e) { report('draw ' + name, e); }
      });
    }
  }
  function runCalcs() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, c] of Object.entries(calcs)) {
        if (store[id].status === 'ok') continue;
        if (!c.inputs.every((i) => store[i] && store[i].status === 'ok')) continue;
        try { store[id] = { status: 'ok', data: c.fn(...c.inputs.map((i) => store[i].data)), meta: [] }; changed = true; }
        catch (e) { store[id] = { status: 'error', data: [], meta: [] }; report('calc ' + id, e); }
      }
    }
  }
  // Called once the page's own scripts have registered their calcs and drawings.
  window.__dashStart = () => {
    started = true;
    runCalcs();
    render();
    // Fonts and layout settle after the first paint; draw once more so measured labels fit.
    setTimeout(render, 400);
  };
})();
