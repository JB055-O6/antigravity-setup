"""Checks score3.py on synthetic runs, and bench3.sh/run3.sh with a stub claude.

Run: python3 -I test_score3.py   (prints ok; needs git, bash and flock; spends nothing)
"""

import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import score3  # noqa: E402

GOOD_T4 = "Line 61,873: PaymentGatewayTimeout. 312 ERROR lines follow it."
OPUS = "claude-opus-5-5"
R = "/plugins/r/company"
BUILTIN = [{"name": "cc-plugin-privacy", "path": "builtin"}]
KEEP = object()  # write(): the default for this setup


def usage(u=6, cc=1000, cr=5000, out=50, c1h=None):
    c1h = cc if c1h is None else c1h
    return {"inputTokens": u, "cacheCreationInputTokens": cc, "cacheReadInputTokens": cr, "outputTokens": out,
            "cacheCreationEphemeral1hInputTokens": c1h, "cacheCreationEphemeral5mInputTokens": cc - c1h}


def write(d, name, cost=0.010024, text=GOOD_T4, models=None, plugin=KEEP, loaded=KEEP, hashes=0, cmds=(), extra=(),
          init=True, result=True, is_error=False, subtype="success", exit=0, prep=KEEP, mcp=(), skills=(),
          cwd=None, grade=()):
    """One run as run3.sh leaves it: <name>.jsonl (stream-json) and <name>.grade.

    The setup comes from the name: A0 loads builtin plugins only, A none of company, others R;
    D/F get `rtk 0`, E/F `graph 0` unless prep says otherwise. The default cost is usage() at Opus 5.5 prices.
    """
    setup = name.split("-")[0]
    if plugin is KEEP:
        plugin = None if setup in ("A0", "A") else R
    if loaded is KEEP:
        loaded = [] if setup in ("A0", "A") else [plugin]
    elif not isinstance(loaded, list):
        loaded = [loaded] if loaded else []
    if prep is KEEP:
        prep = (["rtk 0"] if setup in ("D", "F") else []) + (["graph 0"] if setup in ("E", "F") else [])
    models = models or {OPUS: usage()}
    plugins = BUILTIN + ([] if setup == "A0" else [{"name": "ponytail", "path": "/p"}])
    plugins += [{"name": "company", "path": p} for p in loaded]
    tools = [{"type": "tool_use", "id": f"t{i}", "name": "Bash", "input": {"command": c}} for i, c in enumerate(cmds)]
    ev = ([{"type": "system", "subtype": "init", "plugins": plugins, "mcp_servers": [{"name": m} for m in mcp],
            "skills": list(skills), **({"cwd": cwd} if cwd else {})}] if init else [])
    ev += [{"type": "assistant", "parent_tool_use_id": None, "message": {"content": tools}}, *extra]
    if result:
        ev.append({"type": "result", "subtype": subtype, "is_error": is_error, "result": text, "total_cost_usd": cost,
                   "usage": {"input_tokens": next(iter(models.values()))["inputTokens"]}, "modelUsage": models,
                   "permission_denials": []})
    with open(os.path.join(d, name + ".jsonl"), "w") as fh:
        fh.write("not json: stderr noise\n" + "".join(json.dumps(e) + "\n" for e in ev))
    with open(os.path.join(d, name + ".grade"), "w") as fh:
        fh.write("\n".join([f"plugin {plugin or 'none'}", f"exit {exit}", *prep, *grade, f"hashes {hashes}", "# PASS",
                            ""]))


def tool(name, inp, parent=None):
    return {"type": "assistant", "parent_tool_use_id": parent,
            "message": {"content": [{"type": "tool_use", "id": f"x{abs(hash(str(inp)))}", "name": name, "input": inp}]}}


def cell(runs, setup, task):
    return [r for r in runs if r["setup"] == setup and r["task"] == task]


def invalid(d, name, **kw):
    """write() a run, then return the warnings for it; the run must be left out."""
    write(d, name, **kw)
    runs, warns = score3.collect(d)
    os.remove(os.path.join(d, name + ".jsonl"))
    assert name not in [r["name"] for r in runs], (name, kw)
    return [w for w in warns if w.startswith(name + ":") and "INVALID" in w]


