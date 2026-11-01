#!/usr/bin/env python3
"""Prepare everything the usage-dashboard skill publishes, so its own steps stay few and mechanical.

  build     run the collector, then write the page, the dashboard documents and a standalone page
  bind      write the dataset documents once their files are uploaded as artifact assets
  register  remember which artifact holds this user's dashboard (for refreshes)
  status    print what is registered

Everything lands in --home (default ~/.claude/usage-dashboard). Stdlib only; prints JSON.
"""
import argparse, datetime as dt, html, json, os, re, subprocess, sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLAUDE_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
DATASETS = ["usage_daily", "sessions", "hourly", "subagents", "tools", "summary"]
PAGE_FILES = ["index.html", "core.js", "views.js"]
TITLE = "Claude Usage Dashboard"
BLOB = re.compile(r"^/_blob/[0-9a-f]{32}$")
D3 = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"


def now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    return path


def text(path):
    with open(os.path.join(SKILL, path), encoding="utf-8") as fh:
        return fh.read()


def owner_name(given):
    """The name on the page: --owner, else git's user.name, else the account's full name, else "You"."""
    if given:
        return given
    try:
        name = subprocess.run(["git", "config", "--global", "user.name"], capture_output=True, text=True, timeout=5).stdout.strip()
        if name:
            return name
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        import pwd
        name = pwd.getpwuid(os.getuid()).pw_gecos.split(",")[0].strip()
        if name:
            return name
    except (ImportError, KeyError, AttributeError):
        pass
    return "You"


def page(owner, title):
    files = {name: text(os.path.join("page", name)) for name in PAGE_FILES}
    files["index.html"] = files["index.html"].replace("{{OWNER}}", html.escape(owner)).replace("{{TITLE}}", html.escape(title))
    return files


def tokens(t, dark):
    """The host's colour tokens for one theme, from a dash/look palette."""
    mix = lambda a, b, p: f"color-mix(in srgb, {a} {p}%, {b})"
    return {
        "--color-bg": t["ground"], "--color-panel": t["card"], "--color-fg": t["text"], "--color-fg-muted": t["muted"],
        "--color-border-line": t["border"], "--color-ok": t["good"], "--color-warn": t["warning"], "--color-bad": t["bad"],
        "--cds-chart-grid": mix(t["text"], "transparent", 8), "--cds-chart-axis": t["muted"],
        "--cds-chart-muted": mix(t["muted"], t["ground"], 55), "--cds-surface-popover": mix(t["card"], t["text"], 94 if dark else 100),
        "--cds-border": t["border"], "--cds-text-secondary": t["muted"],
        "--cds-shadow-popover": "0 8px 24px #00000066, 0 2px 6px #0004" if dark else "0 8px 24px #0000001f, 0 2px 6px #00000014",
        "color-scheme": "dark" if dark else "light",
    }


def standalone(files, data, params, look, title):
    """The page as a plain artifact: a small shell (tokens for light and dark), app.js (the host stand-in,
    the page's markup and code) and data.js. A refresh replaces app.js and data.js and leaves the shell as it
    is, so nothing large has to be read back first. Also returns the same page as one self-contained file."""
    decl = lambda d: "; ".join(f"{k}: {v}" for k, v in d.items())
    fixed = {
        "--font-anthropic-sans": look["fonts"]["text"], "--font-anthropic-serif": look["fonts"]["display"],
        "--cds-radius": look.get("corners", "6px"), "--cds-font-weight-medium": "500",
        "--cds-dur-slow": ".45s", "--cds-ease-out": "cubic-bezier(.165, .84, .44, 1)",
        **{f"--cds-font-size-{k}": v for k, v in look.get("sizes", {}).items()},
    }
    light, dark = decl(tokens(look["light"], False)), decl(tokens(look["dark"], True))
    css = f"""
  :root {{ {decl(fixed)}; {light}; }}
  @media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ {dark}; }} }}
  :root[data-theme="dark"] {{ {dark}; }}
  :root[data-theme="light"] {{ {light}; }}
  html, body {{ margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: var(--font-anthropic-sans); }}
  #dash-root {{ min-height: 100vh; }}
  .dash-skeleton {{ color: transparent !important; background: color-mix(in srgb, currentColor 10%, transparent); border-radius: 4px; }}"""
    body = re.sub(r'<meta name="dash-one-writer">\s*', "", files["index.html"])
    body = re.sub(r'<script src="[^"]+"></script>\s*', "", body)
    js = lambda v: json.dumps(v, separators=(",", ":")).replace("</", "<\\/")
    app = "\n".join([
        f"window.__DASH_PARAMS = {js(params)};",
        text(os.path.join("standalone", "host.js")),
        f"document.getElementById('dash-root').innerHTML = {js(body)};",
        files["core.js"], files["views.js"], "window.__dashStart();", ""])
    shell = lambda scripts: f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{css}
