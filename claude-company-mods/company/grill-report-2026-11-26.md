---
plugin: grill
version: 1.2.3
date: 2026-11-26
target: /home/user/antigravity-setup/claude-company-mods/company
style: Select All (Architecture + Rewrite Plan, Hard-Nosed Critique, Multi-Perspective Panel, ADR, Paranoid Mode)
addons: all 8 (scale stress, hidden costs, principle violations, strangler fig, success metrics, before vs after, assumptions audit, compact & optimize) + dashboard in ASD-STE100 (client ask)
agents: grill:recon, grill:architecture, grill:error-handling, grill:security, grill:testing, grill:edge-cases
---

# Company mod 0.10.2: full audit

Scope: `claude-company-mods/company` (19 files, 1,937 lines) plus `claude-company-mods/measure`.
Tags: **O** = observed in code or data. **H** = hypothesis (engine or tool behaviour not verified).

## 0. Manager mistake found by this audit (rule 19)

- **What:** the report's headline savings (−17% total, −42% / −54% on the subagent task) are wrong.
- **Proof (O):** `scratchpad/measure/r2/*.jsonl`. Run `t1-base-1` was the first run of round 2 with a cold prompt cache: cache_create 39,688, cache_read 24,508, cost $0.2949. The warm rerun `t1-base-2`: cache_create 11,857, cost $0.1149. Mod runs: $0.1291 and $0.1067 (mean $0.1179). Round 1 `t1-base` has the same cold start ($0.269).
- **Corrected numbers (O, arithmetic):** with the cold run swapped for the warm one, base = $0.989 − 0.2949 + 0.1149 = **$0.809**, mod = **$0.824**. The mod cost **about 2% more** on this task set. No task shows a saving outside the noise.
- **Cause:** `run2.sh` always ran the stock setup first; I did not compare cache-create vs cache-read before claiming; the scout fact-check checked numbers against files, not the method.
- **Fix:** REPORT.md corrected the same day. The new benchmark: discarded warm-up per setup, rotated order, n≥4 for subagent tasks, failed runs excluded from cost means, cache-normalised cost reported.
- **What still holds (O):** quality 16/16; the router does send subagents to Haiku; the mod adds about 3.3k input tokens per small task (t3: 52,539 vs 49,254).

## 1. Diagnostics

| Check | Result |
|---|---|
| `claude plugin test` | 149 pass, 0 fail, 1.46 s |
| `claude plugin validate` | pass (README install-line advice only) |
| `tsc -p` | exit 0 |
| Live hook failures in this session transcript | none after the fixed 0.9.x `boot($)` load error |
| Context the mod adds | charter 4,295 chars every request; 5 agent defs (prompts 291-352 chars, descriptions 66-129); diet block 741 chars per subagent; Read note ~193 chars when it fires |
| State | closure in `register()` :249-256, module globals `governor.ts:39`, `diet.ts:31-33`, `$.store` 'routes' and 'meter', atom 'panel'; no `$.state` |
| Tools installed here | rtk 1.2.1 (`~/.local/bin/rtk`, checksum-verified installer), graphify 0.9.120 (`uv tool`) |

Verified facts used below (O): `rtk rewrite` exits **3** when it rewrites and **1** when not (two agent reports said 0: wrong). `graphify update` is AST-only; with `GRAPHIFY_BACKEND=none` the report says "Token cost: 0". `.graphifyrc` keys seen in `rcfile.py`/`cli.py`: languages, query_budget, query_depth, demote_docs, viz_node_limit; no backend key found. On this repo graphify takes 48 s first build, 22-43 s per update, writes graph.json 48 MB and GRAPH_REPORT.md 1 MB. `AbovePrompt` draws on terminal, desktop and mobile; `$.process.run` takes argv (no shell).

## 2. Findings (deduplicated, ranked)