def test_fail_excluded_from_mean(d):
    write(d, "C-T4-1", 0.10)
    write(d, "C-T4-2", 0.20)
    write(d, "C-T4-3", 0.01, text="no idea")  # wrong answer: a fail
    write(d, "C-T4-4", 0.02, hashes=1)  # right answer, but the session changed a test file
    write(d, "C-T4-5", 0.03, result=False, exit=124)  # killed by the timeout: a real fail
    write(d, "C-T4-6", 0.04, is_error=True, subtype="error_max_budget_usd", text="")  # over budget: a fail
    runs, _ = score3.collect(d)
    s = score3.stats(cell(runs, "C", "T4"))
    assert (s["n"], s["pass"], s["fail"]) == (6, 2, 4), s
    assert s["why"] == {"answer": 1, "hashes": 1, "timeout": 1, "error_max_budget_usd": 1}, s
    assert abs(s["cost"] - 0.15) < 1e-9, s


def test_cache_classes_add_up(d):
    # Subagent tokens live only in modelUsage, so result.usage alone would miss them.
    write(d, "C-T6-1", 0.1, text="", models={OPUS: usage(10, 1000, 5000, 50),
                                             "claude-haiku-5-5": usage(5, 200, 700, 20, c1h=0)})
    (r,), _ = score3.collect(d)
    assert (r["u"], r["cc"], r["cr"], r["out"]) == (15, 1200, 5700, 70), r
    assert r["in"] == r["u"] + r["cc"] + r["cr"] == 6915, r
    assert "cheap" in r["acted"], r


def test_norm_cost(d):
    # Opus 5.5 list prices: in 4, 1 h cache write 8, cache read 0.2, out 20 ($ per MTok).
    write(d, "C-T4-1", 0.0142, models={OPUS: usage(1000, 1000, 1000, 100)})
    (r,), warns = score3.collect(d)
    assert abs(r["norm"] - 0.014) < 1e-12, r  # every input token at the base price
    assert not warns, warns
    write(d, "C-T4-1", 0.03, models={OPUS: usage(1000, 1000, 1000, 100)})
    _, warns = score3.collect(d)
    assert any("price" in w for w in warns), warns


def test_paired_rule():
    def runs(costs, oks=None):
        return [{"rep": str(i + 1), "ok": True if oks is None else oks[i], "cost": c} for i, c in enumerate(costs)]

    def v(x, base, stock=()):
        return score3.verdict(x, base, list(stock))[0]

    base = runs([1.0] * 4)
    assert v(runs([0.94] * 4), base, base) == "keep"
    assert v(runs([0.5, 0.5, 1.05, 1.05]), base, base) == "unclear"  # mean -22%, but 2 of 4
    assert v(runs([0.9, 0.9, 1.1, 1.1]), base, base) == "unclear"
    assert v(runs([0.97] * 4), base, base) == "unclear"  # 3% is not enough
    assert v(runs([0.9, 0.9]), runs([1.0, 1.0])) == "keep"  # 2 of 2 at n=2
    assert v(runs([0.9, 1.01]), runs([1.0, 1.0])) == "unclear"
    assert v(runs([0.9]), runs([1.0])) == "unclear"  # 1 passed pair never keeps
    flaky = [True, False]
    assert v(runs([0.9, 0.9], flaky), runs([1.0, 1.0]), runs([1.0, 1.0], flaky)) == "unclear"  # 1 pair left
    assert v(runs([1.2] * 4), base, base) == "drop"  # clearly dearer
    assert v(runs([1.001, 1.001]), runs([1.0, 1.0])) == "unclear"  # dearer 2 of 2, but inside the noise
    assert v(runs([1.04] * 4), base, base) == "unclear"  # dearer 4 of 4, but under 5%
    assert v(runs([0.9, 1.1] * 3), runs([1.0] * 6)) == "drop"  # 6 reps, no proof
    six = [True] * 5 + [False]
    assert v(runs([0.9, 1.1, 0.9, 1.1, 0.9, 5.0], six), runs([1.0] * 6), runs([1.0] * 6, six)) == "drop"  # 6 reps ran
    assert v(runs([0.9, 1.1, 0.9, 1.1, 0.9], six[:5]), runs([1.0] * 5)) == "unclear"  # 5 reps: add runs
    stock = runs([1.0, 1.0])
    assert v(runs([0.5, 0.5], [True, False]), runs([1.0, 1.0]), stock) == "drop"
    # A failed run leaves its pair out; the rest still decide (stock failed as often, so rule 1 holds).
    flaky = [True, True, False]
    assert v(runs([0.9, 0.9, 5.0], flaky), runs([1.0] * 3), runs([1.0] * 3, flaky)) == "keep"


