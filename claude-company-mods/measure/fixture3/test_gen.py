"""Checks gen.py, HASHES.txt, grading/ and every grading rule in TASKS.md.

Run: python3 -I test_gen.py   (prints ok; needs git and pytest)
Each regex rule must match a correct answer built from the generated files and
reject near-miss answers; each command rule must fail before the fix and pass after.
"""

import hashlib
import importlib.util
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "gen.py")
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
TASK_IDS = ["T1", "T2", "T3", "T4", "T5", "T6", "T1-big"]
sys.dont_write_bytecode = True  # load() below must not leave __pycache__ in the fixture


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(cmd, cwd=None, check=True, env=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)
    if check and r.returncode:
        raise AssertionError(f"{cmd} exit {r.returncode}\n{r.stdout[-2000:]}{r.stderr[-2000:]}")
    return r


def git(cwd, *args):
    return run(["git", "-C", cwd, *args]).stdout.strip()


def build(out, *flags):
    run([sys.executable, "-I", GEN, out, *flags])


def digest(root):
    h = hashlib.sha256(git(root, "rev-parse", "HEAD").encode())
    h.update(git(root, "status", "--porcelain").encode())
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x != ".git")
        for f in sorted(files):
            p = os.path.join(d, f)
            h.update(os.path.relpath(p, root).encode() + b"\0" + oct(os.stat(p).st_mode & 0o111).encode())
            with open(p, "rb") as fh:
                h.update(fh.read())
    return h.hexdigest()


def tasks():
    rows = {}
    with open(os.path.join(HERE, "TASKS.md"), encoding="utf-8") as fh:
        for line in fh:
            if not re.match(r"\| T\d", line):
                continue
            # A pattern spells | as \| (the table escape).
            cells = [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
            assert len(cells) == 4, f"row needs 4 cells: {line[:60]}"
            tid, prompt, grade, savers = cells
            kind, _, rest = grade.partition(":")
            rows[tid] = {"prompt": prompt, "kind": kind.strip(), "rules": re.findall(r"`([^`]+)`", rest)}
    assert list(rows) == TASK_IDS, list(rows)
    return rows


def check_regex(row, goods, bad):
    assert row["kind"] == "regex" and row["rules"], row
    for rx in row["rules"]:
        for good in goods:
            assert re.search(rx, good), f"rule {rx!r} rejects a correct answer:\n{good}"
    for b in bad:
        assert not all(re.search(rx, b) for rx in row["rules"]), f"rules accept a wrong answer:\n{b}"


def grade(row, work):
    assert row["kind"] == "cmd" and len(row["rules"]) == 1, row
    return run(["bash", "-c", row["rules"][0]], cwd=work, check=False, env={**os.environ, "FIXTURE": HERE}).returncode


def edit(path, old, new):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    assert text.count(old) == 1, (path, old)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text.replace(old, new))


def line_of(path, needle):
    with open(path, encoding="utf-8") as fh:
        hits = [i for i, l in enumerate(fh, 1) if needle in l]
    assert len(hits) == 1, (path, needle, hits)
    return hits[0]


def pytest_counts(work):
    r = run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=work, check=False)
    m = re.search(r"(\d+) failed, (\d+) passed", r.stdout)
    assert r.returncode == 1 and m, r.stdout[-1500:]
    return int(m[1]), int(m[2])


def check_build(a, b):
    assert digest(a) == digest(b), "two builds differ"
    assert git(a, "rev-list", "--count", "HEAD") == "30"
    size = os.path.getsize(os.path.join(a, "logs", "app.log"))
    assert 5_000_000 <= size <= 5_300_000, size
    want = []
    for d, _, files in os.walk(os.path.join(a, "tests")):
        want += [os.path.relpath(os.path.join(d, f), a) for f in files]
    want.append("logs/app.log")
    lines = []
    for p in sorted(want):
        with open(os.path.join(a, p), "rb") as fh:
            lines.append(f"{hashlib.sha256(fh.read()).hexdigest()}  {p}\n")
    with open(os.path.join(HERE, "HASHES.txt"), encoding="utf-8") as fh:
        assert fh.read() == "".join(lines), "HASHES.txt is stale: see README.md"
    failed, passed = pytest_counts(a)  # after the hashes: pytest writes __pycache__ into tests/
    assert failed == 1, failed
    gr = load(os.path.join(HERE, "grading", "grade.py"), "grade")
    assert failed + passed == gr.BASE_TESTS, (failed + passed, gr.BASE_TESTS)


