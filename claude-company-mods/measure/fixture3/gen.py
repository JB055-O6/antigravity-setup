#!/usr/bin/env python3
"""Build a fresh work copy of benchmark fixture 3.

Usage: python3 -I gen.py <out_dir> [--fixed]

<out_dir> (missing or empty) gets the files of app/ as a git repo with 30
commits, two uncommitted edits (the "current diff" of T5), and a 5 MB
logs/app.log (git-ignored). Authors, dates and the log RNG are fixed, so two
builds give the same files and the same commit hashes.
--fixed applies the T2 reference fix, so the T3 work copy starts with all tests green.

app/ holds the final work tree. Each commit below names the files it adds
and its edits as (path, old, new); app/ holds `new`. The builder undoes the
edits from the newest commit back to get each older version, then replays
them forward.
"""

import hashlib
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "app")
SEED = 20261126
ROOT_LINE = 61873  # the root PaymentGatewayTimeout ERROR line (T4)
FOLLOW_ERRORS = 312  # ERROR lines after the root line (T4)

T2_FIX = ("shop/pricing/discounts.py", "if subtotal.cents > minimum:", "if subtotal.cents >= minimum:")

AUTHORS = {
    "elena": ("Elena Petrova", "elena.petrova@example.com", "+02:00"),
    "jonah": ("Jonah Weiss", "jonah.weiss@example.com", "-05:00"),
    "maya": ("Maya Okafor", "maya.okafor@example.com", "+00:00"),
    "priya": ("Priya Raman", "priya.raman@example.com", "+05:30"),
    "tomas": ("Tomas Lindqvist", "tomas.lindqvist@example.com", "+01:00"),
}

# Uncommitted edits in the work tree: HEAD has `old`, app/ has `new`.
DIRTY = [
    ("shop/config.py",
     'PAYMENT_TIMEOUT_MS = _int("SHOP_PAYMENT_TIMEOUT_MS", 30000)\n',
     "# Fail fast: a checkout that waits 30 s for the gateway holds a worker thread the whole time.\n"
     'PAYMENT_TIMEOUT_MS = _int("SHOP_PAYMENT_TIMEOUT_MS", 10000)\n'),
    ("docker-compose.yml",
     '      SHOP_PAYMENT_TIMEOUT_MS: "30000"\n',
     '      SHOP_PAYMENT_TIMEOUT_MS: "10000"\n      SHOP_BREAKER_FAILURES: "3"\n'),
]

SEARCH_JS_OLD = 'export function bindSearch(input) {\n  input.addEventListener("input", () => runSearch(input.value.trim()));\n}\n'
SEARCH_JS_NEW = """export function bindSearch(input) {
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value.trim()), WAIT_MS);
  });
}
"""
GOLD_TEST = """def test_gold_member_at_minimum_gets_discount():
    p = price_cart(cart(("SET-200", 2)), Customer("c2", "Bo", "60601", "gold"))
    assert p.discount == Money(5_00)
    assert p.total == Money(48_66)


"""
COOL_DOWN_TEST = """

def test_closes_after_cool_down():
    clock = Clock()
    b = Breaker(2, 30, clock)
    b.failure()
    b.failure()
    clock.now = 30.0
    b.check()
    assert b.failures == 0
    b.failure()
    b.check()
    b.failure()
    with pytest.raises(CircuitOpen):
        b.check()
"""
README_RESET = "| `SHOP_BREAKER_RESET_S` | `30` | seconds before the breaker lets calls through again |\n"
CHANGELOG_140 = """## 1.4.0 - 2026-11-19

- Search matches product tags as well as names.
- Central zone levy is 8.125%.
- The circuit breaker starts a fresh failure count after the cool-down.
- Checkout answers 409 when stock runs out.
- nginx serves the web UI and proxies the API.
- The Docker image runs as a non-root user.

"""
NGINX_SERVICE = """    expose:
      - "8080"
  nginx:
    image: nginx:1.27-alpine
    ports:
      - "8080:80"
    volumes:
      - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./web:/usr/share/nginx/html:ro
    depends_on:
      - app
"""


def c(who, reviewer, date, msg, add=(), edit=()):
    return {"who": who, "rev": reviewer, "date": date, "msg": msg, "add": list(add), "edit": list(edit)}