def test_drop_when_stock_passes(d):
    for rep in "12":
        write(d, f"A-T4-{rep}", 1.0)
        write(d, f"C-T4-{rep}", 1.0)
        write(d, f"A0-T4-{rep}", 0.8)
    write(d, "D-T4-1", 0.5)
    write(d, "D-T4-2", 0.5, text="wrong")
    out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "score3.py"), d], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    rows = {l.split(" | ")[1]: l for l in out.stdout.splitlines() if l.startswith("T4 | ")}
    assert "drop vs C" in rows["D"] and "fails a task stock passes" in rows["D"], out.stdout
    assert list(rows) == ["A0", "A", "C", "D"], rows  # A0 is the first, reference row
    assert rows["A0"].endswith(" | - | -"), rows["A0"]  # no verdict for the reference itself
    assert " | +25.0% (2 pairs) | " in rows["C"], rows["C"]  # C against pure stock A0


def test_plugin_check(d):
    assert invalid(d, "A-T4-1", loaded=R)  # client setup that still loaded the mod
    assert invalid(d, "B-T4-1", plugin="/plugins/b/company", loaded=R)  # wrong copy loaded first
    assert invalid(d, "C-T4-1", loaded=[R, R])  # two company plugins
    assert invalid(d, "C-T4-1", loaded=None)  # none
    assert invalid(d, "A0-T4-1", mcp=["plugin:playwright:playwright"])  # pure stock with an MCP server
    assert invalid(d, "A0-T4-1", skills=["update-config", "ponytail:ponytail"])  # --safe-mode ignored
    assert invalid(d, "A0-T4-1", skills=["anthropic-skills:docx"])  # synced account skills
    assert invalid(d, "A0-T4-1", skills=["session-start-hook"], grade=["userskills session-start-hook "])
    write(d, "A0-T4-3", skills=["update-config", "plugin-authoring", "cc-plugin-privacy:x"],
          grade=["userskills session-start-hook "])  # bundled skills and builtin plugin skills are stock
    assert [r["name"] for r in score3.collect(d)[0]] == ["A0-T4-3"]
    os.remove(os.path.join(d, "A0-T4-3.jsonl"))
    write(d, "A0-T4-1")  # then a non-builtin plugin in its init
    path = os.path.join(d, "A0-T4-1.jsonl")
    text = open(path).read().replace('"path": "builtin"}]', '"path": "builtin"}, {"name": "ponytail", "path": "/p"}]', 1)
    open(path, "w").write(text)
    assert [w for w in score3.collect(d)[1] if "A0 is pure stock, but ponytail" in w]
    os.remove(path)
    write(d, "A0-T4-2")
    write(d, "C-T4-2")
    runs, warns = score3.collect(d)
    assert sorted(r["name"] for r in runs) == ["A0-T4-2", "C-T4-2"] and not warns, (runs, warns)


def test_prep_checks(d):
    assert invalid(d, "D-T5-1", prep=["rtk 1"])  # rtk missing or not 1.2.1
    assert invalid(d, "F-T5-1", prep=["rtk 0", "graph 1"])  # graph build failed
    assert invalid(d, "E-T5-1", prep=[])  # no graph line at all
    write(d, "D-T5-1", init=False, result=False, text="", exit="skipped", prep=["rtk 1"])  # run3 skipped it
    _, warns = score3.collect(d)
    assert any("D-T5-1: INVALID, rtk check 1" in w for w in warns), warns