| ID | Sev | Tag | Where | Finding | Fix | Effort | From |
|---|---|---|---|---|---|---|---|
| F1 | CRITICAL | O | measure/run2.sh:8, r2 jsonl | Cold-cache first run made the mod look 17% cheaper (section 0) | warm-up, rotate, n≥4, cache-normalised cost | <1 d | testing |
| F2 | CRITICAL | H | planned host | A host that calls `next(e)` again after a module throws post-`next` runs the tool twice (Bash `rm`, `git push`) | wrap `next`: record called + result; on throw after call return saved result; generator wrapper never retries after first yield | <1 d | edge, arch |
| F3 | HIGH | O | panel.tsx:108-112 | CHARTER, ROUTER, GOVERNOR, METER, DIET show ✓ always; faults are silent; mod logs nothing | per-module `{fails,lastErr}` from one `fail()`; ✓ only at 0 fails | <1 d | error |
| F4 | HIGH | O | register.tsx:397, :419 | Read/Grep caps skip subagents; Bash has no cap; a subagent `cat` of a 1 MB log or the graph report lands whole | caps for subagents too; Bash output cap | <1 d | manager |
| F5 | HIGH | O | register.tsx:464-479 | A throw in `showStatus` inside turn.step resets `out = e`, dropping the Fable→Opus reroute: credits billed with no notice | bookkeeping in its own try; decision kept | <1 d | error |
| F6 | HIGH | O | register.tsx:310-325 | One throw in `routeSpawn` also skips the diet block; nothing counts it | one try per feature + `fail()` | <1 d | error |
| F7 | HIGH | O | register.tsx:76-92,254,100-134 | `st` god object written by 5 parts; hidden links spawn→turn.step (`efforts`, `runs`), spawn→Agent (`runByTool`), meter→turn.step (`economy`) | host owns `Shared`; modules get `ctx`; sync reads only in turn.step | <1 wk | arch |
| F8 | HIGH | O | register.tsx:162,323,350,387,401,412,478,493 | Every hook swallows its own errors, so a 3-failure breaker would never trip | remove inner try when porting; host catches and counts | <1 wk | arch |
| F9 | HIGH | H | planned rtk | Rewritten `rtk git push` may slip past a `Bash(git push:*)` deny rule; `Bash(rtk:*)` allow = allow all | `$.tool.check` the original command; rewrite only when allowed | <1 d | security |
| F10 | HIGH | H | planned rtk | Bad rewrite cases: exit 127/timeout/empty stdout, heredoc, `$()`, newline, leading `-`, already `rtk`, pipe hiding exit code | accept only exit 3 + non-empty stdout + `out` minus `rtk ` tokens equals `cmd`; skip newline/`<<`; 2 s timeout; test `false` stays non-zero | <1 d | edge, security |
| F11 | HIGH | H | planned graph | Overlapping `graphify update` runs corrupt graph.json; own outputs retrigger runs; 20-45 s inside a hook stalls the turn | one run at a time + dirty flag; pid lock file; exclude graphify-out; detached, never awaited | <1 wk | edge, error |
| F12 | HIGH | H | planned graph | Writing `.git/info/exclude` by hand-built path breaks subdirs, worktrees, submodules, user excludes | path from `git rev-parse --git-path info/exclude`; read, add line once, refuse symlink | <1 d | security |
| F13 | HIGH | H | planned install | Checksum from the same release proves little; `uv tool install graphifyy` floats; name one letter off `graphify` | pin rtk tag + SHA-256 in source; pin `graphifyy==0.9.120`; show commands, ask once | <1 d | security |
| F14 | HIGH | H | planned bash cap | Cutting by UTF-16 units can leave a lone surrogate: invalid request JSON, stuck session; saved outputs hold secrets | cut on code points; save under scratchpad by `tool_use_id`; delete at session end; "not saved" on disk full | <1 d | edge, security |
| F15 | HIGH | O | run2.sh:18, score2.py:13 | Benchmark unfair for rtk/graph: only `Bash(python3:*)` allowed, tasks barely use Bash or multi-file nav; NO RESULT counted as $0 | allow each setup's command form; add 2 Bash-heavy + 1 navigation task; exclude failed runs; check each module acted | <1 d | testing |
| F16 | HIGH | O | wiring.test.ts:76,245,320; panel.test.tsx:93-98 | Exact UI strings asserted: STE rewrite in the same change as the split breaks the safety net | split first, tests unchanged; text change last; then structure asserts + STE lint test | rule | testing |
| F17 | HIGH | O | repo | No CI for claude-company-mods | GitHub Action: plugin test, tsc, py_compile | <1 d | testing |
| F18 | MEDIUM | O | register.tsx:365-378 | `routes` tally get → await → set: parallel spawns lose counts; same race for a ledger | one in-memory writer, debounced store write | <1 d | edge, arch |
| F19 | MEDIUM | O | register.tsx:233, governor.ts:73 | 'meter' written, never read: after reload economy is off in the 85-89% band | load it at register; or delete and recompute | <1 d | edge |
| F20 | MEDIUM | O | diet.ts:31-33, governor.ts:39, register.tsx:250 | Counters reset on reload; live for the process, not the session | ledger in `Shared`, mirrored to `$.state`/`$.store` | <1 d | manager, arch |
| F21 | MEDIUM | O | charter.ts, register.tsx:153 | Fixed overhead ≈3.3k input tokens per small task (+3-4% cost) | cut charter wording; never change its bytes mid-session (cache) | <1 d | manager |
| F22 | MEDIUM | O | panel.tsx:25-88,93; types/index.d.ts:3-17 | Dashboard hard-wired to 7 parts | `modules[]` in Panel, shape 'panel-3' | <1 d | arch |
| F23 | MEDIUM | O | register.tsx:120-134,249-256 | Reload without session.start: blank `st` overwrites panel; routed subagent loses its effort | boot once on first hook after register | <1 d | edge |
| F24 | MEDIUM | H | register.tsx:153-263 | ~10 sequential engine calls before `next(e)` in session.start; one hang stalls start | Promise.all + timeout | <1 d | error |
| F25 | MEDIUM | H | register.tsx:141-143; panel.tsx:76,125,128 | Notices persist in transcript; command text in planned cards/notices can leak tokens, `user:pass@` URLs | one `redact()` before `note()`; test with sample secrets | <1 d | security |
| F26 | MEDIUM | H | planned graph | graphify child inherits API keys; a hostile repo `graphify-out` symlink writes outside repo | `GRAPHIFY_BACKEND=none` + blank key vars in env; refuse linked/tracked graphify-out | <1 d | security |
| F27 | MEDIUM | H | planned rtk | Project-local rtk TOML filters could hide errors | never run `rtk trust`; notice when repo has filters | <1 d | security |
| F28 | MEDIUM | H | planned nudge/caps | context.window 0 → NaN nudge; nudge via prompt.compose breaks cache; chars/4 undercounts CJK ~3x; stored switch-off with no reset kills module forever | toast only, once per crossing; guard 0; label estimates; switch-off per session, `/company on <id>` | <1 d | edge |
| F29 | MEDIUM | O | measure/run2.sh:9; fixture | Benchmark not reproducible from repo (fixture parts in scratchpad; t1 answer points at code the split moves) | commit fixture + generator; freeze t1 target | <1 d | testing |
| F30 | MEDIUM | O | tests | Untested: caps on isError/deny result, 'failed'/'background' status, workflow/resume skip | add 6 tests before the split | <1 d | testing |
| F31 | LOW | O | various | Comment "last 12" vs `slice(-40)` :99/:102; ":190 undefined"; background runs never close :509; readNote says "600 lines" for one-line files; unused `suggestedAgent`, `governedByRule`; crew names twice (router.ts:12, register.tsx:23-74); loose regex diet.test.ts:140; `options` unused | fix when touching each file | <1 d | all |
| F32 | GOOD | O | router/governor/diet/directives | Pure logic, table-driven tests, decisions before `next` kept apart from bookkeeping after; never denies; `readWindows` rejects NaN | keep | — | all |