def check_t1(a, row):
    chain = [("shop/web/handlers.py", "handle_checkout"), ("shop/orders/service.py", "place_order"),
             ("shop/pricing/engine.py", "price_cart"), ("shop/pricing/tax.py", "compute_tax"),
             ("shop/geo/zones.py", "levy_for_zone")]
    for i, (path, fn) in enumerate(chain):
        line_of(os.path.join(a, path), f"def {fn}(")
        if i + 1 < len(chain):
            with open(os.path.join(a, path), encoding="utf-8") as fh:
                assert f"{chain[i + 1][1]}(" in fh.read(), (path, "calls", chain[i + 1][1])
    code = "from shop.geo.zones import *; print(levy_for_zone(zone_for_postcode('73301')) * 100)"
    rate = run([sys.executable, "-c", code], cwd=a).stdout.strip()
    assert rate.rstrip("0") == "8.125", rate
    good = "\n".join(f"{p}:{f}" for p, f in chain) + "\nPostcode 73301: 8.125%"
    stop = "\n".join(f"{p}:{f}" for p, f in chain[:4]) + "\nPostcode 73301: 8.125%"
    dotted = "\n".join(f"{p[:-3].replace('/', '.')}.{f}" for p, f in chain) + "\nThe rate is 8.125 %."
    check_regex(row, [good, dotted], [good.replace("8.125", "8.0"), stop])


def check_t4(a, row):
    root, after = None, 0
    with open(os.path.join(a, "logs", "app.log"), encoding="utf-8") as fh:
        for i, l in enumerate(fh, 1):
            level = l.split(" ", 2)[1] if l[:4] == "2026" else ""
            if root is None and level == "ERROR" and "PaymentGatewayTimeout" in l:
                root = i
            elif root is not None and level == "ERROR":
                after += 1
            assert "ERROR" not in l or level == "ERROR", f"line {i}: ERROR outside the level field"
    assert root == 61873 and 280 <= after <= 330, (root, after)
    good = f"Root error: line {root:,}, PaymentGatewayTimeout. {after} ERROR lines follow it."
    goods = [good, good.replace(f"{root:,}", f"{root:,}".replace(",", " ")), good.replace(f"{root:,}", str(root))]
    check_regex(row, goods, [good.replace(f"{root:,}", f"{root + 1:,}"), good.replace(f" {after} ", f" {after + 1} "),
                            good.replace("PaymentGatewayTimeout", "CircuitOpen")])


def check_t5(a, row):
    log = git(a, "log", "-11", "--format=%an%x1f%B%x1e").split("\x1e")
    commits = [c.strip().split("\x1f") for c in log if c.strip()]
    last, eleventh = commits[:10], commits[10]
    authors = list(dict.fromkeys(c[0] for c in last))
    tickets = list(dict.fromkeys(t for c in last for t in re.findall(r"SHOP-\d+", c[1])))
    dirty = sorted(l[3:] for l in run(["git", "-C", a, "status", "--porcelain"]).stdout.splitlines())
    assert eleventh[0] not in authors, "11th commit author must be a decoy"
    decoy = [t for t in re.findall(r"SHOP-\d+", eleventh[1]) if t not in tickets]
    assert decoy, "11th commit must name a ticket the last 10 do not"
    good = f"Summary...\nAUTHORS: {', '.join(authors)}\nTICKETS: {', '.join(tickets)}\nDIRTY: {', '.join(dirty)}"
    bad = [good.replace("AUTHORS: ", f"AUTHORS: {eleventh[0]}, "), good.replace("TICKETS: ", f"TICKETS: {decoy[0]}, "),
           good.replace(f"TICKETS: {tickets[0]}, ", "TICKETS: "), good.replace(f"DIRTY: {dirty[0]}, ", "DIRTY: ")]
    styled = good.replace("AUTHORS:", "**Authors:**").replace("TICKETS:", "Tickets:").replace("DIRTY:", "`Dirty:")
    check_regex(row, [good, styled + "`"], bad)


