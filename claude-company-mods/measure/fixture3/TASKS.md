# Fixture 3 tasks

Rules for the runner (Task 4):

- Work copy: each run gets a new empty directory `$W`. Never reuse a work copy.
  - Fixture tasks: `python3 -I gen.py $W` (T3: `python3 -I gen.py $W --fixed`, so its tests start green).
  - T1-big: a snapshot of this repo at commit 4b40414, committed once with a fixed author and date, so the graph module sees a git repo:

    ```
    git -C <repo> archive 4b40414 | tar -x -C $W
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      GIT_AUTHOR_NAME=bench GIT_AUTHOR_EMAIL=bench@example.com GIT_AUTHOR_DATE=2026-11-26T00:00:00+00:00 \
      GIT_COMMITTER_NAME=bench GIT_COMMITTER_EMAIL=bench@example.com GIT_COMMITTER_DATE=2026-11-26T00:00:00+00:00
    git -C $W init -q -b main && git -C $W add -A && git -C $W commit -q -m snapshot
    ```
- The session runs with cwd `$W`. The prompt is the prompt cell, sent exactly as written.
- `regex` rule: every backticked pattern must match the final answer (the `result` text of the stream-json `result` event) with Python `re.search`. Patterns use only inline flags. In the table, `\|` inside a pattern stands for `|` (the table escape).
- `cmd` rule: after the session ends, run the backticked command with bash, cwd `$W`, env `FIXTURE` = the absolute path of this directory. Exit 0 = pass. The command copies the held-out tests from `grading/` into the work copy, so the session never sees them. It also fails when the work copy has a conftest.py or pytest configuration (the fixture ships none).
- Every fixture task (all but T1-big) also fails when `python3 -I "$FIXTURE/grading/grade.py" hashes` exits non-zero after the session: a file under `tests/` or `logs/app.log` changed.
- T6: the scorer also logs whether the session made an Agent call (from the jsonl). This is logged, not graded.
- T1-big runs only for setups C, E and F (spec section 15).
- `python3 -I test_gen.py` checks every rule below: correct answers built from the generated files pass (bare, dotted, linked and mixed-case forms), and near-miss and hedged answers fail.
- Savers: bashcap acts only on output over its threshold (30 KB, or 12 KB if V11 lowers it). Measured in a fresh copy: `python3 -m pytest` 1.9 KB, `git log -10` 6.1 KB, `git log -10 -p` 14.3 KB, `git diff` 1.1 KB, `git log -p` 71 KB.

| id | prompt | grading | savers |
|---|---|---|---|
| T1 | How does this shop work out the sales tax on an order? Trace the code path from the HTTP handler for checkout down to the function that returns the tax rate. List the functions in call order, one per line, as `path:function`. Then give the tax rate in percent for postcode 73301. | regex: `(?s)handle_checkout.*place_order.*price_cart.*compute_tax.*levy_for_zone` `zones\.py\|geo\.zones` `\b8\.125\b` | graph (cross-file call chain), diet read cap and grep cap, router (explore agent) |
| T2 | Running `python3 -m pytest -q` in this repo shows one failing test. Find the cause in the application code and fix it. Do not change any file under tests/, and do not add conftest.py or pytest configuration. | cmd: `python3 -I "$FIXTURE/grading/grade.py" t2` | rtk (pytest output), diet read cap, governor; no bashcap (pytest output is under 2 KB) |
| T3 | Add tax-exempt customers to this shop. Give `shop.models.Customer` a new field `tax_exempt: bool = False` after the existing fields, which keep their order. When it is True, `shop.pricing.engine.price_cart` must return a breakdown with zero tax; the subtotal and the discount stay as they are. Add a test for this in a new file under tests/. Do not change existing files under tests/, and do not add conftest.py or pytest configuration. | cmd: `python3 -I "$FIXTURE/grading/grade.py" t3` | diet read cap, rtk (pytest output), governor |
| T4 | Checkout broke in production today, and logs/app.log is the service log. Find the root error that started the outage. Answer with its line number in the file (the first line is 1), its exception class, and the number of lines after it whose level is ERROR. | regex: `\b61[ ,.]?873\b` `PaymentGatewayTimeout` `\b312\b` | bashcap (large grep output), rtk full (grep, cat to rtk read), diet read cap (5 MB file), headroom rule |
| T5 | Summarize the last 10 commits on this branch and the uncommitted changes in the work tree, for a teammate who was away. End your answer with exactly these three lines: `AUTHORS: <full names of everyone who authored one of those 10 commits, comma-separated>`, then `TICKETS: <every ticket id like SHOP-123 that appears in those 10 commit messages, comma-separated>`, then `DIRTY: <every file path with uncommitted changes, comma-separated>`. | regex: `(?m)^\W*(?i:AUTHORS)\W*:(?=.*Maya Okafor)(?=.*Tomas Lindqvist)(?=.*Priya Raman)(?!.*Jonah)(?!.*Elena)` `(?m)^\W*(?i:TICKETS)\W*:(?=.*SHOP-345\b)(?=.*SHOP-412\b)(?=.*SHOP-418\b)(?=.*SHOP-431\b)(?=.*SHOP-437\b)(?!(?:.*?SHOP-\d+){6})` `(?m)^\W*(?i:DIRTY)\W*:(?=.*shop/config\.py)(?=.*docker-compose\.yml)(?!(?:[^,\n]*,){2})` | rtk (git log, git diff); bashcap only if V11 lowers the cap to 12 KB (`git log -10 -p` is 14.3 KB) |
| T6 | Use a subagent to look this up: which JavaScript function in web/ names the `/api/checkout` path, and which Python function serves that path on the server? Answer with two lines, each the `path:line` where that function is defined. Give no other line numbers for those two files. | regex: `(?s)^(?!.*\bapi\.js:(?!32\b)\d)(?!.*\bapi\.js:32\s*\(?\s*(?:[-–—,/;]\|\bor\b\|\band\b\|\bto\b)\s*(?:lines?\s*)?\d).*\bapi\.js:32\b` `(?s)^(?!.*\bhandlers\.py:(?!43\b)\d)(?!.*\bhandlers\.py:43\s*\(?\s*(?:[-–—,/;]\|\bor\b\|\band\b\|\bto\b)\s*(?:lines?\s*)?\d).*\bhandlers\.py:43\b` | router and crew (scout on a cheaper model), diet subagent report rule, savers block in the subagent prompt |
| T1-big | This repo holds a Claude Code mod named company. Somewhere it turns a `low` effort into `medium` for Opus. Find the function that makes this decision and the one place where the mod's hooks call it (not a test). Answer with two lines, each `path:line`: first where the function is defined, then the call. Give no other line numbers for those two files. | regex: `(?s)^(?!.*\bgovernor\.ts:(?!21\b)\d)(?!.*\bgovernor\.ts:21\s*\(?\s*(?:[-–—,/;]\|\bor\b\|\band\b\|\bto\b)\s*(?:lines?\s*)?\d).*\bgovernor\.ts:21\b` `(?s)^(?!.*\bregister\.tsx:(?!459\b)\d)(?!.*\bregister\.tsx:459\s*\(?\s*(?:[-–—,/;]\|\bor\b\|\band\b\|\bto\b)\s*(?:lines?\s*)?\d).*\bregister\.tsx:459\b` | graph (4,337-file repo), diet grep cap and read cap, router |