## 3. Edge case risk matrix (Paranoid Mode)

| # | Scenario | Likelihood | Impact | Risk | Component | File |
|---|---|---|---|---|---|---|
| 1 | Host re-calls `next` after a module error: Bash runs twice | Med | High | CRITICAL | host | planned |
| 2 | Bad rtk rewrite replaces or empties a command; pipe hides exit code | Med | High | HIGH | rtk | planned |
| 3 | rtk rewrite slips past a deny rule | Med | High | HIGH | rtk | planned |
| 4 | Lone surrogate from output cut: API request fails, retries loop | Med | High | HIGH | bash cap | planned |
| 5 | Overlapping graphify runs corrupt graph.json / retrigger | High | Med | HIGH | graph | planned |
| 6 | Subagent reads 1 MB file or log whole | Med | Med | HIGH | diet | register.tsx:397 |
| 7 | Reroute to Opus lost on bookkeeping throw | Low | High | MED | governor | register.tsx:479 |
| 8 | Lost counts in routes/ledger/breaker | High | Low | MED | store | register.tsx:365 |
| 9 | Economy off after reload at 85-89% | Med | Med | MED | meter | governor.ts:73 |
| 10 | Windows: no `/tmp`, `.exe` lookup, PowerShell | Med | Med | MED | rtk/graph/cap | planned |
| 11 | Secrets in notices or saved outputs | Med | Med | MED | panel/cap | register.tsx:141 |
| 12 | Panel write storm with parallel subagents | Med | Low | LOW | panel | register.tsx:471 |

