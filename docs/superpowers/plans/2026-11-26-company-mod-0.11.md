# Company mod 0.11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `company` 0.10.2 into 0.11.0: a module host with per-module caps, health and a savings ledger, plus the new modules bashcap, rtk, graph, audit, nudge and install, plus an ASD-STE100 dashboard, all proven by a fair benchmark.

**Architecture:** `hooks/register.tsx` stays the single hooks module. It builds one `Shared` state object and calls each module's `register(on, ctx)` from a static list in `hooks/modules/index.ts`. Every hook follows one guard pattern: when the module is off, pass through; on a throw, count the failure, then rethrow (never call `next` again). Persistent numbers live in atoms (`$.state`, which survives reload) and `$.store` (lifetime), written by the host only.

**Tech Stack:** TypeScript function hooks against the `claude-code` engine API (types at `claude-company-mods/company/.claude-plugin/types/claude-code/index.d.ts`), tests with `claude-code/testing` run by `claude plugin test`, bash + Python 3.13 for the benchmark, rtk 1.2.1, graphify (`graphifyy==0.9.120`).

**Spec:** `docs/superpowers/specs/2026-11-26-company-mod-0.11-design.md` (approved). Audit: `claude-company-mods/company/grill-report-2026-11-26.md` (finding IDs F1-F36).

## Global Constraints