COMMITS = [
    c("elena", "jonah", "2026-10-01T09:12:00", """Initial skeleton: package, money type and README

Start the tea shop service as a plain Python package with no runtime
dependencies. Amounts are integer cents from day one; floats caused
rounding drift in the old spreadsheet export.

Refs: SHOP-300""",
      add=[".gitignore", "README.md", "requirements-dev.txt", "shop/__init__.py", "shop/money.py", "tests/test_money.py"]),
    c("elena", "maya", "2026-10-02T15:40:00", """Add records for products, carts, customers and orders

Dataclasses only, no behaviour beyond Cart.add merging lines for the
same SKU. Everything else lives in the layer that owns it.""",
      add=["shop/models.py"]),
    c("jonah", "elena", "2026-10-05T10:05:00", """Catalog: product list and lookup by SKU

The five launch products are hard-coded until the catalog service
exists. get_product raises UnknownProduct, a KeyError, so callers can
tell a bad SKU from a bug.

Refs: SHOP-301""",
      add=["shop/catalog/__init__.py", "shop/catalog/products.py"]),
    c("jonah", "tomas", "2026-10-06T16:22:00", """Catalog: stock reservations

Inventory.reserve checks every line before it takes any stock, so a
cart never ends up half reserved. release() is the undo for a failed
payment.

Refs: SHOP-304""",
      add=["shop/catalog/inventory.py", "tests/test_inventory.py"]),
    c("elena", "maya", "2026-10-08T11:30:00", """Pricing: tax zones by postcode

Sales tax depends on the zone, and the zone on the first two digits of
the postcode. Levies are Decimals and the result is rounded half-even
to the cent, as the accounting system does.

Refs: SHOP-310""",
      add=["shop/geo/__init__.py", "shop/geo/zones.py", "shop/pricing/__init__.py", "shop/pricing/tax.py",
           "tests/test_tax.py"]),
    c("maya", "elena", "2026-10-09T09:48:00", """Pricing: loyalty and coupon discounts

Gold and silver members get a percentage off from a minimum subtotal.
Coupons are either a fixed amount or a rate. The larger discount wins;
marketing asked for no stacking.

Refs: SHOP-312""",
      add=["shop/pricing/discounts.py", "tests/test_discounts.py"]),
    c("maya", "tomas", "2026-10-12T14:15:00", """Pricing: price a whole cart

price_cart sums the lines, takes the best discount and taxes what is
left. Tax is computed after the discount, as finance confirmed.""",
      add=["shop/pricing/engine.py", "tests/test_engine.py"]),
    c("tomas", "jonah", "2026-10-13T08:55:00", """Payments: error types and circuit breaker

PaymentError is the one type callers catch. The breaker opens after N
failures in a row and fails fast until the reset time has passed, so a
dead gateway does not tie up every worker.

Refs: SHOP-320""",
      add=["shop/payments/__init__.py", "shop/payments/errors.py", "shop/payments/breaker.py",
           "tests/test_breaker.py"]),
    c("tomas", "priya", "2026-10-15T13:02:00", """Payments: gateway client

Plain urllib, JSON in and out. A socket timeout becomes
PaymentGatewayTimeout and counts as a breaker failure. The timeout and
the URL come from the environment through shop.config.

Refs: SHOP-321""",
      add=["shop/config.py", "shop/payments/gateway.py"]),
    c("elena", "jonah", "2026-10-16T10:40:00", """Orders: storage and place_order

place_order reserves stock, prices the cart, charges the card and saves
the order. Any failure after the reservation releases the stock again.
Storage is a dict with a JSON flush for now.

Refs: SHOP-330""",
      add=["shop/storage.py", "shop/orders/__init__.py", "shop/orders/service.py", "tests/test_orders.py"]),
    c("jonah", "elena", "2026-10-19T15:10:00", """Orders: summary for the API

Amounts go out as strings with two decimals so the UI never parses a
float.""",
      add=["shop/orders/summary.py"]),
    c("jonah", "priya", "2026-10-20T11:25:00", """Catalog: product search

Case-insensitive; every query word must appear in the product name.
Good enough for five products; a real index can come later.

Refs: SHOP-345""",
      add=["shop/catalog/search.py", "tests/test_search.py"]),
    c("priya", "maya", "2026-10-21T09:30:00", """Web: WSGI app, routes and handlers

No framework: a route table of regexes and handlers that return
(status, body). Errors the customer can fix map to 400, payment
failures to 502.

Refs: SHOP-340""",
      add=["shop/web/__init__.py", "shop/web/app.py", "shop/web/handlers.py", "tests/test_web.py"]),
    c("priya", "tomas", "2026-10-23T14:00:00", """Web UI: page shell, state store and API client

ES modules served as static files, no build step. api.js is the only
file that talks to the server.""",
      add=["web/package.json", "web/index.html", "web/styles.css", "web/src/api.js", "web/src/state.js",
           "web/src/format.js"]),
    c("priya", "maya", "2026-10-26T10:12:00", """Web UI: router, products page and search box

Hash routes keep the static hosting simple. The page renders from the
store on every change.""",
      add=["web/src/router.js", "web/src/products.js", "web/src/search.js", "web/src/main.js",
           "web/src/components/header.js", "web/src/components/productCard.js"]),
    c("maya", "priya", "2026-10-27T16:45:00", """Web UI: cart and checkout pages

The checkout form posts the cart with the customer's postcode and an
optional coupon, then shows the server's summary.

Refs: SHOP-352""",
      add=["web/src/cart.js", "web/src/checkout.js", "web/src/components/cartTable.js"]),
    c("tomas", "elena", "2026-10-29T09:20:00", """Docker image and compose file

Slim Python base, no extra packages. The data volume keeps orders
across restarts. The health check calls /healthz.

Refs: SHOP-360""",
      add=["Dockerfile", ".dockerignore", "docker-compose.yml"]),
    c("elena", "tomas", "2026-10-30T12:00:00", "Makefile with test, run and docker targets", add=["Makefile"]),
    c("jonah", "elena", "2026-11-02T10:30:00", """Changelog for the 1.3 releases, version 1.3.2

Write down what shipped so far; release notes come from this file from
now on.""",
      add=["CHANGELOG.md"],
      edit=[("shop/__init__.py", '__version__ = "1.0.0"', '__version__ = "1.3.2"')]),
    c("jonah", "elena", "2026-11-04T17:05:00", """Makefile: add a smoke target

scripts/smoke.sh runs one real checkout against a running stack and
reads the order summary back. Run it after every deploy.

Refs: SHOP-405""",
      add=["scripts/smoke.sh"],
      edit=[("Makefile", ".PHONY: test run docker\n", ".PHONY: test run docker smoke\n"),
            ("Makefile", "\tdocker compose up --build\n",
             "\tdocker compose up --build\n\nsmoke:\n\t./scripts/smoke.sh http://localhost:8080\n")]),
    # The last 10 commits (T5).
    c("priya", "maya", "2026-11-06T10:15:00", """Search: match tags as well as names

Customers search for "gift" and "green", which are tags, not words in
the product names, so those searches found nothing. Search now joins
the name and the tags into one text, and every query word must appear
in it.

This is the follow-up to SHOP-345 that we parked at launch. Results
keep the catalog order; with five products a score is not worth it
yet.

Refs: SHOP-412""",
      edit=[("shop/catalog/search.py", '"""Case-insensitive search over product names."""',
             '"""Case-insensitive search over product names and tags."""'),
            ("shop/catalog/search.py", "        text = product.name.lower()\n",
             '        text = " ".join((product.name.lower(),) + product.tags)\n'),
            ("tests/test_search.py", "\n\ndef test_blank_query_finds_nothing",
             '\n\ndef test_matches_tags():\n    assert [p.sku for p in search("gift")] == ["SET-200"]\n'
             "\n\ndef test_blank_query_finds_nothing")]),
    c("tomas", "priya", "2026-11-09T08:40:00", """Docker: run as a non-root user

The container ran as root, which the platform team's admission policy
now rejects. Create a user with the fixed uid 10001, give it the data
and logs directories, and switch to it before CMD.

The fixed uid matters: the data volume keeps its owner across image
rebuilds, so a random uid would lock us out of old order files.""",
      edit=[("Dockerfile", "RUN mkdir -p /app/data /app/logs\n",
             "RUN useradd --create-home --uid 10001 shop \\\n    && mkdir -p /app/data /app/logs \\\n"
             "    && chown shop /app/data /app/logs\nUSER shop\n")]),
    c("maya", "tomas", "2026-11-10T14:05:00", """Tax: central zone levy is now 8.125%

The central zone raised its combined sales tax from 8% to 8.125% on
1 November. Finance sent the new rate on the ticket; nothing else in
the table changed.

Orders placed before the change keep their stored totals, because an
order stores its price breakdown at checkout time.

Refs: SHOP-418""",
      edit=[("shop/geo/zones.py", '"central": Decimal("0.0800"),', '"central": Decimal("0.08125"),')]),
    c("tomas", "maya", "2026-11-11T09:30:00", """Web UI: wait for a pause in typing before searching

Every key press sent a search request, and replies that arrived out
of order could show results for an older query. Wait 250 ms after the
last key press before calling the API, and drop the pending call on
each new key press.

250 ms felt instant in hallway tests and cut search traffic to about a
quarter in the staging logs.""",
      edit=[("web/src/search.js", "// Search box. Asks the server on every key press.\n",
             "// Search box. Waits for a pause in typing before it asks the server.\n"),
            ("web/src/search.js", 'import { setState } from "./state.js";\n',
             'import { setState } from "./state.js";\n\nconst WAIT_MS = 250;\nlet timer = null;\n'),
            ("web/src/search.js", SEARCH_JS_OLD, SEARCH_JS_NEW)]),
    c("priya", "tomas", "2026-11-12T11:50:00", """Breaker: start a fresh failure count after the cool-down

After the reset time the breaker let calls through again but kept the
old failure count, so the first failure after a long outage opened it
again at once, even when the gateway was healthy for most calls.

Reset the count together with opened_at. The gateway now gets a fair
second chance after every cool-down.

Refs: SHOP-431""",
      edit=[("shop/payments/breaker.py", "            self.opened_at = None\n            return\n",
             "            self.opened_at = None\n            self.failures = 0\n            return\n")]),
    c("maya", "priya", "2026-11-13T15:20:00", """README: document loyalty tiers and coupons

Support keeps asking why a gold member got no discount. Write the
rules down where everyone can find them: the minimums, the rates, and
the rule that the larger discount wins and discounts never stack.

Also add a test for a gold member at exactly the minimum, the case
from the support thread. It fails today; the fix comes next.""",
      edit=[("README.md", README_RESET, README_RESET + """
## Discounts

Gold members get 10% off when the subtotal is $50.00 or more. Silver
members get 5% off when the subtotal is $75.00 or more. Coupons:
`WELCOME5` takes $5.00 off, `SPRING15` takes 15% off. Only the larger
discount applies; discounts never stack. Tax is charged on the
subtotal after the discount.
"""),
            ("tests/test_engine.py", "def test_mixed_cart_subtotal", GOLD_TEST + "def test_mixed_cart_subtotal")]),
    c("tomas", "maya", "2026-11-16T10:00:00", """Compose: serve the UI with nginx and proxy /api

The app served only the API, so the web UI needed a second server in
development. nginx now serves web/ and proxies /api and /healthz to the
app, which no longer publishes a port of its own.

proxy_read_timeout is 35 s, a little above the 30 s payment timeout, so
nginx does not cut a slow checkout before the app can answer.""",
      add=["deploy/nginx.conf"],
      edit=[("docker-compose.yml", '    ports:\n      - "8080:8080"\n', NGINX_SERVICE)]),
    c("maya", "tomas", "2026-11-17T13:35:00", """Checkout: answer 409 when stock runs out

OutOfStock escaped the handler and the server answered 500 with a
stack trace. Map it to 409 with the message from the exception. The
UI already shows "Some items sold out." for that status.

Refs: SHOP-437""",
      edit=[("shop/web/handlers.py", "from shop.catalog.inventory import Inventory\n",
             "from shop.catalog.inventory import Inventory, OutOfStock\n"),
            ("shop/web/handlers.py", "    except CheckoutFailed as exc:\n",
             '    except OutOfStock as exc:\n        return 409, {"error": str(exc)}\n    except CheckoutFailed as exc:\n'),
            ("tests/test_web.py", "\n\ndef test_unknown_route_is_404",
             '\n\ndef test_out_of_stock_is_409():\n    order = {"items": [{"sku": "MUG-010", "qty": 2}], '
             '"customer": {"postcode": "94107"}}\n    assert call("POST", "/api/checkout", order)[0] == 409\n'
             "\n\ndef test_unknown_route_is_404")]),
    c("priya", "maya", "2026-11-18T09:10:00", """Tests: cover the breaker cool-down

Add a test that the breaker lets calls through once the reset time has
passed, starts a fresh count, and opens again after the next failures.
It would have caught the stale count fixed last week.""",
      edit=[("tests/test_breaker.py", "    b.success()\n    b.failure()\n    b.check()\n",
             "    b.success()\n    b.failure()\n    b.check()\n" + COOL_DOWN_TEST)]),
    c("tomas", "priya", "2026-11-19T16:30:00", """Release 1.4.0

Bump the version and write the 1.4.0 changelog entry. Tagging and the
deploy follow the usual checklist.""",
      edit=[("shop/__init__.py", '__version__ = "1.3.2"', '__version__ = "1.4.0"'),
            ("CHANGELOG.md", "# Changelog\n\n", "# Changelog\n\n" + CHANGELOG_140)]),
]