## 4. Review styles

### 4.1 Architecture review + rewrite plan

1. **Redesign decisions:** one plugin, one hooks module (engine rule), inside it a host + ordered module list; modules never touch `$.ui`, atoms or the store directly.
2. **New architecture:** `hooks/register.tsx` (host: wraps hooks, breaker, budget, ledger) → `hooks/modules/index.ts` (static ordered array) → modules: charter, meter, router+crew, governor, diet (read/grep), bashcap, rtk, graph, audit, nudge, dashboard.
3. **Data model:** `Shared` in memory (efforts, runs, economy, ledger, module health); mirrored debounced to `$.state` (session, survives reload) and `$.store` (lifetime totals); Panel gains `modules[]`, shape 'panel-3'.
4. **Reliability:** wrapped `next` (F2), per-module fail counts and timeouts, probe binaries once, detached long jobs, one writer per store key.
5. **Security:** permission check on original command (F9), strict rewrite acceptance (F10), pinned installers (F13), redaction (F25), scratchpad-only saved outputs (F14), env scrub for graphify (F26).
6. **Testing:** add 6 gap tests first (F30); host tests for throw before/after `next` and in a generator; budget, ledger, rtk table, bash cap golden, nudge hysteresis; STE lint; CI (F17).
7. **Performance:** nothing slow on the hot path; `$.process.run` never awaited in turn.step; rtk rewrite has a 2 s cap (typ. ms); panel writes coalesced.
8. **DX:** one file per module with a header (id, caps, what it adds); `/company` shows each module's health and last error.
9. **Migration:** strangler fig (5.4).
10. **Keep:** pure files, `panelBlocks` shared by Pane and text, black-box `wiring.test.ts` until the last step.

### 4.2 Hard-nosed critique + roadmap

- **Critical flaws:** the savings claim was not real (F1); faults are invisible (F3); the biggest token leaks (subagent reads, Bash output) are uncapped (F4).
- **80/20:** fix the benchmark, cap Bash and subagent output, make health visible. That is about 20% of the work and decides whether the rest is worth it.
- **Backlog (impact / risk / effort):** 1 F1 benchmark · 2 F4 caps everywhere + bash cap · 3 F3 health · 4 F2 host with safe `next` · 5 F7/F8 Shared + breaker · 6 F30 gap tests · 7 F17 CI · 8 F21 cut charter · 9 F10/F9 rtk safe rewrite · 10 F11/F12 graph runner · 11 F20/F18 ledger · 12 F22 dashboard modules[] · 13 F25 redaction · 14 F13 pinned install · 15 F19/F23 reload safety.
- **Quick wins (<1 day):** correct REPORT.md; delete dead 'meter' write or read it; split try blocks (F5, F6); add gap tests; CI job.
- **Red flags:** claims before method check; ✓ hard-coded; module globals.

### 4.3 Multi-perspective panel

| Persona | Top 3 | Risk they flag |
|---|---|---|
| Staff backend | host + Shared; safe `next`; one ledger writer | double execution |
| Security | rtk permission check; pinned installs; redaction | rewrite bypasses deny rules |
| SRE | health per module; timeouts + detached jobs; CI | silent failure |
| Performance | cap Bash/subagent output; cut charter; no awaits in turn.step | cache breaks from changing sections |
| Product (client) | visible savings; simple STE dashboard; honest numbers | claims that do not hold |
| Junior dev advocate | one file per module; plain module header; structure-based tests | exact-string tests that break on wording |

**Unified plan:** correctness and honesty first (F1, F2), then visibility (F3), then savings (F4, rtk, graph), then the look. Disagreement on rtk strictness is settled by the fixed benchmark, not by opinion.

### 4.4 ADRs

