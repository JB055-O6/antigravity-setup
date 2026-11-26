"""Score benchmark v3 runs (spec section 10).

Usage: python3 -I score3.py <r3 dir>                     table per task x setup, with paired verdicts
       python3 -I score3.py --valid <run.jsonl>          exit 0 when the run counts (bench3.sh skip/retry)
       python3 -I score3.py --meter <r3 dir> [max age s] go | wait <s> <why> | stale <why>

A run is <setup>-<task>-<rep>.jsonl (claude stream-json) plus <name>.grade from run3.sh.
It passes when the session ended in success, every regex rule in fixture3/TASKS.md matches
the answer, the cmd rule exited 0, and (fixture tasks) the test and log hashes held.
A timeout (exit 124) is a fail. A harness fault is INVALID: left out with a WARN, so bench3.sh
runs it again: no .grade, a failed rtk check or graph build, no init event, no result without
a timeout, an API or usage-limit error (or a rate_limit_event with status rejected), the wrong
plugin set, or a tool input that names the repo, the grading files, the results, the bench work
root outside its own dir, or another run's work dir (a possible leak).
Failed runs count as fails and stay out of every mean; means are over passed runs.
Tokens sum every model in modelUsage, so subagent tokens count (result.usage is the main loop only).
norm $: the run repriced with every input token (uncached, cache write, cache read) at the
model's base input price, so a cold or warm prompt cache cannot move it. Display only:
verdicts use the raw total_cost_usd.
"""

import glob
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the fixture
sys.path.insert(0, os.path.join(HERE, "fixture3"))
import test_gen  # noqa: E402  the TASKS.md parser that test_gen.py checks

TASKS = test_gen.tasks()
SETUPS = ("A0", "A", "B", "C", "D", "E", "F")
CMP = {"B": "A", "C": "A", "D": "C", "E": "C", "F": "C"}  # cost base per setup (spec 10 rule 2); A0 is a reference
ACTED = ("agent", "cheap", "rtk", "graph")
LIMIT = 0.85  # 5 h use at which all lanes wait for the reset (the mod's economy starts at 90%)
WEEK_LIMIT = 0.83  # week use at which all lanes wait; economy starts at 85%, and a run can cross mid-session
METER_AGE = 900  # s; an older 5 h reading is stale
# $ per MTok: input, output, cache write 5 m, cache write 1 h, cache read. Every run checks it against costUSD.
PRICE = {
    "claude-opus-5-5": (4, 20, 5, 8, 0.2),
    "claude-sonnet-5-5": (2, 10, 2.5, 4, 0.1),
    "claude-haiku-5-5": (0.1, 0.5, 0.125, 0.2, 0.01),
}
NAME = re.compile(r"(A0|[A-F])-(T\d(?:-big)?)-(\w+)\.jsonl$")
RTK = re.compile(r"(?:^|[;&|]\s*)rtk\s")
GRAPH = re.compile(r"(?:^|[;&|]\s*)graphify\s")
# The work dir spells the repo as -home-user-antigravity-setup, so it does not match.
LEAK = re.compile(r"/home/user/antigravity-setup|TASKS\.md|fixture3|\bgrading\b|/r3\b|\br3/|\.claude/projects")
RUN_DIR = re.compile(r"(?<![\w-])(?:A0|[A-F])-T\d(?:-big)?-\w+")  # another run's work dir (e.g. ../../2/C-T3-1)
# Limit and API messages of the CLI (2.1.332): "You've hit your 5-hour limit", "... weekly limit",
# "You've reached your Fable limit", "You're out of usage credits", "API Error: ...".
API_FAULT = re.compile(r"(?i)usage limit|limit reached|overloaded|api error|hit your .*limit|reached your .*limit"
                       r"|out of (?:usage|extra usage)")


