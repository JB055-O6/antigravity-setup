# Company mod 0.11: design

Date: 2026-11-26. Status: draft for client approval.
Inputs: client answers in this session; audit `claude-company-mods/company/grill-report-2026-11-26.md` (F1-F36).

## 1. Intent and why

The client runs Claude everywhere (desktop app, WSL terminal, cloud, web), for all kinds of work: code, devops, management and sales. They are on the Pro plan. They want the Pro limits to last much longer than stock Claude, without worse answers. They want to **see** the gain on screen, in plain ASD-STE100 English. The mod must grow over time: new tools join as modules.

The current mod (0.10.2) works and is tested, but it has **not** shown a saving. The fair numbers from round 2: mod +2% cost (audit F1). 0.11 must turn real savings on and prove them.

## 2. Goals, non-goals, anti-goals

Goals:
1. One plugin, `company`, built as a host plus separate modules. Each module has a token cap, health tracking and its own tests.
2. Hard token savings in code: output caps everywhere (main loop, subagents, Bash), rtk command rewrites, code graph lookups, a compact nudge.
3. The core savers always on, for the main chat and every subagent: ponytail, headroom, caveman, i-have-adhd, rtk and graphify. The mod enforces a compact copy itself when a plugin is missing.
4. A dashboard that shows every module's work and the mod's own health, in ASD-STE100.
5. A fair benchmark that decides which savers stay on and how strict rtk is.

Non-goals:
- No change to the main chat model (client: "keep my pick, mod warns").
- No LLM use by graphify. No `/graphify` skill and no graphify MCP server.
- No silent downloads. No editing of the user's settings files by the mod.

Anti-goals (failure even if it "works"):
- Any claim of savings without fair data.
- A command that runs twice, or a command that bypasses a permission rule.
- A module that costs more tokens than it saves, or that hides an error from the model.
- Changing session prompt bytes mid-session (this breaks the prompt cache).

## 3. Constraints (verified unless marked)

- Engine: one hooks module per plugin (`hooks/hooks.json` → `./register.tsx`), which may import plugin files. A function that receives `$` must be top-level.
- A failed hook is skipped: "the hooks beneath and core run in its place, or its last `next` result stands" (`claude-code/index.d.ts:5292`). `next.called` exists (:5321).
- A `tool.call` hook runs ahead of PreToolUse and the permission check (:19108).
- `$.process.run(argv, {cwd, env, timeoutMs})`: argv, no shell, 30 s default, 10 min max, CLI only. Its `env` adds to the host environment.
- Screen parts: `AbovePrompt` band on terminal, desktop and mobile. `Pane`. `ToolUse` cards. Status line. Toasts. Cloud web sessions have no surface: there, only `/company` text and "company ·" notices.
- rtk 1.2.1: `rtk rewrite "<cmd>"` prints the rewritten command and exits **3**, or exits **1** for no rewrite. `rtk gain -f json` reports its own savings. Telemetry consent is "never asked" (off).
- graphify 0.9.120: `graphify update <path>` is AST-only. Run with `GRAPHIFY_BACKEND=none`: 0 LLM tokens. On this repo: 48 s first build, 22-43 s per update, graph.json 48 MB, GRAPH_REPORT.md 1 MB. `graphify query --budget N` caps answers (roughly).
- Prompt cache: session sections must keep the same bytes for the whole session.

## 4. Approaches

1. **Module host inside one plugin (chosen).** `register.tsx` becomes a host. Modules live in `hooks/modules/`. The host wraps every hook. Gains: one install, shared ledger and dashboard, per-module caps. Cost: a load error stops all modules (mitigation: tests, validate and tsc before every ship).
2. Several plugins (core, rtk, graph). Gain: crash isolation. Lost: the client asked for one plugin; 3 installs per machine; cross-plugin state.
3. The tools' own installers (`rtk init -g`, `graphify claude install`). Gain: least code. Lost: nudge text on every tool call (tokens), no caps, no ledger, per-machine settings edits, and the permission gap stays.