1. **One plugin, internal module host.** Alternatives: several plugins (more installs), settings hooks (no caps). Consequence: one load error stops all; mitigated by tests + validate before ship.
2. **Wrapped `next` with saved result.** Alt: catch → `next(e)` (double run). Consequence: each port re-tested for throw-after-next.
3. **Shared in memory, mirrored to `$.state`/`$.store`.** Alt: store reads in hooks (slow, racy). Consequence: debounced writes may lose the last seconds on crash.
4. **Per-module caps measured per shape** (sections, tool context, subagent prompt, Bash output). Alt: one generic counter (cannot see shapes). Consequence: an adapter per shape.
5. **Charter bytes never change mid-session.** Alt: dynamic trimming (breaks cache). Consequence: overhead cut by rewording only.
6. **rtk via `rtk rewrite` + permission check on original.** Alt: `rtk init -g` hook (nudges, no ledger, permission gap). Consequence: one extra check per Bash call.
7. **Graph: CLI only, LLM off, detached runner.** Alt: `/graphify` skill (13k tokens) or MCP (schema every request). Consequence: the model learns of it from one hint line.
8. **Install: ask once, pinned versions.** Alt: silent install. Consequence: pins need a manual bump.
9. **Dashboard = band + pane + tool cards + `/company` text, all in STE.** Alt: pane only (desktop only). Consequence: four renderers share one `panelBlocks` model.
10. **Keep a module only if the benchmark proves a saving.** Alt: keep everything. Consequence: rtk strictness and the graph can be dropped by data.

### 4.5 Paranoid verdict
See section 3 and section 6.

## 5. Add-ons

### 5.1 Scale stress (100x)
First to break: graph on huge repos (48 MB json, 45 s updates; needs the size gate and detached runner); parallel subagents (store races F18, panel write storm); long sessions (context growth: the compact nudge and output caps matter most here).

### 5.2 Hidden costs
1. ≈3.3k input tokens per small task from charter + crew (F21). 2. Cache rewrites if any session section changes. 3. graphify CPU 20-45 s per update on big repos. 4. Debug time from silent faults (F3). 5. Upkeep of pinned tool versions (F13).

### 5.3 Principle violations
SRP: `register.tsx` does wiring, state, UI and logging. Dependency inversion: parts call `$.ui`/atom directly. Least privilege: graphify child inherits all host env (F26); rtk rewrite may widen permissions (F9).

### 5.4 Strangler fig migration (mod works after every step; 149+ tests, tsc 0, validate pass at each)
- S0: correct REPORT.md; fix benchmark harness (F1, F15, F29); add 6 gap tests (F30); CI (F17).
- S1: move `st`, `note`, `showStatus`, CREW into `host.ts`; no behaviour change.
- S2: loader with wrapped `next`, breaker, ledger; port charter, diet-read, diet-grep; host tests.
- S3: meter module (+ F19 fix); S4: router+crew, then governor (+ F5, F6).
- S5: new modules, low risk first: bash cap (+ subagent caps, F4), compact nudge, context audit, then rtk, then graph.
- S6: dashboard: band, pane 'panel-3', tool cards, STE text; update exact-string tests last, one commit.
- S7: benchmark 5 setups × 6+ tasks × n≥4 with warm-up; keep or tune rtk/graph from data; package, push, report.