def events(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except ValueError:
                continue  # stderr noise
            if isinstance(d, dict):
                yield d


def load(path, warns):
    """One run as a dict, or None (with an INVALID warning) when the harness cannot vouch for it."""
    name = os.path.basename(path)[:-6]
    setup, task, rep = NAME.match(os.path.basename(path)).groups()

    def invalid(why):
        warns.append(f"{name}: INVALID, {why}; run left out")

    res = init = None
    bash, agents, inputs, rejected = {}, set(), [], False
    for d in events(path):
        t = d.get("type")
        if t == "result":
            res = d
        elif t == "system" and d.get("subtype") == "init":
            init = d
        elif t == "rate_limit_event":  # status, not overageStatus, says the request was refused
            info = d.get("rate_limit_info") or {}
            rejected |= "rejected" in [info.get("status")] + [w.get("status") for w in
                                                               (info.get("unifiedWindows") or {}).values()]
        elif t == "assistant":  # main loop and subagents (parent_tool_use_id set)
            for b in (d.get("message") or {}).get("content") or []:
                if b.get("type") != "tool_use":
                    continue
                inputs.append((b.get("name"), json.dumps(b.get("input"))))
                if b.get("name") == "Bash":  # a message can arrive in several events, so key by id
                    bash[b.get("id")] = (b.get("input") or {}).get("command") or ""
                elif b.get("name") in ("Agent", "Task") and not d.get("parent_tool_use_id"):
                    agents.add(b.get("id"))
    g = {}
    try:
        with open(path[:-6] + ".grade", encoding="utf-8") as fh:
            for line in fh:
                k, _, v = line.rstrip("\n").partition(" ")
                if k in ("plugin", "hashes", "cmd", "exit", "rtk", "graph", "userskills"):
                    g[k] = v
    except OSError:
        return invalid("no .grade file (run3.sh did not finish)")
    if setup in ("D", "F") and g.get("rtk") != "0":
        return invalid(f"rtk check {g.get('rtk', 'missing')} (D and F would run as C)")
    if setup in ("E", "F") and g.get("graph") != "0":
        return invalid(f"graph build {g.get('graph', 'missing')} (E and F would run as C)")
    if not init:
        return invalid(f"no init event, exit {g.get('exit', '?')} (the session did not start)")
    plugins = init.get("plugins") or []
    if setup == "A0":  # in case --safe-mode is ignored: plugins, MCP servers, user and plugin skills
        builtin = {p.get("name") for p in plugins if p.get("path") == "builtin"}
        user = set(g.get("userskills", "").split())
        extra = [p.get("name") for p in plugins if p.get("path") != "builtin"]
        extra += [f"MCP {m.get('name')}" for m in init.get("mcp_servers") or []]
        extra += [f"skill {k}" for k in init.get("skills") or []
                  if (":" in k and k.split(":")[0] not in builtin) or k in user]
        if extra:
            return invalid(f"A0 is pure stock, but {', '.join(map(str, extra))} loaded")
    else:
        want = [] if g.get("plugin", "none") == "none" else [os.path.realpath(g["plugin"])]
        got = [os.path.realpath(p.get("path", "")) for p in plugins if p.get("name") == "company"]
        if got != want:
            return invalid(f"company plugin {got or 'absent'}, setup wants {want or 'none'}")
    cwd = init.get("cwd") or ""
    root = os.path.dirname(os.path.dirname(cwd)) if os.path.basename(cwd) == name else ""  # bench work root
    for tool, text in inputs:
        m = LEAK.search(text)
        other = next((x for x in RUN_DIR.findall(text) if x != name), None)
        if m or other or (root and root in text.replace(cwd, "")):
            what = m.group(0) if m else other or "the bench work root"
            return invalid(f"possible leak: {tool} input names {what}")
    if rejected:
        return invalid("a rate_limit_event says rejected (the usage limit was hit)")
    res = res or {}
    if not res and g.get("exit") != "124":
        return invalid(f"no result, exit {g.get('exit', '?')} (not a timeout)")
    if res.get("is_error") and API_FAULT.search(f"{res.get('subtype')} {res.get('result')}"):
        return invalid(f"API or limit error: {str(res.get('result'))[:80]}")

    row = TASKS[task]
    if not res:
        why = "timeout"
    elif res.get("is_error") or res.get("subtype") != "success":
        why = res.get("subtype") or "error"
    elif task != "T1-big" and g.get("hashes") != "0":
        why = "hashes"
    elif row["kind"] == "cmd" and g.get("cmd") != "0":
        why = "cmd"
    elif row["kind"] == "regex" and not all(re.search(rx, res.get("result") or "") for rx in row["rules"]):
        why = "answer"
    else:
        why = ""

    mu = res.get("modelUsage") or {}
    tok = {k: sum(v.get(f, 0) for v in mu.values()) for k, f in
           (("u", "inputTokens"), ("cc", "cacheCreationInputTokens"), ("cr", "cacheReadInputTokens"),
            ("out", "outputTokens"))}
    norm, priced, off = (0.0 if mu else None), 0.0, set()
    for model, v in mu.items():
        p = PRICE.get(v.get("canonicalModel") or model.split("[")[0])
        if not p:
            off.add(model)
            norm = None
            break
        pin, pout, w5, w1, rd = p
        c1 = v.get("cacheCreationEphemeral1hInputTokens", 0)
        u, cc, cr, o = (v.get(f, 0) for f in ("inputTokens", "cacheCreationInputTokens", "cacheReadInputTokens",
                                               "outputTokens"))
        priced += (u * pin + (cc - c1) * w5 + c1 * w1 + cr * rd + o * pout) / 1e6
        norm += ((u + cc + cr) * pin + o * pout) / 1e6
    cost = res.get("total_cost_usd") or 0.0
    if norm is not None and abs(priced - cost) > 0.02 * cost + 1e-6:
        off.update(mu)
    acted = {k for k, hit in (("agent", agents), ("cheap", any("opus" not in m for m in mu)),
                              ("rtk", any(RTK.search(c) for c in bash.values())),
                              ("graph", any(GRAPH.search(c) for c in bash.values()))) if hit}
    return {"name": name, "setup": setup, "task": task, "rep": rep, "ok": not why, "why": why, "cost": cost,
            "norm": norm, "in": tok["u"] + tok["cc"] + tok["cr"], **tok, "acted": acted,
            "denied": len(res.get("permission_denials") or []), "price_off": off}


def collect(d):
    runs, warns, off = [], [], Counter()
    for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        if not NAME.match(os.path.basename(f)):
            warns.append(f"{os.path.basename(f)}: name is not <setup>-<task>-<rep>.jsonl; left out")
            continue
        r = load(f, warns)
        if r:
            off.update(r.pop("price_off"))
            runs.append(r)
    warns += [f"price table off for {m} in {n} runs: norm $ is wrong until PRICE is fixed" for m, n in sorted(off.items())]
    return runs, warns


def stats(runs):
    ok = [r for r in runs if r["ok"]]

    def mean(k):
        vals = [r[k] for r in ok]
        return sum(vals) / len(vals) if vals and None not in vals else None

    return {"n": len(runs), "pass": len(ok), "fail": len(runs) - len(ok),
            "why": Counter(r["why"] for r in runs if not r["ok"]), **{k: mean(k) for k in
            ("cost", "norm", "u", "cc", "cr", "out")}}


def pairs(x, base):
    """(x cost, base cost) for each rep where both passed."""
    b = {r["rep"]: r["cost"] for r in base if r["ok"]}
    return [(r["cost"], b[r["rep"]]) for r in x if r["ok"] and r["rep"] in b]


def verdict(x, base, stock):
    """Spec 10 decision rules for one task: setup runs x against base runs (cost) and stock runs (passes).

    Rule 1: x fails no task that stock passes: its pass rate is not below stock's (base stands in
    when stock did not run the task, as for T1-big). Rule 2: over at least 2 reps where both passed,
    x's mean cost is at least 5% below base's and x is cheaper in at least 3 of 4 pairs (2 of 2 at
    n=2; in general ceil(0.75 n)). keep: both hold. drop: rule 1 fails, x is at least 5% dearer and
    dearer in that many pairs, or 6 reps ran with no proof. unclear: inside the noise, so add runs.
    """
    def rate(runs):
        return sum(r["ok"] for r in runs) / len(runs)

    ref = stock or base
    if x and ref and rate(x) < rate(ref):
        return "drop", "fails a task stock passes"
    p = pairs(x, base)
    n, need = len(p), math.ceil(0.75 * len(p))
    tag = "no passed pairs"
    if p:
        mx, mb = (sum(q[i] for q in p) / n for i in (0, 1))
        lower = sum(a < c for a, c in p)
        tag = f"{(mx - mb) / mb:+.1%}, {lower}/{n} cheaper" if mb else f"{lower}/{n} cheaper"
        if n >= 2 and mx <= 0.95 * mb and lower >= need:
            return "keep", tag
        if n >= 2 and mx >= 1.05 * mb and sum(a > c for a, c in p) >= need:
            return "drop", tag + ", dearer"
    if len({r["rep"] for r in x}) >= 6:
        return "drop", tag + ", no proof after 6 reps"
    return "unclear", tag + ", add runs"


def table(runs):
    cells = defaultdict(list)
    for r in runs:
        cells[(r["task"], r["setup"])].append(r)

    def num(v, f="{:.0f}"):
        return "-" if v is None else f.format(v)

    out = ["task | setup | n | pass | fail | mean $ | norm $ | uncached | cache_create | cache_read | out"
           " | modules acted | denied | vs A0 | verdict"]
    for task in TASKS:
        for s in SETUPS:
            c = cells.get((task, s))
            if not c:
                continue
            st = stats(c)
            fail = str(st["fail"]) + (" (" + ", ".join(f"{k} {v}" for k, v in sorted(st["why"].items())) + ")"
                                      if st["fail"] else "")
            acted = " ".join(f"{k} {sum(k in r['acted'] for r in c)}" for k in ACTED
                             if any(k in r["acted"] for r in c)) or "-"
            p = pairs(c, cells.get((task, "A0"), [])) if s != "A0" else []
            mx, mb = (sum(q[i] for q in p) for i in (0, 1))
            vs0 = f"{(mx - mb) / mb:+.1%} ({len(p)} pairs)" if p and mb else "-"
            v = "-"
            if cells.get((task, CMP.get(s))):
                word, why = verdict(c, cells[(task, CMP[s])], cells.get((task, "A"), []))
                v = f"{word} vs {CMP[s]} ({why})"
            out.append(" | ".join([task, s, str(st["n"]), str(st["pass"]), fail, num(st["cost"], "{:.4f}"),
                                   num(st["norm"], "{:.4f}"), num(st["u"]), num(st["cc"]), num(st["cr"]),
                                   num(st["out"]), acted, str(sum(r["denied"] for r in c)), vs0, v]))
    return out


def meter(d, now=None, max_age=METER_AGE):
    """The 5 h meter from the newest rate_limit_event in any jsonl under d: (state, seconds, why).

    state is go, wait (seconds to the reset + 60) or stale (no reading, or none newer than max_age
    by its file's mtime; the caller takes a fresh reading or waits). It fails closed: a reading
    with no 5 h figure is stale. A week use at WEEK_LIMIT also waits, so the mod's economy mode
    (5 h 90% or week 85%) cannot turn on in some setups and not in others.
    """
    now = time.time() if now is None else now
    files = []
    for f in glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True):
        try:
            files.append((os.path.getmtime(f), f))
        except OSError:
            pass  # gone since the glob
    last = None
    for mtime, f in sorted(files, reverse=True):
        try:
            for e in events(f):
                if e.get("type") == "rate_limit_event":
                    last = e.get("rate_limit_info") or {}
        except OSError:
            continue
        if last is not None:
            break
    if last is None:
        return "stale", 0, "no 5 h reading yet"
    if now - mtime > max_age:
        return "stale", 0, f"newest 5 h reading is {(now - mtime) / 60:.0f} min old"
    w = (last.get("unifiedWindows") or {}).get("five_hour") or (last if last.get("rateLimitType") == "five_hour" else {})
    if not isinstance(w.get("utilization"), (int, float)) or not w.get("resetsAt"):
        return "stale", 0, "newest reading has no 5 h figure"
    u, reset = w["utilization"], w["resetsAt"]
    if (u >= LIMIT or w.get("status") == "rejected") and now < reset:
        return "wait", math.ceil(reset - now) + 60, f"5 h use {u:.0%}"
    wk = (last.get("unifiedWindows") or {}).get("seven_day") or {}
    if isinstance(wk.get("utilization"), (int, float)) and wk["utilization"] >= WEEK_LIMIT and now < (wk.get("resetsAt") or 0):
        return "wait", math.ceil(wk["resetsAt"] - now) + 60, f"week use {wk['utilization']:.0%} (economy starts at 85%)"
    return "go", 0, f"5 h use {u:.0%}"