Client picked approach 1 ("one plugin with multiple working modules").

## 5. Decisions the client made

| Topic | Decision |
|---|---|
| Shape | one plugin `company`, many modules |
| rtk | in the token module; strictness decided by the benchmark ("not too strict unless proven") |
| Graph | graphify, code only, LLM off; auto-build in git projects; update automatically as work goes on |
| Graph access | shell commands (`query`, `explain`, `affected`) with a cap; no skill, no MCP (proposed, accepted) |
| Graph files | hidden locally through `.git/info/exclude` |
| Install | ask once: `/company install`, official installers, no silent download |
| Core savers | always on; the mod carries a compact copy and applies it when a plugin is missing |
| Extras | Bash output cap, context audit, compact nudge, graph query cap |
| Main model | keep the client's pick; the mod warns, never changes it |
| Scope | universal: every surface, every kind of work, every stack |
| Benchmark | adaptive: start small, add runs where the answer is unclear; no fixed limit cap ("take as much time as you need, do not limit to one window"); parallel lanes; no mistakes |
| Failure loop | tune, re-test, record every action and result in a ledger, repeat what works, learn from each failure; ship only when confident; stop and discuss honestly if heavy token use brings no success |
| Cloud | no tool installs in cloud (web is a last resort only) |
| Savers copy | compact copy only for a missing plugin (each rule sent once) |
| Reports to the client | simple ASD-STE100 |
| Screen | dashboard of boxes and bubbles, self-monitor, ASD-STE100 text |

## 6. Architecture

```
hooks/register.tsx      host: builds Shared, loads modules in order, wraps hooks
hooks/host.ts           Shared, ctx, wrap(), breaker, caps, ledger, redact(), ste lint helper
hooks/modules/index.ts  static ordered list (no dynamic import)
hooks/modules/*.ts      one file per module (below)
hooks/panel.tsx         view model + renderers (band, pane, card, text)
```

### 6.1 Module contract
Each module exports `{ id, title, what (one STE sentence), caps, register(on, ctx) }`.
- `caps`: per shape, as needed: `section` (chars in system prompt sections, fixed per session), `subagentPrompt` (chars added per spawn), `toolContext` (chars added to a tool result), `perSession` (total tokens added).
- `ctx` gives: `shared` (sync in-memory state), `note(kind, text)`, `count(kind, n)`, `added(shape, chars)`, `saved(kind, tokensEstimate)`, `fail(err)`, `refresh()`. Modules never call `$.ui`, atoms or `$.store` directly. The dashboard module is the one exception for `ui.render`.

### 6.2 Wrapping rules (audit F2, F8, F35)
1. The host wraps each module hook. On a throw it records the failure, then **rethrows**. It never calls `next` again. The engine then keeps the last `next` result or runs core.
2. A generator hook (`turn.step`) is wrapped so that it never retries after its first yield.
3. Inner try/catch blocks are removed when a hook is ported. Bookkeeping after `next` runs in its own small try, so a bookkeeping fault can never undo a decision (F5, F6).
4. Breaker: 3 failures in a row in one session turn the module off for that session. A timeout counts as a failure. A missing binary means "off: not installed", not a failure. `/company on <id>` turns a module back on. No switch-off carries into the next session (F28).
5. Caps: before a module's text enters context, the host measures it per shape. Text over the cap is cut at a code-point boundary, and the cut is noted. The charter section is fixed at session start and is never trimmed mid-session.

