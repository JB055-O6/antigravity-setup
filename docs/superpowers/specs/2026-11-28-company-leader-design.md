# Company 0.11: the leader module — design

Date: 2026-11-28. Status: awaiting client approval. Amends `2026-11-26-company-mod-0.11-design.md` (the base spec). Where they differ, this doc wins.

## 1. Intent and why

Client words (2026-11-28): one leader in `company` that "loads first", holds all 6 savers (rtk, ponytail, headroom, caveman, i-have-adhd, graphify) "at the top of everything", makes the main loop, every module and every subagent follow them, "has hooks for and on everything so nothing goes or works away from its eyes", and ends the "copied ledger bloat" so modules keep room for their own working lines. Savers at max level ("ponytail on ultra"). Tokens conserved.

Standing goal (verbatim in `claude-company-mods/CHARTER.md`): max of everything at once — cost min, tokens min, quality max, performance max, better than stock; "not balanced"; "a literal solo master with pupils".

Why: the client wants Pro limits to last like Max without losing quality, with zero manual loading of the 6 savers.

## 2. Goals, non-goals, anti-goals

Goals
1. One instruction set, one place (the leader). One copy per context: one in the main prompt, one per subagent. Never two copies in one context.
2. All 6 savers active at their max level wherever `company` runs.
3. The leader sees every message the engine injects (main and each subagent) and every module's health, cost and saving.
4. Modules contribute short working lines through the leader, not their own prompt sections.
5. Each saver and module proves a net gain (benchmark) or is fixed or cut.

Non-goals
- Plain claude.ai chat (web, desktop chat, mobile chat): no plugin support exists there.
- Changing a session where `company` is not loaded.
- Trimming the engine's skill list or agent list now (shown on the dashboard only; see §9).

Anti-goals (failure even if it "works")
- A saver's rules lost from a context (a drop without the leader's copy in place).
- Prompt cache broken mid-session by changing bytes (leader text and every rewrite are fixed per session).
- More tokens spent than saved with no quality gain.
- Any security rule from the base spec §9 weakened.

## 3. Constraints (verified 2026-11-28 unless marked)

1. Spike (live, `claude -p`, 2 runs per mode):
   - ponytail and i-have-adhd print plain stdout at SessionStart → attachment type `hook_success`, origin `{kind:'hook', event:'SessionStart'}`. `classic.SessionStart` does NOT see this text (it sees only JSON `additionalContext`, e.g. superpowers).
   - ponytail's SubagentStart text arrives as `hook_additional_context`, origin `{kind:'hook', event:'SubagentStart'}`, with `agentId`.
   - `prompt.attachment` sees every injected message for main and each subagent (`type`, `origin`, `agentId`, `text`) and can rewrite it (`{text}`) or drop it (`{text:null}`).
   - Proof by tokens: dropping ponytail + ADHD in main: cache_create 18,575 → 15,222 (−3,353); subagent drop of ponytail: 10,722 → 9,779 (−943).
   - Seen per request: `skill_listing` 23,495 chars (main AND each subagent), `agent_listing_delta` 10,249, superpowers 3,443, `environment` 2,383, `deferred_tools_delta` ~2,000.
2. Plugin facts: ponytail 5.3.3 hooks SessionStart + SubagentStart + UserPromptSubmit; levels lite/full/ultra (ultra = full + "question the request: push back on any part the need does not justify"). i-have-adhd 0.4.1: SessionStart only, injects only when `$CLAUDE_CONFIG_DIR/.i-have-adhd-always` exists; no levels. caveman and headroom: skill-only, no levels; SKILL.md bodies 2,107 B and 1,307 B; headroom body names `${CLAUDE_SKILL_DIR}`. All four MIT licensed.
3. Engine rules from the base spec stay: validator rules, guard pattern, `beneath`, breaker, `{}` matcher on shared events, atoms per file.
4. Surfaces where `company` can run: CLI (Linux, WSL, Windows, macOS), desktop app Code tab, IDE extensions, cloud sessions (web, mobile). Mobile works only through cloud sessions or Remote Control. In an open session the built-in `/reload-plugins` is the one command that loads changes.
5. No Fable. No `Bash(rtk:*)`. Commits only on the work branch.

## 4. Approaches

- **A (picked by client): the leader is a module inside `company`.** It owns the prompt section, the subagent block and the attachment hook; other modules hand it lines. Reuses the host, breaker and persistence.
- B: a separate leader plugin loaded before `company`. Rejected: `company` already loads first (prepend tier) and sees all; two plugins need a shared `$` noun contract and two load orders.
- C: keep the charter module, add dedupe only. Rejected: nothing leads or watches all.

## 5. Decisions the client made

1. Approach A; spike first (done, passed).
2. Keep the 4 plugins installed (their extra skills, band, ledger stay); the leader removes their repeated rule text.
3. Full skill text in subagents (not short copies); the benchmark measures the cost.
4. All savers at max level: ponytail ultra; rtk full mode; graph auto in every git project with code; caveman, headroom, i-have-adhd always on.
5. Cloud environment setup script installs pinned rtk 1.2.1 and graphify 0.9.120 (reverses "no installs in cloud").
6. Economy mode on at 75 % (was 5 h 90 % / week 85 %). Its signal: one small icon, not words.
7. Task 14 stays on hold until this doc is approved (its partial work is `claude-company-mods/wip/t14-round1-partial.patch`).