def test_harness_faults(d):
    assert invalid(d, "C-T4-1", init=False)  # the session never started
    assert invalid(d, "C-T4-1", result=False, exit=1)  # crashed, not a timeout
    assert invalid(d, "C-T4-1", result=False, exit=137)
    for text in ("You've hit your 5-hour limit \u00b7 resets 3pm", "You've hit your weekly limit \u00b7 resets Dec 1",
                 "You've hit your Opus limit", "You've hit your session limit", "You've reached your Fable limit for this week.",
                 "You're out of usage credits", "API Error: 529 {\"type\":\"overloaded_error\"}"):  # CLI 2.1.332 strings
        assert invalid(d, "C-T4-1", is_error=True, text=text), text
    assert score3.API_FAULT.search("success You've hit your 5-hour limit \u00b7 resets 3pm")

    def limit(**info):
        return [{"type": "rate_limit_event", "rate_limit_info": info}]

    assert invalid(d, "C-T4-1", extra=limit(status="rejected"))  # hit the limit, even if the answer came back
    assert invalid(d, "C-T4-1", extra=limit(status="allowed", unifiedWindows={"seven_day": {"status": "rejected"}}))
    write(d, "C-T4-2", extra=limit(status="allowed", overageStatus="rejected"))  # overage off is normal
    assert [r["name"] for r in score3.collect(d)[0]] == ["C-T4-2"]
    os.remove(os.path.join(d, "C-T4-2.jsonl"))
    write(d, "C-T4-1", result=False, exit=124)
    (r,), warns = score3.collect(d)
    assert not r["ok"] and r["why"] == "timeout" and not warns, (r, warns)


def test_leak_detector(d):
    for inp in ({"file_path": "/home/user/antigravity-setup/claude-company-mods/measure/fixture3/TASKS.md"},
                {"command": "cat ../../r3/C-T4-1.jsonl"}, {"pattern": "PaymentGateway", "path": "/x/grading"},
                {"command": "ls ~/.claude/projects"}):
        warns = invalid(d, "C-T4-1", extra=[tool("Read", inp)])
        assert warns and "possible leak" in warns[0], (inp, warns)
    for inp in ({"command": "cd ../../r3 && cat C-T4-1.jsonl"}, {"command": "cd ../.. && cat r3/warm/C-T6-w1.jsonl"},
                {"file_path": "../../2/C-T3-1/shop/pricing/engine.py"}, {"command": "ls /b/bench3/2"},
                {"pattern": "def ", "path": "/b/bench3"}):
        warns = invalid(d, "C-T4-1", cwd="/b/bench3/1/C-T4-1", extra=[tool("Read", inp)])
        assert warns and "possible leak" in warns[0], (inp, warns)
    sub = [tool("Bash", {"command": "grep -r tax /home/user/antigravity-setup"}, parent="toolu_1")]
    assert invalid(d, "C-T4-1", extra=sub)  # a subagent counts too
    work = "/tmp/claude-0/-home-user-antigravity-setup/5b/scratchpad/bench3/1/C-T4-1"
    write(d, "C-T4-1", cwd=work, extra=[tool("Read", {"file_path": work + "/logs/app.log"}),
                                        tool("Bash", {"command": "pip list", "description": "Check after upgrading"}),
                                        tool("Edit", {"file_path": "shop/x.py", "new_string": "r3 = total / 2"}),
                                        tool("Agent", {"prompt": f"Look in {work} for tax"})])
    runs, warns = score3.collect(d)
    assert len(runs) == 1 and not warns, warns  # the work dir, "upgrading" and an r3 variable do not trip it
    write(d, "C-T4-1", cwd="/w", extra=[tool("Read", {"file_path": "/w/shop/x.py"})])  # not a run3 work dir:
    assert len(score3.collect(d)[0]) == 1  # no bench root to guard, so no root check (else "/" flags all)


def test_valid_cli(d):
    def valid(name):
        return subprocess.run([sys.executable, "-I", os.path.join(HERE, "score3.py"), "--valid",
                               os.path.join(d, name + ".jsonl")], capture_output=True, text=True)

    write(d, "C-T4-1", text="wrong")  # a fail still counts as a run
    assert valid("C-T4-1").returncode == 0
    write(d, "C-T4-2", init=False)
    out = valid("C-T4-2")
    assert out.returncode == 1 and "INVALID" in out.stdout, out
    assert valid("C-T4-3").returncode == 1  # never ran