</style>
<script src="{D3}"></script>
</head>
<body>
<div id="dash-root"></div>
{scripts}
</body>
</html>
"""
    inline = lambda code: "<script>" + code.replace("</script", "<\\/script") + "</script>"
    return {
        "index.html": shell('<script src="data.js"></script>\n<script src="app.js"></script>'),
        "app.js": app,
        "data.js": data_js(data),
        "claude-usage-dashboard.html": shell(inline(data_js(data)) + "\n" + inline(app)),
    }


def data_js(data):
    return "window.__DASH_DATA = " + json.dumps(data, separators=(",", ":")).replace("</", "<\\/") + ";\n"


def cmd_build(a):
    home = a.home
    export = os.path.join(home, "export")
    reg_path = os.path.join(home, "registry.json")
    reg = load(reg_path, {})
    # Remember choices made once (a synced ledger folder, the name, the title) for later refreshes.
    chosen = {k: v for k, v in (("ledger_dir", a.ledger_dir and os.path.abspath(a.ledger_dir)),
                                ("owner", a.owner), ("title", a.title)) if v}
    if chosen:
        reg.update(chosen)
        save(reg_path, reg)
    ledger_dir = reg.get("ledger_dir")
    run = subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "collect.py"), "--out", export]
                         + (["--ledger-dir", ledger_dir] if ledger_dir else []),
                         capture_output=True, text=True)
    if run.returncode != 0:
        sys.exit("collector failed:\n" + run.stderr[-2000:])
    counts = json.loads(run.stdout.strip().splitlines()[-1])
    owner = owner_name(a.owner or reg.get("owner"))
    title = a.title or reg.get("title") or TITLE
    files = page(owner, title)
    store = os.path.join(home, "store")
    out = {"files": [], "dash": [], "datasets": []}
    for name, body in files.items():
        out["files"].append({"doc_id": name, "file_path": save(os.path.join(store, "files", name + ".json"), {"text": body})})
    look = json.loads(text(os.path.join("store", "look.json")))
    params = json.loads(text(os.path.join("store", "params.json")))
    for doc_id, data in (("meta", {"title": title}), ("params", params), ("look", look)):
        out["dash"].append({"doc_id": doc_id, "file_path": save(os.path.join(store, "dash", doc_id + ".json"), data)})
    data = {}
    for ds in DATASETS:
        path = os.path.join(export, ds + ".json")
        data[ds] = load(path, [])
        out["datasets"].append({"id": ds, "file_path": path, "rows": len(data[ds])})
    folder = os.path.join(home, "standalone")
    os.makedirs(folder, exist_ok=True)
    written = {}
    for name, body in standalone(files, data, params, look, title).items():
        written[name] = os.path.join(folder, name)
        with open(written[name], "w", encoding="utf-8") as fh:
            fh.write(body)
    print(json.dumps({"owner": owner, "title": title, "collector": counts, "registered": reg or None,
                      "standalone": {"page": written["index.html"], "app": written["app.js"], "data": written["data.js"],
                                     "single_file": written["claude-usage-dashboard.html"]}, **out}, indent=1))


def cmd_bind(a):
    """dataset id=/_blob/<id> pairs -> complete datasets/<id> documents, ready for one batch write."""
    meta = json.loads(text(os.path.join("store", "datasets.json")))
    out = []
    for pair in a.blob:
        ds, _, url = pair.partition("=")
        if ds not in DATASETS or not BLOB.match(url):
            sys.exit(f"bad --blob {pair!r}: expected <dataset>=/_blob/<32 hex>")
        doc = {**meta[ds], "schedule": a.schedule, "source": {"kind": "file", "url": url, "name": ds + ".json"},
               "updated": {"at": now(), "by": a.by}}
        out.append({"doc_id": ds, "file_path": save(os.path.join(a.home, "store", "datasets", ds + ".json"), doc)})
    print(json.dumps({"datasets": out}, indent=1))


def cmd_register(a):
    path = os.path.join(a.home, "registry.json")
    reg = load(path, {})
    reg.update({k: v for k, v in (("url", a.url), ("mode", a.mode), ("owner", a.owner), ("title", a.title)) if v})
    if a.blob:
        reg["blobs"] = dict(p.partition("=")[::2] for p in a.blob)
    if a.task:
        reg["scheduled_task"] = a.task
    reg["updated"] = now()
    save(path, reg)
    print(json.dumps(reg, indent=1))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--home", default=os.path.join(CLAUDE_DIR, "usage-dashboard"))
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--owner")
    b.add_argument("--title")
    b.add_argument("--ledger-dir", help="passed to the collector; a synced folder merges several machines")
    s = sub.add_parser("bind")
    s.add_argument("--blob", action="append", required=True, metavar="DATASET=/_blob/ID")
    s.add_argument("--by", default="usage-dashboard skill")
    s.add_argument("--schedule", default="Refreshed by the usage-dashboard skill; nightly when a scheduled task is set up.")
    r = sub.add_parser("register")
    r.add_argument("--url")
    r.add_argument("--mode", choices=["dashboard", "standalone"])
    r.add_argument("--owner")
    r.add_argument("--title")
    r.add_argument("--task")
    r.add_argument("--blob", action="append", metavar="DATASET=/_blob/ID")
    sub.add_parser("status")
    a = ap.parse_args()
    if a.cmd == "build":
        cmd_build(a)
    elif a.cmd == "bind":
        cmd_bind(a)
    elif a.cmd == "register":
        cmd_register(a)
    else:
        print(json.dumps(load(os.path.join(a.home, "registry.json"), {}), indent=1))


if __name__ == "__main__":
    main()