def check_t6(a, row):
    js = line_of(os.path.join(a, "web/src/api.js"), "export async function submitOrder(")
    hits = run(["grep", "-rn", "/api/checkout", "web"], cwd=a).stdout.splitlines()
    assert hits == [f"web/src/api.js:{js + 1}:  return request(\"POST\", \"/api/checkout\", order);"], hits
    py = line_of(os.path.join(a, "shop/web/handlers.py"), "def handle_checkout(")
    line_of(os.path.join(a, "shop/web/app.py"), 're.compile(r"^/api/checkout$"), handlers.handle_checkout)')
    goods = [f"web/src/api.js:{js}\nshop/web/handlers.py:{py}", f"api.js:{js}\nhandlers.py:{py}",
             f"[api.js:{js}](web/src/api.js#L{js})\n[handlers.py:{py}](shop/web/handlers.py#L{py})",
             f"`submitOrder` web/src/api.js:{js}, `handle_checkout` shop/web/handlers.py:{py}",
             f"web/src/api.js:{js} and shop/web/handlers.py:{py}"]
    check_regex(row, goods, [f"web/src/api.js:{js + 1}\nshop/web/handlers.py:{py}",
                             f"web/src/api.js:{js}\nshop/web/app.py:{py}",
                             f"api.js:{js - 1}-{js + 1}, {js} / handlers.py:{py - 3}, {py}, {py + 7}",
                             f"api.js:{js}-{js + 1}\nhandlers.py:{py}", f"api.js:{js}\nhandlers.py:{py}, {py + 1}"]
                + [f"api.js:{js}{h}\nhandlers.py:{py}" for h in hedges(js)])


def hedges(n):
    """Ways to name a second line right after the right one."""
    return [f" or {n + 1}", f"/{n + 1}", f"\u2014{n + 1}", f" and {n + 1}", f" (or line {n - 1})"]


def check_t1_big(row):
    gov = run(["git", "-C", REPO, "show", "4b40414:claude-company-mods/company/hooks/governor.ts"]).stdout.splitlines()
    reg = run(["git", "-C", REPO, "show", "4b40414:claude-company-mods/company/hooks/register.tsx"]).stdout.splitlines()
    assert gov[20].startswith("export function governEffort(") and "'opus' && e === 'low'" in gov[28]
    assert "governEffort(model, effort" in reg[458]
    calls = run(["git", "-C", REPO, "grep", "-n", "governEffort(", "4b40414", "--", "*.ts", "*.tsx"]).stdout
    assert [l for l in calls.splitlines() if ".test." not in l] == [
        "4b40414:claude-company-mods/company/hooks/governor.ts:21:export function governEffort("
        "model: string, effort: Effort, economy: boolean): Governed {",
        "4b40414:claude-company-mods/company/hooks/register.tsx:459:      const g = governEffort(model, effort, st.economy)",
    ], calls
    base = "claude-company-mods/company/hooks/"
    goods = [f"{base}governor.ts:21\n{base}register.tsx:459", "governor.ts:21\nregister.tsx:459",
             f"[governor.ts:21]({base}governor.ts#L21)\n[register.tsx:459]({base}register.tsx#L459)"]
    check_regex(row, goods, [f"{base}governor.ts:29\n{base}register.tsx:459",
                             f"{base}governor.ts:21\n{base}register.tsx:460",
                             "governor.ts:20, 21, 29\nregister.tsx:459", "governor.ts:21\nregister.tsx:458-460"]
                + [f"governor.ts:21{h}\nregister.tsx:459" for h in hedges(21)]
                + [f"governor.ts:21\nregister.tsx:459{h}" for h in hedges(459)])


