# Spec: effort governor and limit meter (automatic, no commands)

Work folder (scratch copy; work ONLY here): W = /tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/work/company
First refresh it from the live mod: `rm -r W` is NOT allowed; instead copy every file of /root/.claude/dev-mods/5b430f7e-0f7b-55c5-8d67-00dd071d0571/company/hooks/ and .claude-plugin/plugin.json over W's copies (cp), so W matches the live mod 0.2.0 (charter + router, 48 tests).
API reference: P = /tmp/claude-0/bundled-skills/2.1.328/f280d9c908710af4722b2fd3cc25b7ea/plugin-authoring (reference.md, examples/, types/claude-code.d.ts; grep the types, never read them whole). Read the docs of every event and `$` call you use. Existing code: W/hooks/register.tsx, router.ts (read both first). Keep every existing behaviour and test.

## Purpose
Spend fewer tokens per unit of work automatically, and make the person's usage limits last, without lowering quality where it matters. Nothing to type, nothing that blocks work.

## 1. Effort governor (pure logic in W/hooks/governor.ts, wired in the existing turn.step hook)
Evidence (Artificial Analysis index by effort, from the project research): some settings lose to another setting on BOTH score and cost. Never send them:
- Sonnet at xhigh or max -> high
- Opus at low -> medium
- Fable at xhigh -> high (high and xhigh score the same; xhigh uses about 69% more output)
Export `governEffort(model: string, effort: string | number | undefined, economy: boolean): { effort: string | number | undefined; changed: boolean; reason: string }`. Match the model by family name in the id or alias (haiku, sonnet, opus, fable), case-insensitive. Numbers and undefined pass unchanged. In economy mode (section 2) additionally: any model at max -> xhigh, and Fable at max -> high.
Wire it into the existing turn.step hook for EVERY step, main loop and subagents: first the router's remembered subagent effort (existing), then `governEffort` on the resulting model and effort. Only pass `next({ ...e, effort })` when something changed; otherwise `next(e)` untouched. Never change `model` in turn.step. The mapping is deterministic, so every step of a conversation gets the same effort and the prompt cache stays stable. Not a guard: on any error, `next(e)` unchanged.
Count governed steps per rule in a module counter (no state write per step).

## 2. Limit meter (wired in W/hooks/register.tsx)
Read `$.session.usage()` (read its doc and `SessionRateLimit`): the `five_hour` and `seven_day` windows, utilisation 0 to 100, and the session cost. Also listen to `session.measure` (read its doc: it fires after each main-thread turn and when a window moves a whole point) and refresh from it.
- Status line (one line, replacing the current status texts): `company · 5h <n>% · week <n>% · <k> subagents routed · <g> efforts governed` and, in economy mode, prefix `ECONOMY · `. When usage has no windows (API key use), show `company · <k> subagents routed · <g> efforts governed`.
- Economy mode turns on automatically when the five-hour window is at or above 90% or the weekly window at or above 85%, and off again below 85% and 80% respectively (hysteresis). In economy mode: the router sends what would go to Fable (research class, and the `sage` crew agent's steps) to Opus at xhigh instead (do this in turn.step by model rewrite ONLY for subagent steps, never the main loop: a subagent has its own cache), and governEffort runs with economy true. Show a toast once when economy mode turns on and once when it turns off, stating the window and percent.
- Persist best-effort in `$.store` under `meter`: `{ economySince?: epoch ms, lastFiveHour?: n, lastWeek?: n }`; errors ignored.
- Every read is best-effort; any failure leaves the previous values and never blocks.

## 3. Tests (claude-code/testing; see P/examples and the existing W tests)
- governor.test.ts: table tests for every rule, both families spelled as alias and as full id (claude-sonnet-5-5), numbers, undefined, unchanged cases (haiku max outside economy, opus medium, sonnet high), and every economy rule.
- wiring tests (add to W/hooks/wiring.test.ts): a main-loop step on sonnet at max goes down as high; opus low as medium; opus medium untouched; a routed subagent's step gets its routed effort and then the governor; economy on (seed usage at 91% five-hour) makes a sage/fable subagent step go out as opus xhigh and the main loop's model untouched; status text in normal and economy mode; a throwing usage read changes nothing. If the kit cannot raise an event, say which and test the logic as far as possible.

## 4. Acceptance (run each, paste real output)
A. `claude plugin validate W` passes; hooks listed include turn.step and session.measure.
B. `claude plugin test W`: all pass (48 existing + new).
C. tsc clean with /tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/tc/router.tsconfig.json (add the new files to its `files`).

## 5. Rules
Touch only W and that tsconfig. No slash commands, no blocking, no prompts to the person. No silent workarounds: if the API does not allow something, report what the types say and what you did instead. Do not claim anything you did not run. Report: files written, outputs A to C, deviations, unproven points.