### 6.3 Shared state and ledger (F7, F18, F19, F20, F23)
- `Shared` lives in memory: efforts, runs, economy, health per module, ledger.
- Mirror: debounced writes (2 s) to `$.state` (survives reload) and `$.store` (lifetime totals). One writer: the host. On register, the host loads both once. `turn.step` reads memory only.
- Ledger entries per module: `added` (tokens the module put into context) and `saved` (tokens kept out of context), both labelled **estimates** (chars ÷ 4).
  - bashcap: saved = (original − kept) ÷ 4.
  - read cap: saved = (file bytes − returned bytes) ÷ 4.
  - rtk: saved from `rtk gain -f json` deltas (rtk's own count), read at most once per turn.
  - grep cap, router, graph: counts only (no honest token figure per call). The benchmark measures their value.
  - charter, diet, hints: added = their chars ÷ 4 × the number of times they were sent.
- The 'meter' store key is read at register, so economy survives a reload (F19).

## 7. Modules

Order matters where two modules hook the same event. Order: charter, meter, router+crew, governor, diet, bashcap, rtk, graph, audit, nudge, install, dashboard. For `tool.call` Bash: rtk rewrites the input first. bashcap cuts the output last.

| Module | Job | Hooks | Caps / budget | Notes |
|---|---|---|---|---|
| charter | Puts the client charter and the core-savers block into the system prompt | prompt.compose | section ≤ 4,800 chars total (today 4,295; rewording must fit the savers block) | bytes fixed per session |
| meter | Reads the 5 h and week limits; economy mode | session.start, session.measure | 0 | reads 'meter' on register |
| router + crew | Sends each subagent to the cheapest fitting model; the 5 crew types | session.start, agent.spawn, tool.call Agent | crew text as today | one CREW source (F31) |
| governor | Fixes wasteful effort per step | turn.step | 0 | **my call:** never raises effort on the main loop. "Opus low → medium" applies to subagents only, until the benchmark shows it pays (F34) |
| diet | Read cap, Grep cap, the subagent report rule | tool.call Read/Grep, agent.spawn | subagentPrompt ≤ 900 chars | caps now apply to subagents too (F4) |
| bashcap | Cuts huge Bash output | tool.call Bash (after next) | output > 30 KB → keep 12 KB head + 12 KB tail; economy: 15 KB → 6 + 6 | full output saved under the session scratchpad by `tool_use_id`, deleted at session end; "not saved" if the write fails (F14). Error lines in the cut middle are kept: up to 40 lines matching `error|fail|exception|traceback|fatal` |
| rtk | Rewrites Bash commands to their rtk form | tool.call Bash (before next) | 0 added | see 7.1 |
| graph | Builds and updates the code graph; one hint line | session.start, turn.complete, prompt.compose (hint inside charter section, fixed) | hint ≤ 320 chars; graphify command output capped at 6 KB through bashcap | see 7.2 |
| audit | Measures what each system prompt section and tool description costs | prompt.compose (read only), tool.describe (read only) | 0 | shows top 5 in `/company` |
| nudge | Suggests `/compact` | turn.complete | 0 (toast only) | once per crossing of 60% of the context window; re-arms after compaction; skip when the window size is 0 or missing (F28) |
| install | `/company install`: installs rtk and graphify after the user asks | command.run | 0 | pinned versions + SHA-256 for rtk; `graphifyy==0.9.120`; shows each command before it runs (F13). In cloud sessions: no install notice; rtk and graph show "off: not installed" |
| dashboard | Band, pane, cards, `/company` text | ui.render (AbovePrompt, Pane, ToolUse), command.run | 0 | section 8 |

### 7.1 rtk rules (F9, F10, F27)
1. Main loop and subagents. Skip when the command has a newline or `<<`, already starts with `rtk `, or is longer than 2,000 chars.
2. Permission first: call `$.tool.check` on the **original** command. Rewrite only when it is allowed without a prompt. On deny or ask, pass the original unchanged.
3. Accept the rewrite only on exit 3 with non-empty stdout, and only if removing every `rtk ` token (at the start or after `&& `, `|| `, `; `, `| `) gives back the original command exactly. Timeout 2 s. Anything else: the original command.
4. Two modes. `light`: git, ls, tree, find, wc, docker/kubectl list commands, test runners. `full`: every rule `rtk rewrite` knows (including cat → `rtk read` and grep). The default mode is set by the benchmark (section 10).
5. Never run `rtk trust`. If the repo has project-local rtk filters, post one notice.
6. Exit codes must survive: a rewritten `false` must still exit non-zero (test).

### 7.2 graph rules (F11, F12, F26)
1. Only inside a git work tree (`git rev-parse --show-toplevel`). Skip with no code files.
2. First build: detached at session start, never awaited. Updates: at `turn.complete`, only when a Write/Edit/NotebookEdit or Bash touched files this turn. One run at a time per repo: a pid lock file under the graph folder, valid 15 min. A request during a run sets a dirty flag, and one more run follows.
3. Command: `graphify update <root>` with env `GRAPHIFY_BACKEND=none` and the API key variables set to empty. Timeout 10 min. On failure the old graph stays.
4. Exclude: path from `git rev-parse --git-path info/exclude`. Read it first, add `graphify-out/` once, keep the user's lines, refuse when the path is a symlink. Refuse to build when `graphify-out` is a symlink or is tracked by git.
5. Hint (only when graph.json exists): "Code graph: run `graphify query "<question>" --budget 1500` or `graphify explain "<name>"` before a broad search. Never read graphify-out files whole." This goes into the charter section at session start (fixed bytes). Subagents get the same line in the diet block.

### 7.3 Core savers block (always on)
A compact copy (≤ 1,200 chars for all six) in the charter section and the diet block. Each rule goes in **only when its plugin is missing** (client Q4), so no rule is sent twice. The rtk line goes in only when rtk is installed; the graph line only when a graph exists. The set is fixed at session start (cache):
- ponytail: smallest complete change; reuse; never cut validation, security or the needed test.
- headroom: measure big files first; read only needed ranges; compute with code.
- caveman: short plain words between models; code, paths, numbers and errors stay exact.
- i-have-adhd: client replies lead with the result, numbered steps, one next action.
- rtk: commands are compacted automatically; use `rtk bypass <cmd>` (rtk's own command) only when the full raw output is needed.
- graphify: the hint in 7.2.
The plugin check lists 4 plugins + 2 binaries ("6 of 6 on").

## 8. Dashboard (ASD-STE100)

Text rules: approved simple words; one idea per sentence; at most 20 words per sentence; active voice; present tense; numbers with units; no idioms. Technical names (RTK, graph, Haiku) are allowed. A lint test checks every UI string: sentence length, and a banned list (utilize, leverage, via, e.g., i.e., etc., robust, seamless, "-ing" words outside names).

1. **Band** (always, above the prompt): `● Company: 9 of 9 parts work   ● 5 h: 42 % used   ● Saved: 31,200 tokens (estimate)   ● Graph: ready`. A broken part turns its bubble red: `● RTK: off (3 errors)`.
2. **Pane** (opens by itself on desktop; `/company` opens it anywhere): one box per module, plus a SELF-CHECK box. Each box has: name, ON / OFF light, one STE sentence about the module's job, 2-3 numbers, its last action, tokens added and saved. SELF-CHECK: parts working, errors this session, slowest job, tokens added vs saved, last error in plain words.
3. **Card** under a tool row when a module changed that call: `RTK: this output is 33 % shorter (1,701 → 1,138 bytes).` `Output cap: Claude sees 24 KB of 410 KB. The full output is in <path>.`
4. **`/company` text** and "company ·" notices: the same content, for places with no screen part. Notices pass through `redact()` (F25).
Panel data gets a `modules[]` list. The shape tag changes to 'panel-3'.

## 9. Security rules
- argv only, no shell strings, for every process. Every process has a timeout.
- Permission check on the original command (7.1). Never widen permissions.
- `redact()` before any note, card or notice: URL `user:pass@`, `key|token|secret|password=` values, long high-entropy runs, control characters; 80-char cut.
- Saved outputs only under the session scratchpad. They are deleted at session end.
- graphify env scrub; no LLM backend; symlink and tracked-folder refusals.
- Installers: pinned versions and hashes in source; run only after `/company install`.

## 10. Benchmark v3 (F1, F15, F29)
- Fixture: a committed multi-file repo (about 60 files: a small web app in Python + JS with tests, a Dockerfile, a git history of 30 commits, and a 5 MB log), plus a generator script. Hashes are checked so no task can edit the tests.
- Tasks (universal): T1 explore: "where and how is X done" across files. T2 bug fix with tests. T3 small feature in 2 files plus a test. T4 log triage: find the root error in the 5 MB log. T5 git: summarize the last 10 commits and the current diff. T6 subagent research: a lookup the router sends to a scout.
- Setups: A stock (company off) · B mod 0.10.2 · C 0.11, rtk and graph off · D 0.11 + rtk (full) · E 0.11 + graph · F 0.11 + both. (C is added so the new caps can be told apart from rtk and graph; see Q2.)
- Method: one discarded warm-up run per setup; the setup order rotates per repetition; adaptive n: start at n=2 for every setup and task, then add runs (up to n=6) only for pairs whose difference is inside the noise; up to 3 parallel lanes, each with its own work copy, so runs never share files; the meter pauses all lanes at 85% of the 5 h window and resumes after the reset; the allowed tools match each setup's command forms; failed runs are excluded from cost means and reported as fails; the report shows cost, input tokens by cache class, output tokens, pass/fail, and whether each module acted (from the jsonl).
- Decision rules: a module or mode stays on by default only if (1) it fails no task that stock passes, and (2) its paired mean cost is lower than C's by at least 5%, lower in at least 3 of 4 pairs (or 2 of 2 at n=2). If rtk full fails rule 1, re-run D and F with rtk light. If the graph fails rule 2 on T1, the graph stays on for repos over a size the data names, or turns off by default.
- Metrics also logged per real session (ledger): 5 h % used per hour of work.

### 10.1 Improvement loop and experiment ledger (client Q2)
- File: `claude-company-mods/measure/LEDGER.md`, one row per attempt: date, what changed, setups, runs, cost and tokens, pass/fail, verdict (keep / drop / tune), next action.
- Loop: run → read the numbers → keep what wins → find the cause of each loss → change one thing → run again. A change that wins is kept in later attempts. A change that loses is written down with its cause, so it is not tried again.
- Ship 0.11 only when the decision rules hold for every module that is on by default, and the full test suite and V1-V11 pass.
- Stop rule: if 2 full 5 h windows of test runs bring no proven saving, stop and report to the client honestly before more runs.
- All reports to the client use simple ASD-STE100 text.

## 11. Verification list (must pass before ship)
| ID | Check | How |
|---|---|---|
| V1 | `$.state` survives a reload | live: reload, then read a counter |
| V2 | notices cost 0 tokens | `-p` stream: compare request input tokens with and without a notice |
| V3 | an effort change keeps the prompt cache | benchmark jsonl: cache_read before and after |
| V4 | router misroutes | 40 labelled prompts table test; a hard task to Haiku counts as a miss; target ≤ 1 miss |
| V5 | two sessions at once | two `-p` sessions write ledger totals; no lost count |
| V6 | rtk internals | tee folder, telemetry default, `--`, exit codes through pipes |
| V7 | graphify disk use | cache size after 20 updates on this repo |
| V8 | Windows native | a script the client runs on Windows (pwsh download is blocked here) |
| V9 | `$.tool.check` with a deny rule | live test: rewritten `git push` stays denied |
| V10 | band draws in the terminal | run `claude` in tmux here; capture the pane |

## 12. Migration (the mod works after every step; tests, tsc and validate pass at each)
S0 benchmark harness v3 + fixture; 6 gap tests (F30); CI job (F17).
S1 move `st`, `note`, `showStatus`, CREW into `host.ts`; no behaviour change.
S2 loader + wrap + breaker + ledger; port charter and diet; host tests (throw before/after `next`, mid-stream, 3 failures).
S3 meter; S4 router+crew, then governor.
S5 bashcap (+ subagent caps), nudge, audit, then rtk, then graph, then install.
S6 dashboard and STE text; exact-string tests updated last, in one commit.
S7 V1-V10; benchmark; set rtk mode and graph default from data; package 0.11.0; push; caveman report.

## 13. Testing
Host: throw before `next`, after `next`, mid-generator → the engine fake sees exactly one call. Breaker at N−1 and N. Caps exactly at the limit and at limit+1. Ledger: no double count when the read cap and rtk act on the same output. rtk table: pipes, `&&`, quotes, env prefix, heredoc, already rtk, missing binary, exit codes. bashcap golden tests: error lines survive, surrogate pairs, no overlap just above 30 KB. graph: lock, dirty flag, exclude file cases, symlink refusal. nudge hysteresis. STE lint on every UI string. CI on every push.

## 14. Left to the builder
File names inside `modules/`; exact debounce timing; the exact `$.state` keys; the redact regexes; the fixture app's content; the platform detection API; how the pane lays out boxes on narrow screens.

## 15. Builder check: answers and calls

Answered by the client earlier:
- **Savers copy:** first answer was "always, plugin or not"; with the duplicate-cost fact the client changed it to "copy only when the plugin is missing" (Q4). Sizes: the savers block replaces the charter's directives section (1,297 chars), so the charter stays ≤ 4,800 chars (about 4,518). Subagent prompt cap: 2,000 chars (report rule + savers block + graph hint).

Manager calls (correct any):
- **rtk permissions (verified):** a `tool.call` change reaches core's permission check (`index.d.ts:5301`). Rule: rewrite only when **both** the original and the rewritten command pass `$.tool.check` with no prompt. No `tool.check` hook, so no new permission surface. `/company` counts the rewrites skipped for permission reasons. rtk's output-only `rtk pipe` mode is **not** used: verified lossy (`git log -10 | rtk pipe -f git-log` kept 1 of 10 commits).
- **Devices (verified, `index.d.ts:5308-5312`):** in an off-machine session (cloud, SSH, VM), a call to the person's devices is refused once a hook changed it, and so is a call by an agent a mod spawned, retyped or registered. Rule: rtk never touches a call that targets a device. When a device is attached to an off-machine session, the router and crew step aside for that session. Correctness comes before savings.
- **Graph size:** auto-build in every git repo (client choice), with no size limit. `/company` shows its disk use. The benchmark adds task T1-big on a frozen copy of this repo (787 code files) for setups C, E and F.
- **Band numbers:** show **net** tokens (saved − added), labelled "estimate", negative when negative. Before fair data exists, the band says "Net: −1,200 tokens (estimate)" when that is the truth.
- **Benchmark details:** pairs per task, not summed. Main model Opus medium, as in rounds 1-2. Runs use the client's account from this cloud session.
- **Install scope:** Linux x86_64/arm64, macOS, Windows x86_64 where rtk ships an asset. The rtk SHA-256 values are copied from the pinned release's checksums.txt when the mod is built, then fixed in the source (later tampering is caught). graphify: `uv tool`, else `pipx`, else `python3 -m pip install --user graphifyy==0.9.120` (Python ≥ 3.11), else show steps.
- **New check V11:** measure the engine's own Bash output limit live. If the engine already cuts output at about 30k chars, bashcap's threshold moves below it (12 KB) so the cap and the saved full output still act.

Client answers: Q1 test limit: no fixed cap, take the time needed, parallel, no mistakes. Q2 ship rule: section 10.1. Q3 cloud: no installs. Q4 savers copy: only for missing plugins.