## 6. The leader

### 6.1 Place and order

New module `leader`, first in `MODULE_META` (the host calls `registerLeader` first). It takes over:
- the charter module (its `prompt.compose` section) — `modules/charter.ts` is removed or becomes the leader;
- diet's subagent report block (diet keeps only the Read and Grep caps).

Other modules (graph, rtk, diet, meter, …) never write prompt text. They call `leaderLine(ctx, id, text)` at session start (before the leader composes), each line capped (§6.3). The leader joins them in a fixed order.

### 6.2 The instruction set (built once per session, bytes fixed)

Main prompt section, in this order:
1. Goal line (≤ 200 chars), e.g. "Goal: max quality and max saving at once. Cut waste, never quality. Prove each gain."
2. CHARTER_CORE: the 21 rules, when-to-run, delegation, precedence (reworded only, no rule dropped).
3. Saver texts: ponytail at ultra; caveman; headroom; i-have-adhd.
4. Module lines: rtk line (when rtk on), graph hint (when a graph exists), others.

Subagent block (added to each subagent prompt as diet does today; not for forks, teammates, resumes or workflow agents):
1. Goal line. 2. Report rule (≤ 25 lines, proof only). 3. caveman, headroom, ponytail ultra. 4. rtk line, graph hint. No i-have-adhd (subagents report to the manager, not the client).

