"""Score benchmark v3 runs (spec section 10).

Usage: python3 -I score3.py <r3 dir>          table per task x setup, with paired verdicts
       python3 -I score3.py --meter <r3 dir>  seconds to wait before the next run (0: go)

A run is <setup>-<task>-<rep>.jsonl (claude stream-json) plus <name>.grade from run3.sh.
It passes when the session ended in success, every regex rule in fixture3/TASKS.md matches
the answer, the cmd rule exited 0, and (fixture tasks) the test and log hashes held.
A run whose .grade file is missing, or that loaded the wrong company plugin, is left out
with a warning: that is a harness fault, not a task fail.
Failed runs count as fails and stay out of every mean; means are over passed runs.
Tokens sum every model in modelUsage, so subagent tokens count (result.usage is the main loop only).
norm $: the run repriced with every input token (uncached, cache write, cache read) at the
model's base input price, so a cold or warm prompt cache cannot move it. It overweights a
cached prefix, so it is a check on the raw cost; verdicts use the raw cost.
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
SETUPS = "ABCDEF"
CMP = {"B": "A", "C": "A", "D": "C", "E": "C", "F": "C"}  # cost base per setup (spec 10 rule 2)
ACTED = ("agent", "cheap", "rtk", "graph")
LIMIT = 0.85  # 5 h use at which all lanes wait for the reset
# $ per MTok: input, output, cache write 5 m, cache write 1 h, cache read. Every run checks it against costUSD.
PRICE = {
    "claude-opus-5-5": (4, 20, 5, 8, 0.2),
    "claude-sonnet-5-5": (2, 10, 2.5, 4, 0.1),
    "claude-haiku-5-5": (0.1, 0.5, 0.125, 0.2, 0.01),
}
NAME = re.compile(r"([A-F])-(T\d(?:-big)?)-(\w+)\.jsonl$")
RTK = re.compile(r"(?:^|[;&|]\s*)rtk\s")
GRAPH = re.compile(r"(?:^|[;&|]\s*)graphify\s")


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
    """One run as a dict, or None (with a warning) when the harness could not vouch for it."""
    name = os.path.basename(path)[:-6]
    setup, task, rep = NAME.match(os.path.basename(path)).groups()
    res = init = None
    bash, agents = {}, set()
    for d in events(path):
        t = d.get("type")
        if t == "result":
            res = d
        elif t == "system" and d.get("subtype") == "init":
            init = d
        elif t == "assistant":
            for b in (d.get("message") or {}).get("content") or []:
                if b.get("type") != "tool_use":
                    continue
                if b.get("name") == "Bash":  # a message can arrive in several events, so key by id
                    bash[b.get("id")] = (b.get("input") or {}).get("command") or ""
                elif b.get("name") in ("Agent", "Task") and not d.get("parent_tool_use_id"):
                    agents.add(b.get("id"))
    g = {}
    try:
        with open(path[:-6] + ".grade", encoding="utf-8") as fh:
            for line in fh:
                k, _, v = line.rstrip("\n").partition(" ")
                if k in ("plugin", "hashes", "cmd"):
                    g[k] = v
    except OSError:
        warns.append(f"{name}: no .grade file (run3.sh did not finish); run left out")
        return None
    want = None if g.get("plugin", "none") == "none" else os.path.realpath(g["plugin"])
    got = next((os.path.realpath(p.get("path", "")) for p in (init or {}).get("plugins") or []
                if p.get("name") == "company"), None)
    if init and got != want:
        warns.append(f"{name}: company plugin {got or 'absent'}, setup wants {want or 'none'}; run left out")
        return None

    res = res or {}
    row = TASKS[task]
    if not res:
        why = "no result"
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
    if norm is not None and mu and abs(priced - cost) > 0.02 * cost + 1e-6:
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


def verdict(x, base, stock):
    """Spec 10 decision rules for one task: setup runs x against base runs (cost) and stock runs (passes).

    Rule 1: x fails no task that stock passes: its pass rate is not below stock's (base stands in
    when stock did not run the task, as for T1-big). Rule 2: over the reps where both passed, x's mean
    cost is at least 5% below base's and x is cheaper in at least 3 of 4 pairs (2 of 2 at n=2; in
    general ceil(0.75 n)). keep: both hold. drop: rule 1 fails, x is dearer in that many pairs, or
    n=6 brought no proof. unclear: inside the noise, so add runs (adaptive n, up to 6).
    """
    def rate(runs):
        return sum(r["ok"] for r in runs) / len(runs)

    ref = stock or base
    if x and ref and rate(x) < rate(ref):
        return "drop", "fails a task stock passes"
    b = {r["rep"]: r["cost"] for r in base if r["ok"]}
    pairs = [(r["cost"], b[r["rep"]]) for r in x if r["ok"] and r["rep"] in b]
    if not pairs:
        return "unclear", "no passed pairs"
    n, need = len(pairs), math.ceil(0.75 * len(pairs))
    mx, mb = (sum(p[i] for p in pairs) / n for i in (0, 1))
    lower = sum(a < c for a, c in pairs)
    tag = f"{(mx - mb) / mb:+.1%}, {lower}/{n} cheaper" if mb else f"{lower}/{n} cheaper"
    if mx <= 0.95 * mb and lower >= need:
        return "keep", tag
    if mx > mb and sum(a > c for a, c in pairs) >= need:
        return "drop", tag + ", dearer"
    if n >= 6:
        return "drop", tag + ", no proof at n=6"
    return "unclear", tag + ", add runs"


def table(runs):
    cells = defaultdict(list)
    for r in runs:
        cells[(r["task"], r["setup"])].append(r)

    def num(v, f="{:.0f}"):
        return "-" if v is None else f.format(v)

    out = ["task | setup | n | pass | fail | mean $ | norm $ | uncached | cache_create | cache_read | out"
           " | modules acted | denied | verdict"]
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
            v = "-"
            if cells.get((task, CMP.get(s))):
                word, why = verdict(c, cells[(task, CMP[s])], cells.get((task, "A"), []))
                v = f"{word} vs {CMP[s]} ({why})"
            out.append(" | ".join([task, s, str(st["n"]), str(st["pass"]), fail, num(st["cost"], "{:.4f}"),
                                   num(st["norm"], "{:.4f}"), num(st["u"]), num(st["cc"]), num(st["cr"]),
                                   num(st["out"]), acted, str(sum(r["denied"] for r in c)), v]))
    return out


def meter_wait(d, now=None):
    """Seconds to wait before the next run, from the newest 5 h reading in any jsonl under d."""
    now = time.time() if now is None else now
    last = None
    for f in sorted(glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True), key=os.path.getmtime,
                    reverse=True):
        for e in events(f):
            if e.get("type") == "rate_limit_event":
                last = e.get("rate_limit_info") or {}
        if last is not None:
            break
    if not last:
        return 0
    w = (last.get("unifiedWindows") or {}).get("five_hour") or (last if last.get("rateLimitType") == "five_hour" else {})
    reset = w.get("resetsAt") or 0
    if ((w.get("utilization") or 0) >= LIMIT or w.get("status") == "rejected") and now < reset:
        return math.ceil(reset - now) + 60
    return 0


def main(argv):
    if len(argv) == 3 and argv[1] == "--meter":
        print(meter_wait(argv[2]))
        return 0
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
          f" in {len(warm)} runs")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