- Paths: `R=claude-company-mods/company` (repo, git-tracked; all work happens here). `M=/root/.claude/dev-mods/5b430f7e-0f7b-55c5-8d67-00dd071d0571/company` (live copy, hot-reloads this session; it is synced from R only in Tasks 8, 16 and 19).
- **CHECK** (run at the end of every task; all must hold): `bash claude-company-mods/check.sh` prints `TEST OK <n> pass 0 fail`, `VALIDATE OK`, `TSC OK`.
- One hooks module: `hooks/hooks.json` stays `{ "modules": ["./register.tsx"] }`. No `import()`.
- Validator rules (engine, verified): `$` may be passed only to a function declared at the top of its file (a function declaration or a const bound to one) or imported from the mod's own files; `$` is otherwise only spelled `$.noun.method(...)`; every `on` call is `on("<string literal event>", [matcher,] hook)`. So `ctx` holds no `$`, and no helper calls a hook it got as a parameter.
- Guard pattern for every hook (copy exactly; generator form for `turn.step`; amended in Task 6 — `ok(ctx)` after success resets the failure streak; `beneath(next)` marks errors that come from below so only a module's own errors count):
  ```ts
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn(ctx)) return next(e)
    try { const r = await bashcapCall($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('turn.step', {}, async function* ($, e, next) {
    if (!isOn(ctx)) return yield* next(e)
    try { const r = yield* governStep($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  ```
- Module wiring (validator-proven in Task 6): each module file exports a top-level `export function register<Name>(on: On, ctx: Ctx): void` (e.g. `registerBashcap`); `register.tsx` imports each by name and calls them one by one in the spec order (no loop, no `m.register(...)`, which the validator refuses). The same event may be hooked by several modules only when every hook after the first carries a matcher; use `{}` for "match all" (`on('session.start', {}, hook)`). Chain order = call order in register.tsx.
- Caps: charter section ≤ 4,800 chars, its bytes fixed for the whole session; subagent prompt additions ≤ 2,000 chars; graph hint ≤ 320 chars; graphify command output ≤ 6 KB.
- Bash cap: output > 30 KB → keep 12 KB head + 12 KB tail; economy: > 15 KB → 6 KB + 6 KB; keep up to 40 cut lines matching `/error|fail|exception|traceback|fatal/i`; cut on code points. If V11 (Task 10) shows the engine already cuts near 30,000 chars, the threshold becomes 12 KB (head 5 KB + tail 5 KB).
- Breaker: 3 consecutive failures → module off for this session only; a timeout counts as a failure; a missing binary is `off: not installed`, not a failure; `/company on <id>` turns it back on.
- Token estimate: `Math.ceil(chars / 4)`, always labelled "estimate". The band shows **net** = saved − added, negative when negative.
- rtk: rewrite only on exit 3 with non-empty stdout that is reversible to the original; timeout 2,000 ms; skip a command with `\n`, `<<`, an `rtk ` prefix, or > 2,000 chars; both original and rewritten command must pass `$.tool.check` with no prompt; never run `rtk trust`; never use `rtk pipe`; never touch a call aimed at a device.
- graphify: env `GRAPHIFY_BACKEND=none` and every backend key variable set to `''`; `graphify update <root>` only; timeout 600,000 ms; one run per repo through a pid lock valid 15 min; pin `graphifyy==0.9.120`.
- rtk pin: `v1.2.1`, SHA-256 per asset copied from that release's `checksums.txt` into source.
- Nudge: toast at ≥ 60% of the context window, once per crossing; never through `prompt.compose`.
- Main model never changed; the governor never raises effort on the main loop.
- Off-machine session (cloud, SSH, VM) with a device attached: rtk skips device calls; router and crew step aside for the session. Cloud: no install notice, no installs.
- Panel atom shape tag: `'panel-3'`.
- UI text is ASD-STE100: ≤ 20 words per sentence; active voice; present tense; banned words: `utilize, leverage, via, e.g., i.e., etc., robust, seamless`, and words ending in `-ing` except names in `STE_NAMES` (`RTK`, `Haiku`, `Sonnet`, `Opus`, `Fable`, graph and module ids).
- Git: commit on `claude/models-capability-analysis-pt61if` only; no model IDs in commit text; end each commit with the session's Co-Authored-By and Claude-Session lines.

## Review Focus

1. **A Bash command that redirects or pipes (`git log > out.txt`, `git diff | head -50`)**: the user expects the same file content or the same first lines as without the mod. Test in Task 12: such commands are left untouched unless the rewrite keeps the redirect or pipe, character for character.
2. **A repo that already has a `graphify-out/` from the user's own run (maybe with LLM labels)**: the user expects the graph kept and updated, not replaced by a smaller one. Test in Task 13: the module runs `graphify update` without `--force`; the "fewer nodes" refusal is logged as `kept`, not a failure.
3. **Two Claude sessions in one repo (desktop + WSL terminal)**: the user expects one graph run at a time. Test in Task 13: a live lock owned by another pid blocks a run; a lock older than 15 min or with a dead pid is taken over.
4. **A background subagent (`background: true`)**: the user expects it to show done when it ends. Test in Task 9: a background run closes when its completion arrives, or shows `ended` at session end.
5. **Very large numbers on the band (sessions past 1,000,000 tokens)**: the user expects short, readable numbers. Test in Task 16: `formatTokens(1234567) === '1.2 M'`, `formatTokens(31200) === '31,200'`, `formatTokens(-1200) === '−1,200'`.

---

## Phase A: safety net and fair measurement

### Task 0: Workspace and the CHECK script

**Files:**
- Create: `claude-company-mods/check.sh`
- Modify: `.gitignore` (repo root)
- Copy: `$M/.claude-plugin/types/` → `$R/.claude-plugin/types/` (not committed)

**Interfaces:**
- Produces: `check.sh` (runs from the repo root): `claude plugin test $R`, `claude plugin validate $R`, `npx -y tsc -p $R --noEmit`; prints `TEST OK <n> pass 0 fail` / `VALIDATE OK` / `TSC OK`, or `FAIL <step>` with the last 20 lines, and exits non-zero on any failure.

- [ ] **Step 1:** Copy the types folder from M to R. Add `claude-company-mods/company/.claude-plugin/types/` to `.gitignore`.
- [ ] **Step 2:** Write `check.sh` as specified. Run it. Expected: `TEST OK 149 pass 0 fail`, `VALIDATE OK`, `TSC OK`.
- [ ] **Step 3:** Commit `check.sh` and `.gitignore`.

### Task 1: Gap tests on today's code (F30)

**Files:**
- Test: `$R/hooks/gaps.test.ts` (new)

**Interfaces:**
- Consumes: the current `register.tsx` through `claude-code/testing` (`test(name, async ($, on) => …)`, stubs registered with `on(...)`, events fired with `$.tool.call`, `$.agent.spawn`, `$.session.start`).

- [ ] **Step 1: Write the six tests.** Each one pins today's behaviour:
  - `read cap leaves an error result untouched`: the stub Read returns `{ isError: true }` for a 300 KB file → the result has no `[company-diet]` note in `context`.
  - `read cap leaves a denied result untouched`: the stub returns `{ deny: 'no' }` → returned as is.
  - `grep cap does not count an error result`: the stub Grep returns `isError` → the status line has no ` diet` count.
  - `a failed Agent call marks the run failed`: spawn, then `$.tool.call` Agent with the same `tool_use_id` returning `isError` → the panel run status is `'failed'`.
  - `a workflow or resume spawn is not routed`: `workflow: true` → the engine stub sees no `model`; `resume: 'x'` → same.
  - `diet count is exact`: two capped reads → the status line ends with ` · 2 diet`.
- [ ] **Step 2:** Run `claude plugin test $R`. Expected: 155 pass, 0 fail. (These tests describe today's code; one that fails has found a bug: write it in the task report and keep the test as `test.skip` with a `// F30:` comment naming the bug for Task 8.)
- [ ] **Step 3:** CHECK, then commit.

### Task 2: CI job (F17)

**Files:**
- Create: `.github/workflows/company-mod.yml`

- [ ] **Step 1:** Prove headless runs work: `env -i HOME=$(mktemp -d) PATH="$PATH" claude plugin test $R`. Expected: the same pass count with no login. If it needs a login, write that in the task report and make the workflow run only `tsc` and `python3 -m py_compile claude-company-mods/measure/*.py`.
- [ ] **Step 2:** Workflow on push and PR for paths `claude-company-mods/**`: Node 22, `npm i -g @anthropic-ai/claude-code`, copy the types with `claude plugin validate $R` (it writes them) or vendor the copy step, then the three CHECK commands and `py_compile`.
- [ ] **Step 3:** CHECK, then commit. (The workflow is proven in CI after the push; report its first run's status.)

### Task 3: Benchmark fixture (F29)

**Files:**
- Create: `claude-company-mods/measure/fixture3/gen.py`, `claude-company-mods/measure/fixture3/README.md`
- Create (generated, committed): `claude-company-mods/measure/fixture3/app/` (about 60 files), `fixture3/HASHES.txt`
- Test: `claude-company-mods/measure/fixture3/test_gen.py`

**Interfaces:**
- Produces: `python3 -I gen.py <out_dir>` builds a fresh copy: a small web app (Python package `shop/` with 25 modules + JS `web/` with 15 files + `tests/` with pytest tests + `Dockerfile` + `docker-compose.yml`), a git repo with 30 commits, a 5 MB `logs/app.log` with one root error (`PaymentGatewayTimeout` at line 61,873, then about 300 follow-on errors), and one seeded bug for T2. `HASHES.txt` holds SHA-256 values of `tests/**` and `logs/app.log`.
- Produces: `fixture3/TASKS.md`: T1 explore, T2 bug fix, T3 feature, T4 log triage, T5 git summary, T6 subagent lookup, T1-big (explore on a frozen copy of this repo at commit `4b40414`), each with its exact prompt and its grading rule (regex or a command whose exit code grades).

- [ ] **Step 1:** Write `test_gen.py`: generate into a temp dir twice → identical tree hashes (deterministic, seeded RNG); `git -C out rev-list --count HEAD` = 30; `app.log` size between 5,000,000 and 5,300,000 bytes; `pytest -q` in the output fails exactly 1 test before the T2 fix.
- [ ] **Step 2:** Run it and confirm it fails (`gen.py` missing).
- [ ] **Step 3:** Write `gen.py` and `TASKS.md`. Every grading rule is mechanical: no model grades.
- [ ] **Step 4:** Run `python3 -I test_gen.py`. Expected: `ok`.
- [ ] **Step 5:** CHECK, then commit.

### Task 4: Benchmark runner v3, scorer and ledger (F1, F15)

**Files:**
- Create: `claude-company-mods/measure/run3.sh`, `claude-company-mods/measure/score3.py`, `claude-company-mods/measure/LEDGER.md`
- Test: `claude-company-mods/measure/test_score3.py`

**Interfaces:**
- Produces: `run3.sh <setup> <task> <rep> <lane>`: makes a fresh work copy at `$SCRATCH/bench3/<lane>/<setup>-<task>-<rep>`; runs `claude -p "<task prompt>" --model opus --effort medium --output-format stream-json --verbose` with the setup's plugin set and an allowed-tools list that admits the setup's command forms (rtk forms only in D and F); writes `r3/<setup>-<task>-<rep>.jsonl`; checks `HASHES.txt` after the run.
- Produces: setups `A` stock (company off), `B` 0.10.2 (from git tag/commit `785718d`), `C` 0.11 with rtk and graph off, `D` 0.11 + rtk full, `E` 0.11 + graph, `F` 0.11 + both. Modules are switched with the env vars `COMPANY_OFF=rtk,graph` (read once at session start by the host, Task 6).
- Produces: `bench3.sh`: per repetition, one discarded warm-up run per setup, then all setups × tasks in a rotated order; up to 3 lanes in parallel; before each run it reads the 5 h use (`claude -p '/usage'` or the session meter) and waits while ≥ 85%.
- Produces: `score3.py r3/` → a table per task × setup: n, passes, fails, mean cost (fails excluded), input tokens split into `uncached / cache_create / cache_read`, output tokens, a `modules acted` column from the jsonl, and paired verdicts by the spec rule (§10 decision rules) against C, and C against A.
- Produces: `LEDGER.md` header: `| date | change | setups | runs | cost $ | tokens in/out | pass/fail | verdict | next action |`.

- [ ] **Step 1:** Write `test_score3.py` with synthetic jsonl files: a failed run does not lower the cost mean; the cache classes add up to total input; the paired rule says `keep` for 4 pairs all 6% cheaper, `unclear` for 2 of 4 cheaper, `drop` when a task fails that A passes.
- [ ] **Step 2:** Run it: fails (no `score3.py`).
- [ ] **Step 3:** Write `score3.py`, `run3.sh`, `bench3.sh` and the `LEDGER.md` header.
- [ ] **Step 4:** Run `python3 -I test_score3.py` → `ok`. Dry run: `DRY=1 bash bench3.sh 1` prints the planned run order for 1 repetition (rotation visible) and runs nothing.
- [ ] **Step 5:** CHECK, then commit.

## Phase B: the module host (behaviour unchanged until Task 9)

### Task 5: Extract host state and crew (no behaviour change)

**Files:**
- Create: `$R/hooks/host.ts`, `$R/hooks/crew.ts`
- Modify: `$R/hooks/register.tsx` (state, `note`, `showStatus`, `boot`, `applyLimits` and CREW move out), `$R/hooks/router.ts:12` (CREW_NAMES built from crew.ts)

**Interfaces:**
- Produces (`crew.ts`): `export const CREW: readonly CrewSpec[]` (the five entries now at `register.tsx:23-74`, unchanged), `export type CrewSpec = { name: string; model: string; effort: string; does: string; description: string; prompt: string; tools?: string[] }`.
- Produces (`host.ts`): `export type MeterState` (as today), `export function note(st: MeterState, kind: string, text: string): void`, `export function showStatus($: EngineInterface, st: MeterState): void`, `export async function boot($: EngineInterface, st: MeterState): Promise<number>`, `export async function applyLimits($: EngineInterface, st: MeterState, limits: unknown): Promise<void>`, `export const panel` (the atom).

- [ ] **Step 1:** Move the code. Keep every exported name and string the same. Fix the comment at `:99` ("last 40 kept").
- [ ] **Step 2:** CHECK. Expected: the same pass count as Task 1, no test edited.
- [ ] **Step 3:** Commit.

### Task 6: Host core: Shared, ctx, guard helpers, breaker, caps (F2, F3, F7, F8, F28, F35)

**Files:**
- Create: `$R/hooks/core.ts`, `$R/hooks/modules/index.ts`
- Test: `$R/hooks/core.test.ts`, `$R/hooks/guard.test.ts`

**Interfaces:**
- Produces (`core.ts`, pure, no `$`):
  - `export type ModuleId = 'charter'|'meter'|'router'|'governor'|'diet'|'bashcap'|'rtk'|'graph'|'audit'|'nudge'|'install'|'dashboard'`
  - `export type Caps = { section?: number; subagentPrompt?: number; toolContext?: number }` (chars)
  - `export type OffReason = 'errors' | 'not installed' | 'device attached' | 'cloud' | 'env'`
  - `export type Health = { on: boolean; fails: number; streak: number; lastErr?: string; off?: OffReason }`
  - `export type Entry = { added: number; saved: number; acted: number }` (tokens, estimates)
  - `export type Shared = { health: Record<ModuleId, Health>; ledger: Record<ModuleId, Entry>; efforts: Map<string, string>; runs: CrewRun[]; runByTool: Map<string, string>; economy: boolean; windows: Windows; log: PanelLine[]; seq: number; version: string; offMachine: boolean; deviceAttached: boolean; dirty: boolean }`
  - `export type Ctx = { id: ModuleId; caps: Caps; shared: Shared }`
  - `export type ModuleMeta = { id: ModuleId; title: string; what: string; caps: Caps }` (no register function: modules export named `register<Name>(on, ctx)` instead)
  - `export function createShared(ids: readonly ModuleId[]): Shared`
  - `export function isOn(ctx: Ctx): boolean` · `export function fail(ctx: Ctx, err: unknown): void` (streak +1, fails +1, `lastErr` = `redact(String(err)).slice(0, 120)`, off with `'errors'` at streak 3) · `export function ok(ctx: Ctx): void` (streak 0) · `export function setOff(ctx: Ctx, why: OffReason): void` · `export function setOn(ctx: Ctx): void`
  - `export function added(ctx: Ctx, chars: number): void` · `export function saved(ctx: Ctx, tokens: number): void` · `export function acted(ctx: Ctx, n?: number): void` · `export function noteOf(ctx: Ctx, text: string): void` (redacted, pushes to `shared.log`, keeps the last 40)
  - `export function capText(ctx: Ctx, shape: keyof Caps, text: string): string` (cut at the cap on a code-point boundary; a cut adds a note)
  - `export function cutCodePoints(s: string, maxChars: number): string` · `export function estimateTokens(chars: number): number` · `export function redact(s: string): string`
  - `export const FAIL_LIMIT = 3`
  - `export function envOff(value: string | undefined): ModuleId[]` (parses `COMPANY_OFF=rtk,graph`; the host reads the variable once at `session.start` through the engine's env API and calls `setOff(ctx, 'env')` for each id)
- Produces (`modules/index.ts`): `export const MODULE_META: readonly ModuleMeta[]` in the spec order (charter, meter, router, governor, diet, bashcap, rtk, graph, audit, nudge, install, dashboard) — the dashboard and health read it; `register.tsx` calls the named `register<Name>` functions in the same order (a test checks the two orders match). Modules not yet built have meta only.
- Consumes: `CrewRun`, `PanelLine` from `../types`; `Windows` from `governor.ts`.

- [ ] **Step 1: Spike the guard pattern.** Add one stub module with one `tool.call` Bash hook in the exact Global Constraints form, with a top-level helper in the same file. Run `claude plugin validate $R`. Expected: `Validation passed`. If it is refused, stop and report the exact message; the pattern must be fixed before any port.
- [ ] **Step 2: Write `guard.test.ts`** with an engine stub that counts calls:
  - `a throw before next runs the tool once` (engine count 1, result from the engine).
  - `a throw after next returns the first result and runs the tool once` (count 1).
  - `a throw in the middle of a turn.step stream does not repeat the step` (the stream beneath was pulled once).
  - `three failures turn the module off; two do not` (`health.on` true after 2, false after 3, with `off === 'errors'`).
  - `an off module passes through untouched` (the input reaches the engine unchanged).
  - `a success resets the streak` (fail, fail, ok, fail → still on).
- [ ] **Step 3: Write `core.test.ts`:** `capText` at the cap passes whole, at cap+1 is cut and adds one note; `cutCodePoints('a😀b', 2) === 'a😀'` (never a lone surrogate); `estimateTokens(4001) === 1001`; `redact('https://u:p@h/x')` hides `u:p`; `redact('api_key=sk-abc123def456ghi789')` hides the value; `redact('token: ghp_' + 'x'.repeat(36))` hides it; control characters are removed; text over 80 chars is cut by callers (not by redact).
- [ ] **Step 4:** Run: both files fail.
- [ ] **Step 5:** Implement `core.ts` and `modules/index.ts`. `MeterState` merges into `Shared` (same field names); `showStatus`, `boot` and `applyLimits` in `host.ts` now take `Shared`. Add a test `COMPANY_OFF=rtk turns rtk off with reason env`. `register.tsx` builds `Shared` and calls each module's `register`; existing hooks stay in register.tsx for now (ported in Tasks 8-9).
- [ ] **Step 6:** CHECK, then commit.

### Task 7: Persistence: ledger and health survive reload (F18, F19, F20, F23)

**Files:**
- Create: `$R/hooks/persist.ts`
- Modify: `$R/types/index.d.ts` (new atoms), `$R/hooks/register.tsx`
- Test: `$R/hooks/persist.test.ts`

**Interfaces:**
- Produces: atoms `ledgerAtom = atom({ plugin: 'company', key: 'ledger' }, EMPTY_LEDGER, { shape: 'ledger-1' })` and `healthAtom` (`'health-1'`), declared in `types/index.d.ts` under `PluginState.company`.
- Produces: `export async function restore($: EngineInterface, s: Shared): Promise<void>` (reads the atoms, `$.store` keys `lifetime` and `meter` once; sets `s.economy` from `meter` so economy survives reload), `export async function flush($: EngineInterface, s: Shared, now: number): Promise<void>` (writes atoms when `s.dirty`; writes `$.store` `lifetime` at most every 2,000 ms; the host is the only writer), `export async function finalFlush($, s)` (on `session.end`).
- Produces: the `routes` tally moves into `lifetime.routes` (read once in `restore`, counted in memory). The old `meter`/`routes` keys are read once for migration and not written again under the old names.
- Produces: `register.tsx` calls `restore` on the first hook after `register` runs (`session.start` or any other first event), once.

- [ ] **Step 1: Tests:** `ledger survives a reload` (write, re-run register in the harness with the same state, read back); `economy stays on after reload at 87%` (store `meter.economy=true`, reload, `turn.step` at max effort for an Opus subagent → governed to xhigh); `two parallel spawns count 2 routes` (`Promise.all` of two spawns → `lifetime.routes.haiku === 2`); `a failing store never blocks a spawn`.
- [ ] **Step 2:** Run: fail.
- [ ] **Step 3:** Implement. Delete the old write-only `meter` write at `register.tsx:230-240`.
- [ ] **Step 4:** CHECK, then commit.

### Task 8: Port charter, meter and diet into modules (F4, F6 part, F31)

**Files:**
- Create: `$R/hooks/modules/charter.ts`, `$R/hooks/modules/meter.ts`, `$R/hooks/modules/diet.ts`
- Modify: `$R/hooks/register.tsx` (their hooks leave), `$R/hooks/diet.ts` (pure helpers stay; module globals `reports/reads/greps` removed, counts go to the ledger)
- Test: existing tests unchanged + `$R/hooks/modules/diet.module.test.ts`

**Interfaces:**
- Consumes: `core.ts`, `persist.ts`, `host.ts`.
- Produces: `charter` module: `prompt.compose` adds section `company:charter` (text from Task 15 later; today's CHARTER for now); `added(ctx, chars)` once per compose. `meter`: `session.start`, `session.measure` → `applyLimits`. `diet`: Read and Grep caps now apply to subagents too; the subagent block is added in `agent.spawn` with `capText(ctx, 'subagentPrompt', …)`; `saved(ctx, estimateTokens(fileBytes − returnedChars))` for a capped Read.
- Produces: `dietTotal()` and `governedTotal()` are replaced by ledger reads; `showStatus` reads the ledger.

- [ ] **Step 1: Tests:** `a subagent Read of a 300 KB file is capped at 600 lines`; `a subagent Grep without head_limit gets 200`; `an explicit head_limit 0 is kept`; `a capped read adds saved tokens to the ledger`; `the charter adds its chars to the ledger once per compose`.
- [ ] **Step 2:** Run: fail.
- [ ] **Step 3:** Port. Each hook uses the guard pattern. Remove the inner try/catch around decisions; keep a small try only around bookkeeping after `next`.
- [ ] **Step 4:** CHECK (all old tests still pass unchanged), then sync R → M (`rsync -a --delete --exclude .claude-plugin/types $R/ $M/`) and confirm at the next turn that the reload notice shows no hook failure.
- [ ] **Step 5:** Commit.

### Task 9: Port router + crew and governor (F5, F6, F34, devices, Review Focus 4)

**Files:**
- Create: `$R/hooks/modules/router.ts` (crew registration, `agent.spawn` routing, `tool.call` Agent run closing), `$R/hooks/modules/governor.ts` (`turn.step`)
- Modify: `$R/hooks/register.tsx` (only the host loop remains), `$R/hooks/router.ts` (remove `suggestedAgent`), `$R/hooks/governor.ts` (rule `opus low -> medium` applies only when `e.agentId` is set; `governedByRule` folds into the ledger)
- Test: `$R/hooks/modules/router.module.test.ts`, `$R/hooks/modules/governor.module.test.ts`

**Interfaces:**
- Consumes: `Shared.efforts`, `Shared.runs`, `Shared.runByTool`, `Shared.economy` (sync reads only in `turn.step`).
- Produces: `export function offMachineWithDevice(s: Shared): boolean`. Router and crew set `setOff(ctx, 'device attached')` when it is true at `session.start` or `session.attach` (detect an attached device through `$.session.surfaces()` / the attach event's fields; the implementer reads `session.attach` in the types).

- [ ] **Step 1: Tests:** `main loop Opus low stays low`; `subagent Opus low goes to medium`; `a bookkeeping throw after a Fable reroute keeps the reroute` (stub `showStatus` path throws → the step still reaches the engine as `opus`/`max`); `a routeSpawn throw still adds the diet block`; `a background run closes on its completion and shows ended at session end` (Review Focus 4); `with a device attached off-machine, spawns are not rerouted`.
- [ ] **Step 2:** Run: fail.
- [ ] **Step 3:** Port with the guard pattern; decisions and bookkeeping in separate tries.
- [ ] **Step 4:** CHECK; then the exact strings in old tests are still unchanged; commit.

## Phase C: new modules

### Task 10: bashcap and V11 (F4, F14)

**Files:**
- Create: `$R/hooks/modules/bashcap.ts`, `$R/hooks/bashcut.ts` (pure)
- Test: `$R/hooks/bashcut.test.ts`, `$R/hooks/modules/bashcap.module.test.ts`
- Create: `claude-company-mods/measure/VERIFY.md` (V11 row)

**Interfaces:**
- Produces (`bashcut.ts`): `export function cutOutput(text: string, o: { over: number; head: number; tail: number; keepLines: number }): { text: string; cut: boolean; originalChars: number; keptChars: number }`; the middle marker is `\n[company: <n> KB cut. Full output: <path or "not saved">]\n`, followed by up to `keepLines` matching error lines, then the tail.
- Produces (module): `tool.call` Bash, after `next`: when the output is over the threshold, write the full text with `$.fs.write` to `<scratchpad>/company-out/<tool_use_id>.txt` (the scratchpad path from the engine type `scratchpadDir`), replace the output, `saved(ctx, estimateTokens(original − kept))`, card text for Task 16. On `session.end`: delete `company-out/`. Its order against rtk does not matter: rtk changes the input, bashcap changes the output.

- [ ] **Step 1: V11 first.** In a `claude -p` run in the fixture, run `python3 -c "print('x'*100000)"` and measure the tool_result length in the jsonl. Write the number in `VERIFY.md`. Set the threshold by the Global Constraints rule.
- [ ] **Step 2: Tests:** golden: 40 KB with an `Error: boom` line in the middle → output contains the head, the tail, `Error: boom` and the marker; 30,001 chars just over the threshold → head and tail do not overlap; a surrogate pair at the cut point stays whole; economy halves the limits; a failed `$.fs.write` gives `not saved` and no path; an output under the threshold passes unchanged.
- [ ] **Step 3:** Run: fail. **Step 4:** Implement. **Step 5:** CHECK, then commit.

### Task 11: nudge and audit

**Files:**
- Create: `$R/hooks/modules/nudge.ts`, `$R/hooks/modules/audit.ts`
- Test: `$R/hooks/modules/nudge.module.test.ts`, `$R/hooks/modules/audit.module.test.ts`

**Interfaces:**
- Produces: `nudge`: on `turn.complete` (main loop only) reads the context use and window (the implementer finds the fields in `TurnCompleteInput` or `session.measure`); toast `Context is 61 % full. Type /compact to make it smaller.` once per crossing of 60%; re-arms below 50% or after `session.compact`; skips when the window is 0 or missing.
- Produces: `audit`: `prompt.compose` reads `result.sections` (no change) and `tool.describe` reads tool description sizes; keeps `top5: { id: string; chars: number }[]` in `Shared` for `/company`.

- [ ] **Step 1: Tests:** nudge fires at 61%, not again at 65%, again after a drop to 40% and a rise to 62%; window 0 → no toast; a subagent turn → no toast. Audit: the sections pass through byte-identical; top5 is sorted by size.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. **Step 4:** CHECK, then commit.

### Task 12: rtk module (F9, F10, F27, F36, Review Focus 1)

**Files:**
- Create: `$R/hooks/modules/rtk.ts`, `$R/hooks/rtkrules.ts` (pure)
- Test: `$R/hooks/rtkrules.test.ts`, `$R/hooks/modules/rtk.module.test.ts`

**Interfaces:**
- Produces (`rtkrules.ts`): `export function shouldTry(cmd: string): boolean` (the skip rules), `export function acceptRewrite(original: string, stdout: string, exitCode: number): string | null` (exit 3, trimmed non-empty, reversible: removing every `rtk ` token at the start or after `&& `, `|| `, `; `, `| ` gives the original exactly), `export const LIGHT: readonly RegExp[]` (git, ls, tree, find, wc, `docker (ps|images)`, `kubectl get`, test runners pytest/jest/vitest/cargo test/go test/phpunit/pest), `export function inMode(rewritten: string, mode: 'light' | 'full'): boolean`.
- Produces (module): at `session.start` probe `rtk --version` (also `rtk.exe` on Windows) once → `setOff(ctx, 'not installed')` when missing. `tool.call` Bash before `next`: skip when the call targets a device; `shouldTry`; `$.process.run(['rtk', 'rewrite', cmd], { timeoutMs: 2000 })`; `acceptRewrite`; `inMode`; then `$.tool.check` on both the original and the rewritten input; rewrite only when both are allowed with no prompt; else count `skippedPermission`. After `next`: once per turn read `rtk gain -f json -p` and add the delta to `saved`. Mode from env `COMPANY_RTK_MODE` (default `light` until Task 18 sets it). One notice when the repo has project-local rtk filters (the implementer reads `rtk trust --help` for the file name).

- [ ] **Step 1: Table tests (`rtkrules.test.ts`):** `git status` → `rtk git status` accepted; `cd x && git log -5` → accepted; `git diff | head -50` accepted only when the pipe and `head -50` are unchanged; `git log > out.txt` accepted only when ` > out.txt` is unchanged; a heredoc → `shouldTry` false; `rtk git status` → false; a 2,001-char command → false; stdout empty → null; exit 1 → null; exit 0 → null; a rewrite that changes quoting → null; `-rf` style leading dash: reversible check still holds.
- [ ] **Step 2: Module tests:** a deny rule on the original → no rewrite; an allowed original with an ask on the rewritten → no rewrite and `skippedPermission` 1; the binary missing → off `not installed`, commands untouched; a rewritten `false` still returns a non-zero exit (stub engine); a 2,000 ms timeout → original command, one failure counted.
- [ ] **Step 3:** Run: fail. **Step 4:** Implement. **Step 5:** CHECK, then commit.

### Task 13: graph module (F11, F12, F26, Review Focus 2 and 3)

**Files:**
- Create: `$R/hooks/modules/graph.ts`, `$R/hooks/graphlock.ts` (pure)
- Test: `$R/hooks/graphlock.test.ts`, `$R/hooks/modules/graph.module.test.ts`

**Interfaces:**
- Produces (`graphlock.ts`): `export function lockState(lock: { pid: number; at: number } | null, now: number, pidAlive: boolean): 'free' | 'held' | 'stale'` (stale when older than 900,000 ms or the pid is dead), `export function excludeWithLine(text: string, line: string): string | null` (null when the line exists; keeps the user's lines and the trailing newline).
- Produces (module): `session.start`: `git rev-parse --show-toplevel` (skip when not a repo); refuse when `graphify-out` is a symlink or tracked (`git ls-files graphify-out`); probe `graphify --version`; add `graphify-out/` to the path from `git rev-parse --git-path info/exclude` (refuse a symlink); start the first build detached (`void`, never awaited). `turn.complete`: when this turn had Write/Edit/NotebookEdit or Bash, run `graphify update <root>` detached under the lock; a request during a run sets dirty → one more run after. Env: `GRAPHIFY_BACKEND=none` plus every name printed by `python3 -c "from graphify.llm import backend_detection_env_vars as f; print(*f())"` set to `''` (hard-code that list). The "fewer nodes" refusal (exit non-zero with `--force` in stderr) is logged as `kept`, not a failure. `/company` shows disk use of `graphify-out/` (`du`-style sum through `$.fs`).
- Produces: `export function graphHint(hasGraph: boolean): string` (≤ 320 chars, the spec §7.2 text) for Task 15.

- [ ] **Step 1: Tests:** lock free/held/stale cases (Review Focus 3); `excludeWithLine` adds once, keeps lines, keeps the newline, returns null on a second call; a symlinked `graphify-out` → refused with a notice; a tracked `graphify-out` → refused; an existing graph with "fewer nodes" refusal → `kept`, no failure (Review Focus 2); two turn ends during a run → exactly 2 runs total; the env passed to `$.process.run` has `GRAPHIFY_BACKEND: 'none'` and `ANTHROPIC_API_KEY: ''`; not a git repo → module off, no run.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. **Step 4:** CHECK, then commit.

### Task 14: install module (F13)

**Files:**
- Create: `$R/hooks/modules/install.ts`, `$R/hooks/pins.ts`
- Test: `$R/hooks/modules/install.module.test.ts`

**Interfaces:**
- Produces (`pins.ts`): `export const RTK = { version: 'v1.2.1', assets: Record<string, { name: string; sha256: string }> }` keyed by `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64` (copy names and hashes from the release's `checksums.txt`; omit a platform the release lacks), `export const GRAPHIFY = 'graphifyy==0.9.120'`.
- Produces (module): `/company install` shows each command, then runs: rtk: download the pinned asset with `$.http.fetch`, check SHA-256, unpack to `~/.local/bin` (Windows: `%USERPROFILE%\.local\bin`); graphify: `uv tool install graphifyy==0.9.120`, else `pipx install …`, else `python3 -m pip install --user …` (Python ≥ 3.11), else print the steps. Verify with `rtk gain` exit 0 (it is rtk-ai's) and `graphify --version`. In an off-machine session: answer "Install is off in cloud sessions." and do nothing. The session-start notice "rtk is not installed. Type /company install." appears once per machine (a `$.store` flag), never in cloud.

- [ ] **Step 1: Tests:** a hash mismatch → nothing written, a clear error; cloud → no process runs; uv missing → pipx tried; all missing → steps printed; the notice shows once.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. **Step 4:** CHECK, then commit.

### Task 15: Charter rewrite and the savers block (F21, spec §7.3)

**Files:**
- Modify: `$R/hooks/charter.ts`, `$R/hooks/directives.ts`, `$R/hooks/modules/charter.ts`, `$R/hooks/modules/diet.ts`
- Test: `$R/hooks/charter.test.ts`, `$R/hooks/directives.test.ts`

**Interfaces:**
- Produces: `export const CHARTER_CORE: string` (the 21 rules, the "when to run" part, delegation, precedence; reworded only, no rule dropped); `export const SAVERS: Record<'ponytail'|'headroom'|'caveman'|'i-have-adhd'|'rtk'|'graphify', string>` (compact one-liners; all six together ≤ 1,200 chars); `export function charterText(missing: readonly string[], rtkOn: boolean, hasGraph: boolean): string` (CHARTER_CORE + the lines for missing plugins + rtk line if on + graph hint if a graph exists; ≤ 4,800 chars); `export function dietText(missing, rtkOn, hasGraph): string` (report rule + the same lines; ≤ 2,000 chars).
- Produces: `directiveState` covers 6 items: the 4 plugins and 2 binaries.
- Consumes: `graphHint` (Task 13); the binary probes (Tasks 12, 13).

- [ ] **Step 1: Tests:** with all four plugins on → no plugin saver lines in the charter; with caveman missing → only the caveman line; length ≤ 4,800 in the worst case (all missing, rtk on, graph on); the text is computed once per session (two composes → identical bytes even after a plugin change mid-session); every one of rules 1-21 is still present (match `/\b1\. /` … `/\b21\. /`).
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. **Step 4:** CHECK, then commit.

## Phase D: the dashboard

### Task 16: Dashboard in ASD-STE100 (F3, F22, F25, Review Focus 5)

**Files:**
- Modify: `$R/hooks/panel.tsx`, `$R/types/index.d.ts` (Panel gets `modules: ModuleView[]`, shape `'panel-3'`)
- Create: `$R/hooks/modules/dashboard.tsx`, `$R/hooks/ste.ts`
- Test: `$R/hooks/panel.test.tsx` (structure asserts), `$R/hooks/ste.test.ts`

**Interfaces:**
- Produces (`ste.ts`): `export function steProblems(text: string): string[]` (sentences over 20 words, banned words, `-ing` words not in `STE_NAMES`), `export function formatTokens(n: number): string` (Review Focus 5 values).
- Produces: `export type ModuleView = { id: ModuleId; title: string; what: string; on: boolean; off?: OffReason; fails: number; lastErr?: string; numbers: string[]; last?: string; added: number; saved: number }`.
- Produces: renderers sharing one view model: `band(p)` for `AbovePrompt` (bubbles: parts working, 5 h %, net tokens "(estimate)", graph state; a broken part shows `● RTK: off (3 errors)`), `PanelView` (one box per module + SELF-CHECK box: parts working, errors this session, slowest job, added vs saved, last error), `card(e)` for `ToolUse` when a module changed that call (rtk and bashcap texts from spec §8), `panelText` for `/company` and notices. ✓ shows only when `fails === 0`. Every note goes through `redact`. `/company on <id>` and `/company graph` subcommands.

- [ ] **Step 1: Tests:** `steProblems` on every UI string the renderers can produce (a fixture Panel with every module in every state) → `[]`; a module with 3 fails shows off and red in band and pane; ✓ never shows for a failed module; band at 1,234,567 → `1.2 M`; net negative shows `−`; a secret in a note (`postgres://u:p@h`) never reaches text; `/company on rtk` turns it on.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. Update the old exact-string asserts (`wiring.test.ts:76,245,320`, `panel.test.tsx:93-98`, `charter.test.ts:27`) to structure asserts in this one commit.
- [ ] **Step 4:** CHECK; sync R → M; in this session run `/company` and capture the text; in a terminal run `tmux new -d 'claude'`, `tmux capture-pane -p` after start, and save the capture (V10).
- [ ] **Step 5:** Commit.

## Phase E: proof and ship

### Task 17: Verification V1-V10 (spec §11)

**Files:**
- Modify: `claude-company-mods/measure/VERIFY.md`

- [ ] **Step 1:** Run each check and write one row each: ID, method, raw evidence (command + output lines or jsonl line numbers), PASS/FAIL. V1 reload keeps the ledger; V2 notices: request input tokens equal with and without a notice; V3 cache_read before and after an effort change; V4 `router.test.ts` gets a 40-prompt labelled table (≤ 1 hard task to Haiku); V5 two parallel `claude -p` sessions → lifetime totals add up; V6 rtk tee folder, telemetry default (off), `--`, exit codes through pipes; V7 `graphify-out` size after 20 updates on this repo; V8 write `measure/verify-windows.ps1` for the client to run (cannot run here) and mark `CLIENT`; V9 live deny rule `Bash(git push:*)` → rewritten push stays denied; V10 tmux capture from Task 16.
- [ ] **Step 2:** Any FAIL goes back to its owning task (rule 14) before Task 18.
- [ ] **Step 3:** Commit.

### Task 18: Benchmark and the improvement loop (spec §10, §10.1)

**Files:**
- Modify: `claude-company-mods/measure/LEDGER.md`, `$R/hooks/modules/rtk.ts` (default mode), `$R/hooks/modules/graph.ts` (default), results under `measure/r3/`

- [ ] **Step 1:** `bash bench3.sh` at n=2 for setups A-F, tasks T1-T6 (+ T1-big for C, E, F), 3 lanes. Score with `score3.py`. Write one LEDGER row.
- [ ] **Step 2:** For every pair the scorer marks `unclear`, add 2 repetitions of only that pair (up to n=6). Score again; one LEDGER row per round.
- [ ] **Step 3:** Apply the decision rules: set `COMPANY_RTK_MODE` default (`full` only if D/F pass rule 1 and 2; else re-run D, F with `light`); set the graph default; turn off by default any new module that loses (the mandatory savers stay on). Each change: re-run only the affected pairs; LEDGER row.
- [ ] **Step 4:** Stop rule: when test runs have used 2 full 5 h windows with no proven saving, stop and report to the client in ASD-STE100 before more runs.
- [ ] **Step 5:** CHECK, then commit (results, LEDGER, defaults).

### Task 19: Package, sync, push, report

**Files:**
- Modify: `$R/.claude-plugin/plugin.json` (`"version": "0.11.0"`, description lists the modules), `$R/README.md`, `claude-company-mods/REPORT.md` (new section, ASD-STE100), `claude-company-mods/PROJECT.md`

- [ ] **Step 1:** CHECK. Then the whole suite once more from a clean copy (`rsync` to a temp dir, run `check.sh` there).
- [ ] **Step 2:** Sync R → M; confirm the reload notice shows no failure; run `/company`.
- [ ] **Step 3:** Package per `plugin-authoring` "Packaging a mod in a chat" into `<scratchpad>/handover12/company.plugin`; unzip it to a temp dir and check `plugin.json` says `0.11.0`.
- [ ] **Step 4:** Write the REPORT section: what each module does, the benchmark table (warm, paired, with n), the VERIFY table, what is not proven, the mistakes on record. ASD-STE100 sentences only (run `steProblems` over it).
- [ ] **Step 5:** Commit and push (retry 4 times with backoff). Send the package and the report to the client.