Text sources, read once at session start, bounded (≤ 8,000 B per file; bad UTF-8 or too big → bundled copy):
- caveman, headroom, i-have-adhd, ponytail: the installed plugin's SKILL.md body, frontmatter stripped, `${CLAUDE_SKILL_DIR}` replaced by that skill's folder. Plugin path from the engine API only; none → bundled copy.
- ponytail ultra: the SKILL.md body plus a first line stating level ultra (the body's level table already defines ultra).
- Bundled copies live in `hooks/savers.ts` as TS strings (a hooks module cannot import .md); the 4 MIT notices and credits are in `company/savers/NOTICE.md`.

### 6.3 Caps (replace base spec / plan caps)

Measured sizes: CHARTER_CORE ~4,100; caveman 2,115; headroom 1,319 (folder text in); ponytail 3,029; i-have-adhd 6,781 (measured in Task 15a); graph hint ≤ 320; rtk line ~200; goal ≤ 200.
- Main section ≤ 20,000 chars. Net change is small: the ponytail and ADHD copies the plugins inject today (~9,900 chars) are dropped (§6.4).
- Subagent block ≤ 8,000 chars. About 2,900 of it replaces ponytail's own SubagentStart copy.
- Each module line ≤ 320 chars; all module lines together ≤ 1,200.
- Over a cap: swap the longest saver to its bundled compact copy (headroom first, then caveman, then i-have-adhd); never cut mid-text; never drop CHARTER_CORE or the goal line.

### 6.4 Dedupe through `prompt.attachment`

- Hook `prompt.attachment` with `{}` matcher. For an attachment with `origin.kind === 'hook'` whose text starts with a known saver header (today: `PONYTAIL MODE ACTIVE`, `ADHD MODE ACTIVE`, after the engine's `SessionStart:<src> hook success: ` / `SubagentStart hook additional context: ` prefix):
  - drop the repeated rules; keep extra parts that are not rules (ponytail's "Codebase map" block and similar) as the rewritten text; drop the attachment when nothing is left.
- Drop ONLY when the leader's copy of that saver is in place for that context (main section composed this session, or this subagent's block added). Otherwise pass through unchanged (fail-open: the plugin's copy stays).
- Deterministic: the same input text gives the same output, so the prompt cache stays valid.
- Unknown header or changed format → no change (cost only, never a loss).

### 6.5 The monitor ("sees all")

- `prompt.attachment` observer: per type, origin and agent: count, chars, estimated tokens. Kept in Shared (not in any prompt).
- Event coverage: the leader counts every event family the engine offers (session, prompt, tool, turn, agent, skill, plugin, model, classic, ui). Observers only read and pass `next(e)` through; they never throw for expected conditions and never block.
- Module health: the host's existing guard, breaker and ledger. Per module: tokens added, tokens saved, errors, slowest job.
- Net-gain guard: a module whose tokens added exceed tokens saved over the session is marked red on the dashboard ("costs more than it saves"). No auto-off; the benchmark loop decides fixes or cuts.

### 6.6 Max levels

- ponytail: the leader's copy is ultra; ponytail's own "full" text is dropped by §6.4.
- rtk: default mode `full` (all forms with a reviewed flag allowlist; still read-only only).
- graph: auto-build and auto-update in every git project with code (unchanged).
- caveman, headroom, i-have-adhd: always on (no levels exist).

### 6.7 Economy mode

On when the 5 h window or the week window is at ≥ 75 %. Off when both are below 70 % (my call: 5-point gap against flapping). What economy does is unchanged (max → xhigh; Fable max → high).

### 6.8 Everywhere

- Each machine (Windows, WSL, Linux, macOS): the Task 14 setup box, once per machine (rtk, graphify, prependPlugins, ponytail ultra; no rtk rules: per-call check, client 2026-11-28).
- Cloud and mobile: the cloud environment's setup script installs pinned rtk 1.2.1 (SHA-256 checked) and graphify 0.9.120; the client approves the environment change in its own prompt.
- Open sessions: `/reload-plugins` reloads `company`; the leader composes anew (one cache rebuild).

## 7. Dashboard changes (Task 16)

- Band: a small economy icon (one glyph, color only; no "eco on" words), inside the limits bubble. Legend in the pane.
- Pane: a LEADER box first: savers at their level (6 of 6), copies dropped, tokens saved by dedupe; then the module boxes and SELF-CHECK (base spec §8). A "What goes into each request" list from §6.5 (top types by size, main and subagents).
- Use the plugin-authoring UI guidance (band, pane, cards) to keep it clean: few words, icons and color, STE text.

## 8. Effect on the plan

- T14: resume as is after approval (apply the patch, finish fix round 1, review).
- T15 becomes "Leader module" (this doc §6), replacing the T15 text and its 2026-11-28 brief rulings where they differ (caps, active rule, source).
- T16: §7 added.
- T17: new checks: V12 dedupe live proof (tokens drop; no drop when the leader is off); V13 every saver present once in main and once per subagent.
- T18: benchmark arms add leader on/off and full-text subagent cost.
- New task: cloud environment setup script (after T14).

## 9. Suggestions shown, not built (rule 6)

- The skill list (23,495 chars) goes to the main loop and again to each subagent. Trimming it for subagents could save ~6,000 tokens per subagent. Shown on the dashboard now; built only after the benchmark proves it safe and the client agrees.

## 10. Left to the builder

Exact glyphs and colors; header regexes; final cap constants after measuring real texts (within §6.3); how modules register lines (`leaderLine` shape); test layout.

## 11. Risks

1. A plugin update changes its header → dedupe misses → two copies (cost only). Mitigation: the monitor shows duplicates; tests pin today's headers.
2. A false drop → rules lost. Mitigation: drop only with the leader's copy in place, exact headers only, tests for leader-off and unknown headers.
3. Big main section (~4,500 tokens) on every session. Mostly replaces plugin copies already sent; cached after the first request. Benchmark measures.
4. Plugin SKILL.md text is user-installed content placed in the system prompt. Bounded size, frontmatter stripped, no code run.

## 12. Builder check: answers and calls

1. **Who sets a saver's level mid-session?** The leader (client: "always load full", "max level"; my call on the details). The leader text stays ultra all session. ponytail's own notes (`PONYTAIL MODE CHANGED`, `PONYTAIL MODE OFF`, its level line) are dropped by §6.4 while the leader's copy is in place; "stop adhd mode" does not turn the leader's copy off. Setup (T14) also sets ponytail's own default to ultra (`PONYTAIL_DEFAULT_MODE`, `hooks/ponytail-config.js:85`) so ponytail's band and its texts agree. The client turns the leader's savers off only through the pane (module off), never by a chat phrase.
2. **Second copies through skills?** Yes, stopped (my call; Goal 1). A `skill.prompt` hook replaces the SKILL.md body of caveman, headroom, ponytail or i-have-adhd with one line ("<saver> is already active (company leader)") when the leader's copy is in place for that context. Any arguments the client typed with the skill pass through unchanged. Otherwise the skill runs as usual.
3. **Net-gain guard scoring.** (my call) The per-session red flag applies only to modules with a direct token count: bashcap, rtk, diet caps, leader dedupe (and the leader's own net: tokens dropped minus tokens added, shown as it is). Modules whose gain is behaviour (graph, router, governor, the leader's text, the subagent block) show the benchmark verdict from `measure/LEDGER.md` ("proven: −x %", "not yet proven", "costs more: +x %"), never a per-session red.
4. **Economy at 75 % and benchmark fairness.** (my call) The bench keeps its fail-closed rule: all lanes wait at 5 h ≥ 73 % or week ≥ 73 % (`score3.py` `LIMIT`, `WEEK_LIMIT`, and the `bench3.sh` text). No new switch. If the week is already ≥ 73 % when T18 starts, I report it to the client before waiting.
5. **Which cloud environment?** (my call) The one this session runs in, if `get_environment` shows it is personal and editable; it is the client's Default when that is personal (rtk and graphify are universal tools, per the client). The script lives on the environment, not in the repo. Hosts for the rtk download are added exactly as the environment needs; the client approves the change in its own prompt.

Builder calls accepted: build the leader texts at the first compose (a hot reload fires no `session.start`, `register.tsx:76`); check by spike the order of compose and attachment on the first request, when a subagent's `agentId` is known at spawn, and plugin paths from `plugin.register`; the crew prompts and the report rule use one number (≤ 25 lines, from the leader's single rule; crew text points to it instead of its own "15").