def check_t2(work, row, gen):
    hashes = 'python3 -I "$FIXTURE/grading/grade.py" hashes'
    assert grade({"kind": "cmd", "rules": [hashes]}, work) == 0, "hash check fails on a fresh copy"
    assert grade(row, work) != 0, "T2 passes before the fix"
    path, old, new = gen.T2_FIX
    edit(os.path.join(work, path), old, new)
    assert grade(row, work) == 0, "T2 fails after the reference fix"
    for path, text, verdict in [("tests/conftest.py", "", "a new tests/conftest.py"),
                                ("conftest.py", "", "a new root conftest.py"),
                                ("pytest.ini", "[pytest]\n", "a new pytest.ini"),
                                ("pyproject.toml", "[tool.pytest.ini_options]\naddopts = '-q'\n", "pytest config in pyproject.toml"),
                                ("setup.cfg", "[tool:pytest]\n", "pytest config in setup.cfg")]:
        with open(os.path.join(work, path), "w", encoding="utf-8") as fh:
            fh.write(text)
        assert grade(row, work) != 0, f"T2 passes with {verdict}"
        os.remove(os.path.join(work, path))
    with open(os.path.join(work, "pyproject.toml"), "w", encoding="utf-8") as fh:
        fh.write("[project]\nname = 'shop'\n")
    assert grade(row, work) == 0, "T2 fails on a pyproject.toml with no pytest section"
    os.remove(os.path.join(work, "pyproject.toml"))
    clear = "def pytest_collection_modifyitems(items):\n    items.clear()\n"
    for path, text, verdict, want in [
        (".venv/lib/python3.13/site-packages/numpy/conftest.py", "", "fails on a conftest.py inside a venv", 0),
        ("tests/env/conftest.py", "", "passes with a conftest.py in a collected dir", 1),
        ("../conftest.py", clear, "fails on a conftest.py above the work copy", 0),
        ("pytest.py", "raise SystemExit(3)\n", "fails on a pytest.py that shadows pytest", 0),
    ]:
        full = os.path.join(work, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(text)
        assert (grade(row, work) != 0) == bool(want), f"T2 {verdict}"
        os.remove(full)
    edit(os.path.join(work, "tests/test_engine.py"), "def test_mixed_cart", "def _test_mixed_cart")
    assert grade(row, work) != 0, "T2 passes with an edited test"
    with open(os.path.join(work, "logs", "app.log"), "a", encoding="utf-8") as fh:
        fh.write("x\n")
    assert grade({"kind": "cmd", "rules": [hashes]}, work) != 0, "hash check misses an edited log"


def check_t3(work, row):
    assert grade(row, work) != 0, "T3 passes before the feature"
    edit(os.path.join(work, "shop/models.py"), '    tier: str = "standard"\n',
         '    tier: str = "standard"\n    tax_exempt: bool = False\n')
    edit(os.path.join(work, "shop/pricing/tax.py"), "    zone = zone_for_postcode(",
         "    if customer.tax_exempt:\n        return ZERO\n    zone = zone_for_postcode(")
    edit(os.path.join(work, "shop/pricing/tax.py"), "import scale", "import ZERO, scale")
    assert grade(row, work) != 0, "T3 passes without a new test"
    with open(os.path.join(work, "tests", "test_exempt.py"), "w", encoding="utf-8") as fh:
        fh.write("from shop.models import Cart, Customer\nfrom shop.pricing.engine import price_cart\n\n\n"
                 "def test_exempt():\n    c = Cart()\n    c.add('MUG-010')\n"
                 "    assert price_cart(c, Customer('c', 'n', '10001', tax_exempt=True)).tax.cents == 0\n")
    assert grade(row, work) == 0, "T3 fails after the reference feature"


def main():
    with tempfile.TemporaryDirectory() as tmp:
        a, b, c = (os.path.join(tmp, x) for x in ("a", "b", "c d"))  # the grader must cope with a space
        build(a)
        build(b)
        check_build(a, b)
        rows = tasks()
        gen = load(GEN, "gen")
        check_t1(a, rows["T1"])
        check_t4(a, rows["T4"])
        check_t5(a, rows["T5"])
        check_t6(a, rows["T6"])
        check_t1_big(rows["T1-big"])
        check_t2(b, rows["T2"], gen)
        build(c, "--fixed")
        assert run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=c, check=False).returncode == 0
        check_t3(c, rows["T3"])
    print("ok")


if __name__ == "__main__":
    main()