def test_acted(d):
    write(d, "D-T5-1", 0.1, text="", cmds=["git log -10", "rtk git diff", "cd x && rtk grep -n a b"])
    write(d, "E-T1-1", 0.1, text="", cmds=['graphify query "tax" --budget 1500'])
    write(d, "C-T1-1", 0.1, text="", cmds=["grep -rn rtk ."], extra=[tool("Agent", {"prompt": "find tax"})])
    by = {r["setup"]: r["acted"] for r in score3.collect(d)[0]}
    assert by == {"D": {"rtk"}, "E": {"graph"}, "C": {"agent"}}, by


def test_meter(d):
    now = int(time.time())

    def meter(u, reset, status="allowed", age=0):
        info = {"unifiedWindows": {"five_hour": {"utilization": u, "resetsAt": reset, "status": status}}}
        write(d, "A-T1-1", 0.1, extra=[{"type": "rate_limit_event", "rate_limit_info": info}])
        os.utime(os.path.join(d, "A-T1-1.jsonl"), (now - age, now - age))
        return score3.meter(d, now)[:2]

    assert score3.meter(d, now)[0] == "stale"  # no reading yet: fail closed
    assert meter(0.5, now + 600) == ("go", 0)
    assert meter(0.85, now + 600) == ("wait", 660)  # waits for the reset plus a minute
    assert meter(0.99, now - 5) == ("go", 0)  # the window reset since that reading
    assert meter(0.2, now + 600, "rejected") == ("wait", 660)
    info = {"unifiedWindows": {"five_hour": {"utilization": 0.3, "resetsAt": now + 600},
                               "seven_day": {"utilization": 0.86, "resetsAt": now + 9000}}}
    write(d, "A-T1-1", extra=[{"type": "rate_limit_event", "rate_limit_info": info}])
    assert score3.meter(d, now)[:2] == ("wait", 9060)  # week at 85%+ would turn economy on in B-F only
    for week, state in ((0.83, "wait"), (0.829, "go")):  # 2% margin: a run can cross the line mid-session
        info["unifiedWindows"]["seven_day"]["utilization"] = week
        write(d, "A-T1-1", extra=[{"type": "rate_limit_event", "rate_limit_info": info}])
        assert score3.meter(d, now)[0] == state, (week, score3.meter(d, now))
    assert meter(0.5, now + 6000, age=901) == ("stale", 0)  # old reading after a long gap
    assert meter(0.9, now + 6000, age=901) == ("stale", 0)
    os.makedirs(os.path.join(d, "warm"))
    write(d, "warm/A-T6-w1", extra=[])  # newer file without a reading: the older reading still counts
    assert score3.meter(d, now + 1)[0] == "stale"  # (that reading is 901 s old)
    write(d, "A-T1-1", extra=[{"type": "rate_limit_event", "rate_limit_info": {"status": "allowed"}}])
    assert score3.meter(d)[0] == "stale"  # a reading without a 5 h figure fails closed


STUB = r"""#!/bin/bash
echo "$*" >> "$STUBLOG"
[ "$1" = plugin ] && { echo '[{"id": "ponytail@ponytail"}, {"id": "company@synced"}, {"id": "cc-plugin-x@builtin"}]'; exit 0; }
if [[ " $* " == *" --model haiku "* ]]; then  # the meter probe
  echo '{"type": "rate_limit_event", "rate_limit_info": {"unifiedWindows": {"five_hour": {"utilization": 0.1, "resetsAt": 9999999999}}}}'
  exit 0
fi
plug='{"name": "cc-plugin-x", "path": "builtin"}'
[ -n "${STUB_BAD:-}" ] && plug="$plug"', {"name": "ponytail", "path": "/p"}'
echo '{"type": "system", "subtype": "init", "plugins": ['"$plug"'], "mcp_servers": []}'
echo '{"type": "result", "subtype": "success", "is_error": false, "result": "stub", "total_cost_usd": 0, "modelUsage": {}}'
"""