### 5.5 Success metrics
- Warm-cache paired cost per task, mod vs stock, n≥4: target ≤ stock on solo tasks, clearly below on subagent/Bash-heavy tasks.
- Fixed overhead per request: target ≤ 1,000 input tokens (today ≈1.6k).
- Tokens kept out of context per session (ledger, labelled as estimate).
- 5h-window % used per hour of work, logged per session (the client's real metric).
- 0 double executions; every module fault visible on screen within 1 turn.

### 5.6 Before vs after
```
BEFORE                                  AFTER
register.tsx (all hooks, st, UI)        register.tsx = host
  ├ router.ts  governor.ts               ├ wraps every hook (safe next, breaker, caps)
  ├ diet.ts    directives.ts             ├ Shared (efforts, runs, economy, ledger, health)
  ├ charter.ts panel.tsx                 └ modules/index.ts (ordered)
  └ $.store routes/meter (racy)             charter meter router+crew governor diet
                                            bashcap rtk graph audit nudge dashboard
UI: pane (desktop) + /company text       UI: band + pane + tool cards + /company, STE text
```

### 5.7 Assumptions audit (and the fast check)
| Assumption | Check |
|---|---|
| Notices cost 0 tokens | inspect a request's messages in a `-p` stream after a notice |
| Effort change mid-session keeps the cache | benchmark: cache_read before/after an effort change |
| `tool.check` runs after `tool.call` | engine types + a test with a deny rule |
| `rtk rewrite` exit 3 = rewritten | O: verified here |
| graphify update is LLM-free with BACKEND=none | O: report says 0 tokens; keep env scrub anyway |
| AbovePrompt draws on terminal | O: types say terminal, desktop, mobile; verify on screen |
| `$.state` survives reload | reload test in a live session |

### 5.8 Compact & optimize
Cut charter wording (F21); delete 'meter' dead write or use it (F19); delete `suggestedAgent`, fold `governedByRule` into the ledger (F31); one CREW source (F31); merge `note` + `showStatus` into host `ctx`; coalesce panel writes.

### 5.9 Dashboard design (client ask: simple, boxes, bubbles, self-monitor, ASD-STE100)
STE rules applied: approved simple words; one idea per sentence; sentences ≤ 20 words; active voice; present tense; numbers with units; no idioms; technical names (RTK, graph) allowed; a lint test enforces length and a banned-word list.

Band above the prompt (terminal, desktop, mobile):
```
● Company: 9 of 9 parts work   ● 5 h: 42 % used   ● Saved: 31,200 tokens (estimate)   ● Graph: ready
```
Pane (one box per part, plus a self-check box):
```
┌ RTK ─────────────── ● ON ┐  ┌ SELF-CHECK ─────────── ● OK ┐
│ RTK makes command output │  │ All 9 parts work.            │
│ shorter.                 │  │ Errors this session: 0.      │
│ Commands changed: 14.    │  │ The graph update takes 41 s. │
│ Tokens saved: 8,420.     │  │ It runs in the background.   │
│ Last: "git log -5".      │  │ The mod added 2,100 tokens.  │
│ 1,701 → 1,138 bytes.     │  │ The mod saved 33,300 tokens. │
└──────────────────────────┘  └──────────────────────────────┘
```
Card under a tool row: `RTK: this output is 33 % shorter (1,701 → 1,138 bytes).`
Where no screen part exists (cloud web): the same text in `/company` and in "company ·" notices.

## 6. Executive summary

**Verdict:** the code is clean, tested and safe today: no hook blocks work, pure logic is well tested. The biggest risk is not in the code. It is in the proof: the measured saving was a cache artefact, so the mod has not yet shown that it saves tokens. The second risk is the planned host: done naively it can run a command twice.

**Top 3 actions:**
1. Fix the benchmark and the report (F1, F15). Without it no later claim is trustworthy.
2. Cap output everywhere: subagent reads and Bash output, with safe cutting (F4, F14). This is the largest real token leak.
3. Build the host with a safe `next`, breaker and visible health (F2, F3, F7, F8) before adding rtk and graph.

**Confidence:** F1 High (raw data checked). F4 High (code read). F2 High as a design risk (pattern is certain; engine retry semantics unverified). F9 Medium (depends on hook order; types cited by the security agent). rtk/graph value Low until the fixed benchmark runs. More confidence comes from: the fixed benchmark, a live deny-rule test, a live reload test.

**Paranoid verdict:** the scariest failure is the planned host re-running `next` after a module error: one thrown exception would silently run a destructive Bash command twice.

## Fixing Plan

### Phase 1: Critical fixes (do immediately)
- **F1** benchmark cold cache, `measure/run2.sh:8`, REPORT.md. **Fix:** correct REPORT.md now; harness: warm-up per setup, rotate order, n≥4, exclude failed runs, cache-normalised cost. **Effort:** <1 d. **Files:** `claude-company-mods/REPORT.md`, `measure/run3.sh`, `measure/score3.py`.
- **F2** safe `next` in the host. **Fix:** wrapped `next` records call + result; generator wrapper; tests for throw before/after/mid-stream. **Effort:** <1 d. **Files:** `hooks/register.tsx` (host), `hooks/host.test.ts`.

### Phase 2: High-priority fixes
- **F3** health per module: `fail()`, ✓ only at 0 fails, lastErr in `/company`. `hooks/panel.tsx`, host. <1 d.
- **F4** caps for subagents + Bash output cap. `modules/diet.ts`, `modules/bashcap.ts`. <1 d.
- **F5, F6** split try blocks in turn.step and agent.spawn. `modules/governor.ts`, `modules/router.ts`. <1 d.
- **F7, F8** Shared + remove inner try when porting. host, all modules. <1 wk.
- **F9, F10** rtk: permission check on original, strict acceptance rules, timeouts, table tests. `modules/rtk.ts`. <1 d.
- **F11, F12** graph runner: one run, dirty flag, pid lock, detached; exclude via `git rev-parse`. `modules/graph.ts`. <1 wk.
- **F13** pinned installers behind `/company install`. `modules/install.ts`. <1 d.
- **F14** bash cap: code-point cut, scratchpad save, cleanup. `modules/bashcap.ts`. <1 d.
- **F15** fair benchmark tasks and allowed tools. `measure/`. <1 d.
- **F16** rule: split with tests unchanged; text change last. process.
- **F17** CI job. `.github/workflows/company-mod.yml`. <1 d.

### Phase 3: Medium-priority improvements
- F18 one ledger writer; F19 meter reload; F20 ledger in Shared/`$.state`/`$.store`; F21 cut charter; F22 'panel-3' modules[]; F23 boot once after reload; F24 parallel start + timeout; F25 redact(); F26 env scrub + graphify-out checks; F27 rtk filter notice; F28 nudge/caps guards and per-session switch-off; F29 reproducible fixture; F30 six gap tests (do before S1).

### Phase 4: Low-priority cleanup (by file)
- `register.tsx`: comment :99, ":190 undefined", background runs :509, `options` unused.
- `diet.ts`: readNote wording for one-line files. `router.ts`: remove `suggestedAgent`, build CREW_NAMES from crew. `governor.ts`: fold `governedByRule` into ledger. `diet.test.ts:140`: exact count.

### Dependency graph
- F30 (gap tests) before F7/F8 (split): the safety net must exist first.
- F2 before every new module (F4 bash cap, F9-F14): all run inside the host.
- F20 ledger before the dashboard savings numbers (5.9).
- F1/F15 benchmark before deciding rtk strictness and keeping the graph.
- F16: STE text change after all ports.

### Estimated total effort (human-days; agent time is shorter)
- Phase 1: 1 d · Phase 2: 5 d · Phase 3: 3 d · Phase 4: 0.5 d (opportunistic) · **Total: ≈9.5 d**

## Addendum: second sweep (same day, after the client asked "is this all?")

The audit cannot prove that nothing is missing. This sweep closed some gaps and lists the rest.

New items:
- **F33 [MEDIUM][O]** The first correction missed `PROJECT.md:229,258`, which still showed −54% and −16.7%. Both are now marked WRONG. Recorded under REPORT.md mistake #8.
- **F34 [MEDIUM][O]** `governor.ts:29` raises Opus low → medium on every request, the main loop included. This overrides the person's own choice and can raise token use. Our own data shows Opus low passing 6 of 6 tool tasks ($0.84). The rule rests only on third-party index data. Fix: test it in the fair benchmark; drop it or limit it to subagents if it does not pay.
- **F35 [O, changes F2]** Engine types (`claude-code/index.d.ts:5292-5294`): "a hook that fails is skipped: the hooks beneath and core run in its place, or its last `next` result stands". `next.called` exists (:5321). So the engine itself never runs a tool twice. The double-run risk exists only if our host catches the error and calls `next` again. Design rule: the host counts the failure, then rethrows. It never re-calls `next`.
- **F36 [O, confirms F9]** `:19108-19109`: a `tool.call` hook "answers ahead of" PreToolUse and the permission check. The rtk rewrite runs before permissions, so the permission-gap risk is real. The fix stays: run `$.tool.check` on the original command.

Still not verified (each needs a test or a live check before ship):
1. Engine behaviour in a live session: whether `$.state` survives a reload, whether notices cost tokens, whether an effort change keeps the prompt cache, and the hook order between plugins.
2. Router quality on real prompts: how often it sends a hard task to Haiku, which forces a costly redo. Never measured.
3. Two sessions at once (desktop + terminal) writing the same `$.store` keys.
4. rtk and graphify internals: rtk's tee folder and telemetry default, the `--` argument, and graphify cache growth on disk.
5. Windows native: no PowerShell path was tested (the pwsh download was blocked earlier).