def die(msg):
    sys.exit(f"gen.py: {msg}")


def undo(text, old, new, where):
    if text.count(new) != 1:
        die(f"edit text must appear once in {where}: {new[:50]!r}")
    return text.replace(new, old)


def app_files():
    out = []
    for d, dirs, files in os.walk(APP):
        dirs[:] = [x for x in dirs if x not in ("__pycache__", ".pytest_cache")]
        out += [os.path.relpath(os.path.join(d, f), APP) for f in files]
    return sorted(out)


def read(path):
    with open(os.path.join(APP, path), encoding="utf-8", newline="") as fh:
        return fh.read()


def write(root, path, text):
    p = os.path.join(root, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    os.chmod(p, 0o755 if text.startswith("#!") else 0o644)


def versions(fixed):
    """Work tree, HEAD tree, and the files each commit writes (oldest first)."""
    state = {p: read(p) for p in app_files()}
    planned = sorted(p for k in COMMITS for p in k["add"])
    if planned != sorted(state):
        die(f"app/ files and the commit plan differ: {sorted(set(planned) ^ set(state))}")
    if fixed:
        state[T2_FIX[0]] = undo(state[T2_FIX[0]], T2_FIX[2], T2_FIX[1], "T2 fix")
    work = dict(state)
    for p, old, new in reversed(DIRTY):
        state[p] = undo(state[p], old, new, p)
    head = dict(state)
    snaps = []
    for k in reversed(COMMITS):
        snaps.append({p: state[p] for p in k["add"] + [e[0] for e in k["edit"]]})
        for p, old, new in reversed(k["edit"]):
            state[p] = undo(state[p], old, new, p)
        for p in k["add"]:
            del state[p]
    return work, head, snaps[::-1]


def git(out, *args, env=None, stdin=None):
    base = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LC_ALL": "C", "TZ": "UTC",
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
    r = subprocess.run(["git", "-C", out, *args], env={**base, **(env or {})}, input=stdin,
                       capture_output=True, text=True)
    if r.returncode:
        die(f"git {' '.join(args)}: {r.stderr.strip()}")


def build_repo(out, work, snaps):
    git(out, "init", "-q", "--object-format=sha1", "-b", "main")
    for k, snap in zip(COMMITS, snaps):
        for p, text in snap.items():
            write(out, p, text)
        name, email, tz = AUTHORS[k["who"]]
        stamp = k["date"] + tz
        env = {"GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email, "GIT_AUTHOR_DATE": stamp,
               "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email, "GIT_COMMITTER_DATE": stamp}
        git(out, "add", "-A")
        rev_name, rev_email, _ = AUTHORS[k["rev"]]
        change = hashlib.sha1((k["date"] + k["msg"]).encode()).hexdigest()
        msg = f"{k['msg']}\n\nReviewed-by: {rev_name} <{rev_email}>\nChange-Id: I{change}\n"
        git(out, "commit", "-q", "--no-verify", "-F", "-", env=env, stdin=msg)
    for p, _, _ in DIRTY:
        write(out, p, work[p])


# ---- logs/app.log ---------------------------------------------------------

def lineno(head, path, needle):
    hits = [(i, l.strip()) for i, l in enumerate(head[path].splitlines(), 1) if needle in l]
    if len(hits) != 1:
        die(f"{needle!r} must appear once in {path}")
    return hits[0]


def tracebacks(head):
    """Traceback text for a checkout that failed on a timeout and on an open circuit."""
    def frame(path, needle, fn):
        n, code = lineno(head, path, needle)
        return f'  File "/app/{path}", line {n}, in {fn}\n    {code}\n'

    top = ("Traceback (most recent call last):\n" + frame("shop/web/handlers.py", "order = place_order(", "handle_checkout")
           + frame("shop/orders/service.py", "raise CheckoutFailed(f", "place_order"))
    cause = "\nThe above exception was the direct cause of the following exception:\n\n"
    charge = frame("shop/orders/service.py", "gateway.charge(", "place_order")
    timeout = ("Traceback (most recent call last):\n" + frame("shop/payments/gateway.py", "with self.opener(", "charge")
               + '  File "/usr/local/lib/python3.12/urllib/request.py", line 215, in urlopen\n'
               "    return opener.open(url, data, timeout)\n"
               '  File "/usr/local/lib/python3.12/socket.py", line 720, in readinto\n'
               "    return self._sock.recv_into(b)\nTimeoutError: timed out\n" + cause
               + "Traceback (most recent call last):\n" + charge
               + frame("shop/payments/gateway.py", "raise PaymentGatewayTimeout(", "charge")
               + "shop.payments.errors.PaymentGatewayTimeout: no answer in 30000 ms\n" + cause + top
               + "shop.orders.service.CheckoutFailed: payment failed: no answer in 30000 ms")
    circuit = ("Traceback (most recent call last):\n" + charge
               + frame("shop/payments/gateway.py", "self.breaker.check()", "charge")
               + frame("shop/payments/breaker.py", "raise CircuitOpen(", "check")
               + "shop.payments.errors.CircuitOpen: payments circuit open\n" + cause + top
               + "shop.orders.service.CheckoutFailed: payment failed: payments circuit open")
    return timeout.split("\n"), circuit.split("\n")


def log_lines(head):
    rng = random.Random(SEED)
    tb_timeout, tb_circuit = tracebacks(head)
    clock = [0]
    order = [18000]
    lines = []
    skus = ["TEA-001", "TEA-002", "MUG-010", "KET-100", "SET-200"]
    queries = ["green", "black+tea", "mug", "kettle", "gift", "sencha", "assam", "tasting+set"]

    def ts():
        ms = clock[0]
        return f"2026-11-20T{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}Z"

    def emit(level, logger, msg):
        lines.append(f"{ts()} {level:<5} {logger}: {msg}")

    def rid():
        return f"{rng.getrandbits(24):06x}"

    def oid():
        order[0] += 1
        return f"o-{order[0]:06d}"

    def normal():
        r = rng.random()
        if r < 0.62:
            p = rng.random()
            if p < 0.45:
                path, status = "GET /api/products", 200
            elif p < 0.70:
                path, status = f"GET /api/search?q={rng.choice(queries)}", 200
            elif p < 0.85:
                path, status = f"GET /api/orders/o-{rng.randrange(1000, order[0]):06d}/summary", 200
            elif p < 0.93:
                path, status = "GET /healthz", 200
            else:
                path, status = "POST /api/checkout", 201
            emit("INFO", "shop.web", f"req={rid()} {path} {status} {rng.randrange(2, 90)}ms")
        elif r < 0.70:
            emit("INFO", "shop.payments",
                 f"charge ok order={oid()} latency={rng.randrange(180, 900)}ms")
        elif r < 0.77:
            emit("INFO", "shop.orders",
                 f"order o-{order[0]:06d} paid items={rng.randrange(1, 6)} total={rng.randrange(8, 240)}.{rng.randrange(100):02d}")
        elif r < 0.92:
            emit("DEBUG", "shop.catalog", f"cache hit sku={rng.choice(skus)}")
        elif r < 0.96:
            emit("INFO", "shop.inventory",
                 f"reserved {rng.choice(skus)} x{rng.randrange(1, 4)} left={rng.randrange(0, 60)}")
        elif r < 0.985:
            emit("WARN", "shop.web", f"slow request req={rid()} GET /api/search?q={rng.choice(queries)} "
                 f"{rng.randrange(800, 2500)}ms")
        else:
            reason = rng.choice(["insufficient_funds", "card_expired", "do_not_honor"])
            emit("WARN", "shop.payments", f"charge declined order={oid()} reason={reason}")

    # Unrelated errors long before the outage, each one recovered.
    decoys = {
        9811: ("shop.storage", "flush failed: [Errno 28] No space left on device: 'data/shop.json.tmp'"),
        9840: ("shop.storage", "flush failed: [Errno 28] No space left on device: 'data/shop.json.tmp'"),
        9872: ("shop.storage", "flush failed: [Errno 28] No space left on device: 'data/shop.json.tmp'"),
        33410: ("shop.catalog", "price feed refresh failed: ConnectionResetError: [Errno 104] "
                "Connection reset by peer"),
        33456: ("shop.catalog", "price feed refresh failed: ConnectionResetError: [Errno 104] "
                "Connection reset by peer"),
        47002: ("shop.web", "unhandled KeyError: 'sku' req=5c0d9e POST /api/checkout 500 3ms"),
    }
    recover = {9900: ("shop.storage", "flush ok orders=1204 after 3 failures"),
               33490: ("shop.catalog", "price feed refresh ok products=5")}
    while len(lines) < ROOT_LINE - 1:
        n = len(lines) + 1
        clock[0] += rng.randrange(300, 1300)
        if n in decoys:
            emit("ERROR", *decoys[n])
        elif n in recover:
            emit("INFO", *recover[n])
        elif n > ROOT_LINE - 400 and rng.random() < 0.08:
            slow = 2500 + (n - (ROOT_LINE - 400)) * 60 + rng.randrange(0, 900)
            emit("WARN", "shop.payments", f"slow gateway reply {slow}ms order={oid()}")
        else:
            normal()

    errors = -1  # the root line itself is not a follow-on error
    timeouts_left = 6  # calls that still wait 30 s before the breakers open
    while errors < FOLLOW_ERRORS:
        clock[0] += rng.randrange(80, 700)
        if errors >= 0 and rng.random() < 0.55:
            normal()
            continue
        req, o = rid(), oid()
        if errors >= 0 and FOLLOW_ERRORS - errors == 1:
            emit("ERROR", "shop.orders", f"{rng.randrange(20, 60)} orders stuck in state new for 5 min")
            errors += 1
            continue
        if timeouts_left > 0 or rng.random() < 0.04:
            timeouts_left -= 1
            emit("ERROR", "shop.web", f"checkout failed req={req} order={o}: PaymentGatewayTimeout: "
                 "no answer in 30000 ms")
            lines.extend(tb_timeout)
            ms = 30000 + rng.randrange(1, 40)
        else:
            emit("ERROR", "shop.web", f"checkout failed req={req} order={o}: CircuitOpen: payments circuit open")
            lines.extend(tb_circuit)
            ms = rng.randrange(1, 4)
        emit("ERROR", "shop.web", f"req={req} POST /api/checkout 502 {ms}ms")
        errors += 2
        if rng.random() < 0.2:
            emit("WARN", "shop.payments", "circuit open, failing fast")
    for _ in range(40):
        clock[0] += rng.randrange(80, 700)
        emit("INFO", "shop.web", f"req={rid()} GET /api/products 200 {rng.randrange(2, 90)}ms")
    return lines


def main(argv):
    args = [a for a in argv if a != "--fixed"]
    if len(args) != 1 or args[0].startswith("-"):
        die("usage: python3 -I gen.py <out_dir> [--fixed]")
    out = os.path.abspath(args[0])
    if os.path.exists(out) and os.listdir(out):
        die(f"{out} is not empty")
    os.makedirs(out, exist_ok=True)
    work, head, snaps = versions("--fixed" in argv)
    build_repo(out, work, snaps)
    write(out, "logs/app.log", "\n".join(log_lines(head)) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