def test_bench(d):
    """bench3.sh + run3.sh end to end with a stub claude: plan, meter probe, A0 settings, skip, retry."""
    def bench(reps, **env):
        e = {**os.environ, "SCRATCH": os.path.join(d, "s"), "PATH": f"{d}/bin:{os.environ['PATH']}",
             "STUBLOG": os.path.join(d, "log"), **env}
        out = subprocess.run(["bash", os.path.join(HERE, "bench3.sh"), str(reps)], capture_output=True, text=True,
                             env=e, timeout=300)
        assert out.returncode == 0, out.stdout + out.stderr
        return out.stdout

    def plan(text):
        reps = {}
        for line in text.splitlines():
            m = re.match(r"rep (\d+) lane (\d+): (\S+) (\S+) (\S+)", line)
            if m and "warm-up" in line:
                reps.setdefault(m[1], []).append((m[2], m[3]))
        return reps

    def calls():
        with open(os.path.join(d, "log")) as fh:
            return fh.read().splitlines()

    os.makedirs(os.path.join(d, "bin"))
    stub = os.path.join(d, "bin", "claude")
    with open(stub, "w") as fh:
        fh.write(STUB)
    os.chmod(stub, os.stat(stub).st_mode | stat.S_IEXEC)

    text = bench(2, DRY="1")
    orders = re.findall(r"rep \d+: setup order (.*)", text)
    assert orders == ["A0 A B C D E F", "F E D C B A A0"], orders  # ABBA
    blocks = plan(text)
    lanes = [{frozenset(s for l2, s in blocks[r] if l2 == l) for l, _ in blocks[r]} for r in "12"]
    assert lanes[0] != lanes[1], lanes  # other setups share a lane in rep 2
    assert re.findall(r"setup order (.*)", bench(1, DRY="1", SETUPS="D")) == ["A C D"]  # base and stock come along
    assert re.findall(r"setup order (.*)", bench(1, DRY="1", SETUPS="B")) == ["A B"]
    assert not os.path.exists(os.path.join(d, "s")), "DRY made files"

    out = bench(1, SETUPS="A0", TASKS="T6", LANES="1")
    log = calls()
    assert "--model haiku" in log[0], log  # no reading yet: a probe comes before any session
    assert sum("--model haiku" in c for c in log) == 1, log  # the probe's reading is fresh for the rest
    sessions = [c for c in log if c.startswith("-p ") and "--model haiku" not in c]
    assert len(sessions) == 2 and all("--safe-mode" in c for c in sessions), sessions  # warm-up, then the run
    settings = json.loads(re.search(r"--settings (\{.*?\}\})", sessions[0])[1])
    assert settings == {"enabledPlugins": {"ponytail@ponytail": False, "company@synced": False}}, settings
    r3 = os.path.join(d, "s", "r3")
    assert os.path.exists(os.path.join(r3, "A0-T6-1.grade")) and os.path.exists(os.path.join(r3, "warm", "A0-T6-w1.grade"))

    bench(1, SETUPS="A0", TASKS="T6", LANES="1")
    assert len(calls()) == len(log), "a done run ran again"
    os.remove(os.path.join(r3, "A0-T6-1.grade"))  # the jsonl alone does not make a run done
    n = len(calls())
    out = bench(1, SETUPS="A0", TASKS="T6", LANES="1", STUB_BAD="1")
    again = [c for c in calls()[n:] if c.startswith("-p ") and "--model haiku" not in c]
    assert len(again) == 4, again  # warm-up and run, each INVALID (ponytail loaded), each run once more
    assert out.count("INVALID, A0 is pure stock, but ponytail") == 4, out


def main():
    test_paired_rule()
    for t in (test_fail_excluded_from_mean, test_cache_classes_add_up, test_norm_cost, test_drop_when_stock_passes,
              test_plugin_check, test_prep_checks, test_harness_faults, test_leak_detector, test_valid_cli,
              test_acted, test_meter, test_bench):
        with tempfile.TemporaryDirectory() as d:
            t(d)
    print("ok")


if __name__ == "__main__":
    main()
