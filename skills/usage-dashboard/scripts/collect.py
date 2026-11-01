#!/usr/bin/env python3
"""Collect Claude Code / Cowork usage from local transcripts into a durable ledger.

Reads (never writes) the transcripts Claude keeps on this machine:
  ~/.claude/projects/**.jsonl                       Claude Code (CLI + desktop Code tab; $CLAUDE_CONFIG_DIR if set)
  <app>/local-agent-mode-sessions/**/.claude/projects/**.jsonl   Cowork
  <app>/claude-code-sessions/**.json                              desktop session index
where <app> is the Claude desktop app's folder: ~/Library/Application Support/Claude (macOS),
%APPDATA%/Claude (Windows) or ~/.config/Claude (Linux).

Claude deletes transcripts after `cleanupPeriodDays` (default 30), so every run folds what it
finds into a per-machine ledger (<ledger-dir>/<machine>.json) that keeps sessions forever.
Point --ledger-dir at a synced folder on every machine and the export merges all machines.

Then writes row-JSON files for the usage dashboard into --out:
  usage_daily.json   date x model x role (main/subagent): requests, tokens, est. cost
  sessions.json      one row per session per active day
  hourly.json        date x hour activity
  subagents.json     one row per launched sub-agent
  tools.json         date x tool calls, with a work category            (v2)
  models.json        one row per model: first/last use, price estimate  (v2)
  summary.json       board figures per period with the prior period     (v2)

Cost is an estimate at API list prices: each model's rate per "price unit"
(input + 5*output + 0.1*cache read + 2*cache write tokens) is calibrated from the
cost records Claude Code writes into transcripts; models without such records
borrow their family's rate.

Stdlib only. Usage: python3 collect.py [--ledger-dir DIR] [--out DIR] [--machine NAME]
"""
import argparse, collections, datetime as dt, glob, json, os, re, socket, sys

HOME = os.path.expanduser("~")
CLAUDE_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude")
if sys.platform == "darwin":
    APP = os.path.join(HOME, "Library", "Application Support", "Claude")
elif os.name == "nt":
    APP = os.path.join(os.environ.get("APPDATA") or os.path.join(HOME, "AppData", "Roaming"), "Claude")
else:
    APP = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(HOME, ".config"), "Claude")
LEDGER_VERSION = 2
IDLE_GAP = 15 * 60  # seconds; longer pauses do not count as active time
# claude.ai connectors appear as mcp__<opaque id>__<tool>; the id differs per account, so name them by a tool they offer.
CONNECTOR_TOOLS = {"search_works": "OpenAlex", "get_work": "OpenAlex", "search_entities": "OpenAlex",
                   "search_articles": "PubMed", "get_article_metadata": "PubMed", "get_full_text_article": "PubMed",
                   "create_view": "Excalidraw", "guide": "Claude Docs"}
