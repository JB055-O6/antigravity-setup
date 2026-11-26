"""Checks score3.py on synthetic runs. Run: python3 -I test_score3.py   (prints ok)"""

import json
import os
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


def usage(u=6, cc=1000, cr=5000, out=50, c1h=None):
    c1h = cc if c1h is None else c1h
    return {"inputTokens": u, "cacheCreationInputTokens": cc, "cacheReadInputTokens": cr, "outputTokens": out,
            "cacheCreationEphemeral1hInputTokens": c1h, "cacheCreationEphemeral5mInputTokens": cc - c1h}


def write(d, name, cost, text=GOOD_T4, models=None, plugin=R, loaded=R, hashes=0, cmds=(), extra=()):
    """One run as run3.sh leaves it: <name>.jsonl (stream-json) and <name>.grade."""
    models = models or {OPUS: usage()}
    plugins = [{"name": "ponytail", "path": "/p"}] + ([{"name": "company", "path": loaded}] if loaded else [])
    tools = [{"type": "tool_use", "id": f"t{i}", "name": "Bash", "input": {"command": c}} for i, c in enumerate(cmds)]
    main = next(iter(models.values()))
    ev = [{"type": "system", "subtype": "init", "plugins": plugins},
          {"type": "assistant", "parent_tool_use_id": None, "message": {"content": tools}},
          *extra,
          {"type": "result", "subtype": "success", "is_error": False, "result": text, "total_cost_usd": cost,
           "usage": {"input_tokens": main["inputTokens"]}, "modelUsage": models, "permission_denials": []}]
    with open(os.path.join(d, name + ".jsonl"), "w") as fh:
        fh.write("not json: stderr noise\n" + "".join(json.dumps(e) + "\n" for e in ev))
    with open(os.path.join(d, name + ".grade"), "w") as fh:
        fh.write(f"plugin {plugin or 'none'}\nhashes {hashes}\n# PASS\n")


def cell(runs, setup, task):
    return [r for r in runs if r["setup"] == setup and r["task"] == task]


def test_fail_excluded_from_mean(d):
    write(d, "C-T4-1", 0.10)
    write(d, "C-T4-2", 0.20)
    write(d, "C-T4-3", 0.01, text="no idea")  # wrong answer: a fail
    write(d, "C-T4-4", 0.02, hashes=1)  # right answer, but the session changed a test file
    runs, _ = score3.collect(d)
    c = cell(runs, "C", "T4")
    s = score3.stats(c)
    assert (s["n"], s["pass"], s["fail"]) == (4, 2, 2), s
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

    base = runs([1.0] * 4)
    assert score3.verdict(runs([0.94] * 4), base, base)[0] == "keep"
    assert score3.verdict(runs([0.5, 0.5, 1.05, 1.05]), base, base)[0] == "unclear"  # mean -22%, but 2 of 4
    assert score3.verdict(runs([0.9, 0.9, 1.1, 1.1]), base, base)[0] == "unclear"
    assert score3.verdict(runs([0.97] * 4), base, base)[0] == "unclear"  # 3% is not enough
    assert score3.verdict(runs([0.9, 0.9]), runs([1.0, 1.0]), [])[0] == "keep"  # 2 of 2 at n=2
    assert score3.verdict(runs([0.9, 1.01]), runs([1.0, 1.0]), [])[0] == "unclear"
    assert score3.verdict(runs([1.2] * 4), base, base)[0] == "drop"  # clearly dearer
    assert score3.verdict(runs([0.9, 1.1] * 3), runs([1.0] * 6), [])[0] == "drop"  # n=6, no proof
    stock = runs([1.0, 1.0])
    assert score3.verdict(runs([0.5, 0.5], [True, False]), runs([1.0, 1.0]), stock)[0] == "drop"
    # A failed run leaves its pair out; the rest still decide (stock failed as often, so rule 1 holds).
    flaky = [True, True, False]
    assert score3.verdict(runs([0.9, 0.9, 5.0], flaky), runs([1.0] * 3), runs([1.0] * 3, flaky))[0] == "keep"


def test_drop_when_stock_passes(d):
    for rep in "12":
        write(d, f"A-T4-{rep}", 1.0, plugin=None, loaded=None)
        write(d, f"C-T4-{rep}", 1.0)
    write(d, "D-T4-1", 0.5)
    write(d, "D-T4-2", 0.5, text="wrong")
    out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "score3.py"), d], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    row = [l for l in out.stdout.splitlines() if l.startswith("T4 | D ")]
    assert len(row) == 1 and "drop vs C" in row[0] and "fails a task stock passes" in row[0], out.stdout


def test_plugin_check(d):
    write(d, "A-T4-1", 1.0, plugin=None, loaded=R)  # stock run that still loaded the mod
    write(d, "B-T4-1", 1.0, plugin="/plugins/b/company", loaded=R)  # wrong copy loaded first
    write(d, "C-T4-1", 1.0)
    runs, warns = score3.collect(d)
    assert [r["setup"] for r in runs] == ["C"], runs
    assert len([w for w in warns if "company plugin" in w]) == 2, warns


def test_acted(d):
    write(d, "D-T5-1", 0.1, text="", cmds=["git log -10", "rtk git diff", "cd x && rtk grep -n a b"])
    write(d, "E-T1-1", 0.1, text="", cmds=['graphify query "tax" --budget 1500'])
    write(d, "C-T1-1", 0.1, text="", cmds=["grep -rn rtk ."],
          extra=[{"type": "assistant", "parent_tool_use_id": None,
                  "message": {"content": [{"type": "tool_use", "id": "a1", "name": "Agent", "input": {}}]}}])
    by = {r["setup"]: r["acted"] for r in score3.collect(d)[0]}
    assert by == {"D": {"rtk"}, "E": {"graph"}, "C": {"agent"}}, by


def test_meter(d):
    now = int(time.time())

    def meter(u, reset, status="allowed"):
        info = {"unifiedWindows": {"five_hour": {"utilization": u, "resetsAt": reset, "status": status}}}
        write(d, "A-T1-1", 0.1, extra=[{"type": "rate_limit_event", "rate_limit_info": info}])
        return score3.meter_wait(d, now)

    assert score3.meter_wait(d, now) == 0  # no reading yet
    assert meter(0.5, now + 600) == 0
    assert meter(0.85, now + 600) == 660  # waits for the reset plus a minute
    assert meter(0.99, now - 5) == 0  # the window reset since that reading
    assert meter(0.2, now + 600, "rejected") == 660


def main():
    test_paired_rule()
    for t in (test_fail_excluded_from_mean, test_cache_classes_add_up, test_norm_cost, test_drop_when_stock_passes,
              test_plugin_check, test_acted, test_meter):
        with tempfile.TemporaryDirectory() as d:
            t(d)
    print("ok")


if __name__ == "__main__":
    main()
