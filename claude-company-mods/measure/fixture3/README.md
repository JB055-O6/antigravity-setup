# Benchmark fixture 3

The test project for benchmark v3 (spec section 10): a small tea shop app
(Python package `shop/` with 25 modules, a 15-file JS UI in `web/`, pytest tests,
Dockerfile, compose file) with a 30-commit git history, two uncommitted edits
and a 5 MB service log. The tasks and their grading rules are in `TASKS.md`.

## Files

- `app/` - the final work tree, the one source of the app files. Edit here.
- `gen.py` - builds a work copy: `python3 -I gen.py <empty_dir> [--fixed]`.
  It replays the commit plan in `gen.py` into a git repo with fixed authors and
  dates (same commit hashes on every build), leaves the two uncommitted edits,
  and writes `logs/app.log` (seeded RNG, git-ignored). `--fixed` applies the
  T2 reference fix (for T3).
- `HASHES.txt` - SHA-256 of `tests/**` and `logs/app.log` in a fresh build.
- `grading/` - `grade.py` (hash check, T2 and T3 grading) and the held-out
  tests. They stay outside the work copy until the session ends.
- `test_gen.py` - checks the build and every grading rule in `TASKS.md`.

## Check

    python3 -I test_gen.py      # prints: ok

Checked with Python 3.13.18, git 2.43.0 and pytest 9.2.0
(`pip install --user pytest`; pytest is not part of the base image).
`grading/grade.py` needs Python 3.11 or newer: it runs pytest with `-P`.

## After a change to app/ or the log generator

Facts in `TASKS.md` (line numbers, names, counts) and `HASHES.txt` can go
stale; `test_gen.py` says which. Refresh the hashes from a fresh build:

    python3 -I gen.py /tmp/f3 && (cd /tmp/f3 && find logs tests -type f | LC_ALL=C sort | xargs sha256sum) > HASHES.txt

If the number of tests in `app/tests` changes, update `BASE_TESTS` in
`grading/grade.py`.