OPAQUE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-")
SERVER_LABEL = {}  # "Connector 1a59" -> "Claude Docs", learned from any recognised tool of that server
CATEGORY = [
    ("Run commands", {"Bash", "Monitor", "TaskStop", "BashOutput", "KillShell"}),
    ("Read and search", {"Read", "Grep", "Glob", "LS", "NotebookRead"}),
    ("Write and edit", {"Edit", "Write", "MultiEdit", "NotebookEdit"}),
    ("Delegate", {"Agent", "Task", "Workflow", "SendMessage", "ListAgents", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"}),
    ("Web research", {"WebSearch", "WebFetch", "Browser"}),
    ("Literature", {"OpenAlex", "PubMed"}),
    ("Publish and share", {"Artifact", "ArtifactData", "ArtifactComments", "SendUserFile", "Claude Docs", "Excalidraw", "PowerPoint"}),
]


def local(ts):
    """ISO timestamp -> local datetime."""
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone()


def project_of(cwd):
    if not cwd:
        return "Unknown"
    if "scratch-workspaces" in cwd:
        return "No folder"
    if cwd.startswith("/sessions/"):
        return "Cowork"
    cwd = re.sub(r"[\\/]\.claude[\\/]worktrees[\\/].*$", "", cwd).rstrip("/\\")
    return re.split(r"[\\/]", cwd)[-1] or cwd


def model_name(model):
    """claude-opus-5-5 -> Opus 5.5, claude-haiku-4-5-20251001 -> Haiku 4.5."""
    m = re.match(r"claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$", model or "")
    if not m:
        return model or "Unknown"
    return f"{m.group(1).capitalize()} {m.group(2)}" + (f".{m.group(3)}" if m.group(3) else "")


def family(model):
    m = re.match(r"claude-([a-z]+)", model or "")
    return m.group(1) if m else "other"


def tool_name(name):
    """Group MCP tools by their server so the mix stays readable."""
    if not name.startswith("mcp__"):
        return name
    parts = name.split("__")
    server, tool = parts[1], parts[-1]
    if OPAQUE.match(server):
        key = "Connector " + server[:4]
        if tool in CONNECTOR_TOOLS:
            SERVER_LABEL[key] = CONNECTOR_TOOLS[tool]
        return key
    if "Browser" in server or "chrome" in server.lower():
        return "Browser"
    if server.startswith("PowerPoint"):
        return "PowerPoint"
    if server.startswith("ccd_") or server in ("terminal", "scheduled-tasks", "visualize"):
        return "App controls"
    return server[:24]


def category_of(tool):
    for label, names in CATEGORY:
        if tool in names:
            return label
    return "Plan and steer"


def blank_usage():
    return {"req": 0, "in": 0, "out": 0, "cr": 0, "cw": 0, "think": 0, "web": 0}


def add_usage(acc, u):
    acc["req"] += 1
    acc["in"] += u.get("input_tokens") or 0
    acc["out"] += u.get("output_tokens") or 0
    acc["cr"] += u.get("cache_read_input_tokens") or 0
    acc["cw"] += u.get("cache_creation_input_tokens") or 0
    acc["think"] += (u.get("output_tokens_details") or {}).get("thinking_tokens") or 0
    acc["web"] += (u.get("server_tool_use") or {}).get("web_search_requests") or 0


def units(u):
    """Price units: tokens weighted by their list-price ratio to fresh input."""
    return u.get("in", 0) + 5 * u.get("out", 0) + 0.1 * u.get("cr", 0) + 2 * u.get("cw", 0)


def nlines(s):
    return len(str(s).splitlines()) if s else 0


def is_prompt(d):
    """A message the person typed (not a tool result, not injected meta)."""
    if d.get("isMeta") or d.get("isSidechain"):
        return False
    c = (d.get("message") or {}).get("content")
    if isinstance(c, str):
        return not c.startswith("<") or c.startswith("<pasted")
    if isinstance(c, list):
        return any(b.get("type") == "text" and not str(b.get("text", "")).startswith("<") for b in c)
    return False


def scan_transcript(path, sidechain=False):
    """Per-file aggregates by local day: usage per model, prompts, hours, tools, lines, active time."""
    days = collections.defaultdict(lambda: collections.defaultdict(blank_usage))
    hours = collections.defaultdict(lambda: [0] * 24)
    prompts = collections.Counter()
    tools = collections.defaultdict(collections.Counter)
    lines = collections.defaultdict(lambda: [0, 0])
    active = collections.Counter()
    seen, seen_tools = set(), set()
    cost_state = None
    prev_t = None
    meta = {"first": None, "last": None, "cwd": None, "title": None, "entrypoint": None, "sid": None}
    with open(path, errors="replace") as fh:
        for line in fh:
            if line.startswith('{"type":"api-request') or line.startswith('{"type":"queue-operation'):
                continue
            if '"cost-state"' in line:
                try:
                    cost_state = json.loads(line).get("modelUsage") or cost_state
                except ValueError:
                    pass
                continue
            if '"usage"' not in line and '"type":"user"' not in line and '"custom-title"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            t = d.get("type")
            if t == "custom-title":
                meta["title"] = d.get("customTitle") or meta["title"]
                continue
            ts = d.get("timestamp")
            if not ts or t not in ("user", "assistant"):
                continue
            meta["sid"] = meta["sid"] or d.get("sessionId")
            meta["cwd"] = meta["cwd"] or d.get("cwd")
            meta["entrypoint"] = meta["entrypoint"] or d.get("entrypoint")
            lt = local(ts)
            day = lt.date().isoformat()
            now = lt.timestamp()
            if prev_t is not None and 0 < now - prev_t <= IDLE_GAP:
                active[day] += now - prev_t
            prev_t = now if prev_t is None else max(prev_t, now)
            if t == "user":
                if not sidechain and is_prompt(d):
                    prompts[day] += 1
            else:
                m = d.get("message") or {}
                for b in m.get("content") or []:
                    if not isinstance(b, dict) or b.get("type") != "tool_use" or b.get("id") in seen_tools:
                        continue
                    seen_tools.add(b.get("id"))
                    name = tool_name(b.get("name") or "?")
                    tools[day][name] += 1
                    inp = b.get("input") or {}
                    if name == "Write":
                        lines[day][0] += nlines(inp.get("content"))
                    elif name == "Edit":
                        lines[day][0] += nlines(inp.get("new_string"))
                        lines[day][1] += nlines(inp.get("old_string"))
                    elif name == "MultiEdit":
                        for e in inp.get("edits") or []:
                            lines[day][0] += nlines(e.get("new_string"))
                            lines[day][1] += nlines(e.get("old_string"))
                u, model = m.get("usage"), m.get("model")
                if not u or not model or model.startswith("<"):
                    continue
                key = m.get("id") or d.get("requestId") or d.get("uuid")
                if key in seen:
                    continue
                seen.add(key)
                add_usage(days[day][model], u)
                hours[day][lt.hour] += 1
            meta["first"] = min(filter(None, [meta["first"], ts]))
            meta["last"] = max(filter(None, [meta["last"], ts]))
    return {"days": {k: dict(v) for k, v in days.items()}, "hours": dict(hours), "prompts": dict(prompts),
            "tools": {k: dict(v) for k, v in tools.items()}, "lines": dict(lines),
            "active": {k: round(v) for k, v in active.items()}, "cost_state": cost_state, "meta": meta}


def desktop_index():
    """cliSessionId -> desktop session metadata (title, model, account, created)."""
    out = {}
    for f in glob.glob(os.path.join(APP, "claude-code-sessions", "*", "*", "*.json")):
        try:
            d = json.load(open(f))
        except (ValueError, OSError):
            continue
        account = f.split(os.sep)[-2][:8]
        key = d.get("cliSessionId") or d.get("sessionId")
        if key and (d.get("createdAt") or 0) > 0:
            out[key] = {"title": d.get("title"), "model": d.get("model"), "account": account,
                        "created": d["createdAt"], "last": d.get("lastActivityAt"),
                        "turns": d.get("completedTurns") or 0, "cwd": d.get("originCwd") or d.get("cwd")}
    return out


def collect(machine):
    index = desktop_index()
    sessions = {}
    roots = [(os.path.join(CLAUDE_DIR, "projects"), "Code", None)]
    for acct_dir in glob.glob(os.path.join(APP, "local-agent-mode-sessions", "*", "*")):
        for proj in glob.glob(os.path.join(acct_dir, "local_*", ".claude", "projects")):
            roots.append((proj, "Cowork", os.path.basename(acct_dir)[:8]))
    for root, surface, account in roots:
        for path in glob.glob(os.path.join(root, "*", "*.jsonl")):
            sid = os.path.basename(path)[:-6]
            s = scan_transcript(path)
            if not s["meta"]["first"]:
                continue
            ix = index.get(sid, {})
            rec = {
                "id": sid, "machine": machine, "surface": surface,
                "account": ix.get("account") or account or "",
                "entrypoint": s["meta"]["entrypoint"] or "",
                "title": ix.get("title") or s["meta"]["title"] or "Untitled session",
                "project": project_of(s["meta"]["cwd"] or ix.get("cwd")),
                "first": s["meta"]["first"], "last": s["meta"]["last"], "tokens": True,
                "days": s["days"], "hours": s["hours"], "prompts": s["prompts"],
                "tools": s["tools"], "lines": s["lines"], "active": s["active"], "cost_state": s["cost_state"],
                "subagents": [],
            }
            subdir = os.path.join(path[:-6], "subagents")
            for sp in glob.glob(os.path.join(subdir, "**", "agent-*.jsonl"), recursive=True):
                ss = scan_transcript(sp, sidechain=True)
                if not ss["days"]:  # never sent a request (a cached or cancelled workflow step)
                    continue
                try:
                    am = json.load(open(sp[:-6] + ".meta.json"))
                except (ValueError, OSError):
                    am = {}
                wf = re.search(r"/workflows/(wf_[^/]+)/", sp)
                rec["subagents"].append({
                    "id": os.path.basename(sp)[6:-6], "type": am.get("agentType") or ("workflow" if wf else "agent"),
                    "workflow": wf.group(1) if wf else "",
                    "desc": (am.get("description") or "")[:120], "first": ss["meta"]["first"],
                    "days": ss["days"], "hours": ss["hours"], "tools": ss["tools"], "lines": ss["lines"],
                    "cost_state": ss["cost_state"],
                })
            sessions[sid] = rec
    # Sessions the desktop app remembers but whose transcript is gone: counts only.
    for sid, ix in index.items():
        if sid in sessions:
            continue
        created = dt.datetime.fromtimestamp(ix["created"] / 1000).astimezone()
        day = created.date().isoformat()
        sessions[sid] = {
            "id": sid, "machine": machine, "surface": "Code", "account": ix["account"], "entrypoint": "claude-desktop",
            "title": ix.get("title") or "Untitled session", "project": project_of(ix.get("cwd")),
            "first": created.isoformat(), "last": created.isoformat(), "tokens": False,
            "model_hint": ix.get("model"), "days": {}, "hours": {}, "prompts": {day: ix.get("turns") or 0},
            "subagents": [],
        }
    return sessions


def merge_ledger(path, machine, fresh):
    try:
        ledger = json.load(open(path))
    except (ValueError, OSError):
        ledger = {"version": LEDGER_VERSION, "machine": machine, "sessions": {}}
    old = ledger["sessions"]
    for sid, rec in fresh.items():
        prev = old.get(sid)
        # A transcript only grows; never let a token-less stub overwrite a real record.
        if prev and prev.get("tokens") and not rec.get("tokens"):
            continue
        old[sid] = rec
    ledger["connectors"] = {**ledger.get("connectors", {}), **SERVER_LABEL}
    ledger["version"] = LEDGER_VERSION
    ledger["updated"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(ledger, fh, separators=(",", ":"))
    os.replace(tmp, path)
    return ledger


def price_rates(ledgers):
    """$ per million price units, per model: observed from cost records, else family, else Opus."""
    cost, unit = collections.Counter(), collections.Counter()
    for lg in ledgers:
        for s in lg["sessions"].values():
            for block in [s] + s.get("subagents", []):
                for model, u in (block.get("cost_state") or {}).items():
                    w = (u.get("inputTokens") or 0) + 5 * (u.get("outputTokens") or 0) + \
                        0.1 * (u.get("cacheReadInputTokens") or 0) + 2 * (u.get("cacheCreationInputTokens") or 0)
                    if w > 0 and (u.get("costUSD") or 0) > 0:
                        cost[model] += u["costUSD"]
                        unit[model] += w
    observed = {m: cost[m] / unit[m] * 1e6 for m in cost}
    fam_cost, fam_unit = collections.Counter(), collections.Counter()
    for m in cost:
        fam_cost[family(m)] += cost[m]
        fam_unit[family(m)] += unit[m]
    fam = {f: fam_cost[f] / fam_unit[f] * 1e6 for f in fam_cost}

    def rate(model):
        if model in observed:
            return observed[model], "observed"
        if family(model) in fam:
            return fam[family(model)], "family"
        return fam.get("opus", 3.0), "opus"
    return rate


def export(ledgers, out, today=None):
    rate = price_rates(ledgers)
    usage, sess_rows, subs = [], [], []
    hourly = collections.defaultdict(lambda: [0, 0])
    tool_rows = collections.Counter()
    ukey = collections.defaultdict(blank_usage)
    model_seen = collections.defaultdict(lambda: [None, None, 0])  # first, last, output
    for lg in ledgers:
        machine = lg.get("machine", "")
        for s in lg["sessions"].values():
            per_day = collections.defaultdict(lambda: {"u": blank_usage(), "cost": 0.0, "models": collections.Counter(), "subs": 0,
                                                       "tools": 0, "add": 0, "rem": 0, "sub_out": 0})
            blocks = [("main", s)] + [("subagent", a) for a in s["subagents"]]
            for role, b in blocks:
                for day, models in b["days"].items():
                    for model, u in models.items():
                        k = ukey[(day, model, role, machine, s["surface"])]
                        for f in blank_usage():
                            k[f] += u.get(f, 0)
                            per_day[day]["u"][f] += u.get(f, 0)
                        per_day[day]["cost"] += units(u) * rate(model)[0] / 1e6
                        per_day[day]["models"][model] += u.get("out", 0)
                        if role == "subagent":
                            per_day[day]["sub_out"] += u.get("out", 0)
                        ms = model_seen[model]
                        ms[0] = min(filter(None, [ms[0], day]))
                        ms[1] = max(filter(None, [ms[1], day]))
                        ms[2] += u.get("out", 0)
                for day, hrs in b["hours"].items():
                    for h, n in enumerate(hrs):
                        if n:
                            hourly[(day, h, machine)][0] += n
                for day, tl in (b.get("tools") or {}).items():
                    for name, n in tl.items():
                        tool_rows[(day, name, role)] += n
                        per_day[day]["tools"] += n
                for day, (add, rem) in (b.get("lines") or {}).items():
                    per_day[day]["add"] += add
                    per_day[day]["rem"] += rem
            for a in s["subagents"]:
                day = local(a["first"]).date().isoformat()
                per_day[day]["subs"] += 1
                tot = blank_usage()
                models = collections.Counter()
                acost = 0.0
                for dd in a["days"].values():
                    for model, u in dd.items():
                        for f in tot:
                            tot[f] += u.get(f, 0)
                        models[model] += u.get("out", 0)
                        acost += units(u) * rate(model)[0] / 1e6
                top = models.most_common(1)[0][0] if models else ""
                subs.append({"id": a["id"], "date": day, "time": local(a["first"]).strftime("%H:%M"),
                             "session": s["id"], "type": a["type"], "workflow": a.get("workflow", ""),
                             "description": a["desc"], "model": top, "model_name": model_name(top),
                             "requests": tot["req"], "input": tot["in"], "output": tot["out"],
                             "cache_read": tot["cr"], "cache_write": tot["cw"], "cost_usd": round(acost, 4),
                             "tool_calls": sum(sum(t.values()) for t in (a.get("tools") or {}).values())})
            for day in s["prompts"]:
                per_day[day]  # ensure the day exists
            for day in (s.get("active") or {}):
                per_day[day]
            for day, pdx in per_day.items():
                u = pdx["u"]
                top = pdx["models"].most_common(1)[0][0] if pdx["models"] else (s.get("model_hint") or "")
                sess_rows.append({
                    "key": f"{day}|{s['id']}", "date": day, "session": s["id"], "title": s["title"],
                    "project": s["project"], "surface": s["surface"], "machine": machine, "account": s["account"],
                    "model": top, "model_name": model_name(top),
                    "tokens_known": s["tokens"], "prompts": s["prompts"].get(day, 0),
                    "requests": u["req"], "subagents": pdx["subs"], "input": u["in"], "output": u["out"],
                    "cache_read": u["cr"], "cache_write": u["cw"], "thinking": u["think"],
                    "subagent_output": pdx["sub_out"], "web_searches": u["web"],
                    "active_min": round((s.get("active") or {}).get(day, 0) / 60, 1),
                    "tool_calls": pdx["tools"], "lines_added": pdx["add"], "lines_removed": pdx["rem"],
                    "cost_usd": round(pdx["cost"], 4),
                    "started": local(s["first"]).isoformat(timespec="minutes"),
                })
    for (day, model, role, machine, surface), u in sorted(ukey.items()):
        usage.append({"date": day, "model": model, "model_name": model_name(model), "role": role, "machine": machine,
                      "surface": surface, "requests": u["req"], "input": u["in"], "output": u["out"],
                      "cache_read": u["cr"], "cache_write": u["cw"], "thinking": u["think"], "web_searches": u["web"],
                      "cost_usd": round(units(u) * rate(model)[0] / 1e6, 4)})
    hourly_rows = [{"date": d, "hour": h, "machine": m, "requests": v[0]} for (d, h, m), v in sorted(hourly.items())]
    names = {}
    for lg in ledgers:
        names.update(lg.get("connectors", {}))
    names.update(SERVER_LABEL)
    named = collections.Counter()
    for (d, t, r), n in tool_rows.items():
        named[(d, names.get(t, t), r)] += n
    tools = [{"key": f"{d}|{t}|{r}", "date": d, "tool": t, "category": category_of(t), "role": r, "calls": n}
             for (d, t, r), n in sorted(named.items())]
    models = []
    for m, (first, last, out_tok) in sorted(model_seen.items(), key=lambda kv: -kv[1][2]):
        r, src = rate(m)
        models.append({"model": m, "model_name": model_name(m), "family": family(m).capitalize(), "first_used": first,
                       "last_used": last, "output": out_tok, "rate_per_munit": round(r, 4), "rate_source": src})
    sess_rows.sort(key=lambda r: (r["date"], r["started"]))
    subs.sort(key=lambda r: (r["date"], r["time"]))
    summary = summarize(usage, sess_rows, subs, hourly_rows, today or dt.date.today())
    os.makedirs(out, exist_ok=True)
    files = [("usage_daily", usage), ("sessions", sess_rows), ("hourly", hourly_rows), ("subagents", subs),
             ("tools", tools), ("models", models), ("summary", summary)]
    for name, rows in files:
        with open(os.path.join(out, name + ".json"), "w") as fh:
            json.dump(rows, fh, separators=(",", ":"))
    return {name: len(rows) for name, rows in files}


PERIODS = [("7d", 7), ("30d", 30), ("90d", 90), ("all", None)]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
NO_SPARK = {"output_per_prompt", "active_days", "workflows", "longest_streak"}


def summarize(usage, sessions, subs, hourly, today):
    """Board figures for each period, with the same-length period before it and a spark series."""
    D = lambda s: dt.date.fromisoformat(s[:10])
    first = min([D(r["date"]) for r in usage] + [D(r["date"]) for r in sessions], default=today)
    daily = collections.defaultdict(collections.Counter)
    sess_by_day = collections.defaultdict(set)
    wf_by_day = collections.defaultdict(set)
    model_out = collections.defaultdict(collections.Counter)
    for r in usage:
        c = daily[D(r["date"])]
        c["requests"] += r["requests"]; c["output"] += r["output"]; c["fresh"] += r["input"]
        c["cache_read"] += r["cache_read"]; c["cache_write"] += r["cache_write"]; c["cost_usd"] += r["cost_usd"]
        c["tokens"] += r["input"] + r["output"] + r["cache_read"] + r["cache_write"]
        if r["role"] == "subagent":
            c["sub_output"] += r["output"]
        model_out[D(r["date"])][r["model_name"]] += r["output"]
    for r in sessions:
        c = daily[D(r["date"])]
        c["prompts"] += r["prompts"]; c["active_min"] += r["active_min"]; c["lines_added"] += r["lines_added"]
        c["tool_calls"] += r["tool_calls"]
        sess_by_day[D(r["date"])].add(r["session"])
    for r in subs:
        daily[D(r["date"])]["subagents"] += 1
        if r["workflow"]:
            wf_by_day[D(r["date"])].add(r["workflow"])
    hour_by_day = collections.defaultdict(lambda: [0] * 24)
    for r in hourly:
        hour_by_day[D(r["date"])][r["hour"]] += r["requests"]

    def window(start, end):
        days = [start + dt.timedelta(n) for n in range((end - start).days + 1)]
        tot = collections.Counter()
        for d in days:
            tot.update(daily.get(d, {}))
        sess = set().union(*[sess_by_day.get(d, set()) for d in days]) if days else set()
        wfs = set().union(*[wf_by_day.get(d, set()) for d in days]) if days else set()
        active = {d for d in days if d in daily and (daily[d]["requests"] or daily[d]["prompts"])}
        streak = best = 0
        for d in days:
            streak = streak + 1 if d in active else 0
            best = max(best, streak)
        mo = collections.Counter()
        wk, hr = [0] * 7, [0] * 24
        for d in days:
            mo.update(model_out.get(d, {}))
            for h, n in enumerate(hour_by_day.get(d, [])):
                wk[d.weekday()] += n
                hr[h] += n
        inp = tot["fresh"] + tot["cache_read"] + tot["cache_write"]
        v = {
            "sessions": len(sess), "prompts": tot["prompts"], "active_hours": round(tot["active_min"] / 60, 1),
            "requests": tot["requests"], "tokens": tot["tokens"], "output": tot["output"],
            "subagents": tot["subagents"], "workflows": len(wfs), "tool_calls": tot["tool_calls"],
            "lines_added": tot["lines_added"], "cost_usd": round(tot["cost_usd"], 2), "active_days": len(active),
            "longest_streak": best,
            "cache_hit_rate": round(tot["cache_read"] / inp, 4) if inp else None,
            "subagent_share": round(tot["sub_output"] / tot["output"], 4) if tot["output"] else None,
            "output_per_prompt": round(tot["output"] / tot["prompts"]) if tot["prompts"] else None,
        }
        t = {}
        if mo:
            name, out_tok = mo.most_common(1)[0]
            t["top_model"] = (round(out_tok / sum(mo.values()), 4), name)
        if any(wk):
            t["peak_weekday"] = (max(wk), WEEKDAYS[wk.index(max(wk))])
            t["peak_hour"] = (max(hr), f"{hr.index(max(hr)):02d}:00")
        return v, t, days

    def spark(metric, days, weekly):
        if metric in NO_SPARK:
            return ""
        buckets = collections.OrderedDict()
        for d in days:
            k = d - dt.timedelta(d.weekday()) if weekly else d
            buckets.setdefault(k, 0)
            if metric in ("cache_hit_rate", "subagent_share"):
                buckets.setdefault((k, "n"), 0)
                buckets.setdefault((k, "d"), 0)
                c = daily.get(d, {})
                buckets[(k, "n")] += c.get("cache_read" if metric == "cache_hit_rate" else "sub_output", 0)
                buckets[(k, "d")] += (c.get("fresh", 0) + c.get("cache_read", 0) + c.get("cache_write", 0)) if metric == "cache_hit_rate" else c.get("output", 0)
            elif metric == "sessions":
                buckets[k] += len(sess_by_day.get(d, ()))
            elif metric == "active_hours":
                buckets[k] += daily.get(d, {}).get("active_min", 0) / 60
            else:
                buckets[k] += daily.get(d, {}).get(metric, 0)
        if metric in ("cache_hit_rate", "subagent_share"):
            keys = [k for k in buckets if not isinstance(k, tuple)]
            return ",".join(str(round(buckets[(k, "n")] / buckets[(k, "d")], 4)) if buckets[(k, "d")] else "" for k in keys)
        return ",".join(str(round(x, 2)) for x in buckets.values())

    rows = []
    for period, n in PERIODS:
        start = first if n is None else today - dt.timedelta(n - 1)
        cur, text, days = window(start, today)
        prev, _, prev_days = window(start - dt.timedelta(n), start - dt.timedelta(1)) if n else ({}, {}, [])
        weekly = n is None or n > 31
        for metric, value in cur.items():
            p = prev.get(metric) if n else None
            rows.append({"key": f"{period}|{metric}", "period": period, "metric": metric, "value": value,
                         "prev": p, "delta": round(value / p - 1, 4) if p and value is not None else None,
                         "text": None, "from": start.isoformat(), "to": today.isoformat(),
                         "spark": spark(metric, days, weekly),
                         "spark_prev": spark(metric, prev_days, weekly) if n else ""})
        for metric, (value, label) in text.items():
            rows.append({"key": f"{period}|{metric}", "period": period, "metric": metric, "value": value, "prev": None,
                         "delta": None, "text": label, "from": start.isoformat(), "to": today.isoformat(), "spark": "", "spark_prev": ""})
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ledger-dir", default=os.path.join(CLAUDE_DIR, "usage-ledger"),
                    help="where per-machine ledgers live; use a synced folder to merge machines")
    ap.add_argument("--out", default=os.path.join(CLAUDE_DIR, "usage-ledger", "export"),
                    help="folder for the dashboards' JSON files")
    ap.add_argument("--machine", default=socket.gethostname().split(".")[0])
    a = ap.parse_args()
    os.makedirs(a.ledger_dir, exist_ok=True)
    fresh = collect(a.machine)
    merge_ledger(os.path.join(a.ledger_dir, a.machine + ".json"), a.machine, fresh)
    ledgers = []
    for f in sorted(glob.glob(os.path.join(a.ledger_dir, "*.json"))):
        try:
            lg = json.load(open(f))
        except (ValueError, OSError) as e:
            print(f"skipping {f}: {e}", file=sys.stderr)
            continue
        if isinstance(lg, dict) and "sessions" in lg:
            ledgers.append(lg)
    counts = export(ledgers, a.out)
    print(json.dumps({"machine": a.machine, "machines": [l.get("machine") for l in ledgers],
                      "sessions_scanned": len(fresh), **counts}))


if __name__ == "__main__":
    main()