def main(argv):
    if len(argv) in (3, 4) and argv[1] == "--meter":
        state, s, why = meter(argv[2], max_age=float(argv[3]) if len(argv) == 4 else METER_AGE)
        print(f"{state} {s} {why}" if state == "wait" else f"{state} {why}")
        return 0
    if len(argv) == 3 and argv[1] == "--valid":
        warns = []
        if not NAME.match(os.path.basename(argv[2])):
            sys.exit(f"score3: {argv[2]} is not <setup>-<task>-<rep>.jsonl")
        if not os.path.exists(argv[2]):
            print(f"WARN {argv[2]}: missing")
            return 1
        r = load(argv[2], warns)
        for w in warns:
            print("WARN", w)
        return 0 if r else 1
    if len(argv) != 2:
        sys.exit(__doc__)
    if not os.path.isdir(argv[1]):
        sys.exit(f"score3: no directory {argv[1]}")
    runs, warns = collect(argv[1])
    for w in warns:
        print("WARN", w)
    print("\n".join(table(runs)))
    warm, _ = collect(os.path.join(argv[1], "warm"))
    print(f"spend: ${sum(r['cost'] for r in runs):.4f} in {len(runs)} scored runs, tokens in/out "
          f"{sum(r['in'] for r in runs)}/{sum(r['out'] for r in runs)}; warm-up ${sum(r['cost'] for r in warm):.4f}"
          f" in {len(warm)} runs (INVALID runs and meter probes not counted)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
