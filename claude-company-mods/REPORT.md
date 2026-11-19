# Company mod report (caveman)

Date: 2026-11-19. Mod: `company` 0.7.0. Commit: `9058b1a`.

## Short answer

- Mod built. Mod tested. Mod packaged.
- Mod cut subagent cost 54% in one live test.
- Not all done. Two test sets still wait.

## What we want

- Good work first. Then fewest tokens.
- Make Pro limits last long.
- No Fable. Fable cost extra money now (you said; me not check).
- Four rules in all things: ponytail, headroom, i-have-adhd, caveman.

## Model facts (from research, 2026-11-16)

Source: `research/Claude 5 model capability and cost.md`. Third-party numbers. Me not check them again today.

Score on Artificial Analysis index, low to max effort:

| Model | low | medium | high | xhigh | max |
|---|---|---|---|---|---|
| Haiku 5.5 | 19 | 25 | 30 | 35 | 36 |
| Sonnet 5.5 | 26 | 31 | 42 | 50 | 55 |
| Opus 5.5 | 35 | 48 | 52 | 57 | 59 |
| Fable 5.2 | 54 | 56 | 62 | 62 | 65 |

Price per million tokens, in / out (`research/model-analysis-handoff.md`): Haiku $0.10 / $0.50. Sonnet $2 / $10. Opus $4 / $20. Fable $8 / $40.

Hard coding test (Vals Terminal-Bench 4.0): Fable 65.15%. Opus 65.15%. Sonnet 64.14%. Haiku 36.36%.

What it mean:

- Easy work: Haiku do it fine. Much cheap.
- Long hard coding: Sonnet tie big ones. Haiku fail.
- Hard review, big builds: Opus.
- Bad settings, lose on score AND cost: Sonnet xhigh and max. Opus low. Fable xhigh.
- Research also say Opus high and max lose, but only to Fable. No Fable now, so Opus high and max stay.

## Our own tests

Source: `research/sweep/summary.txt`, `research/sweep/agent_results.jsonl`.

- 131 text runs. All four models. $4.73 list price. (Research doc say 137: that count add 6 Haiku tool runs.)
- All models score near 100% at low effort. More effort = more time, not more score.
- Cost per text run at low effort: Haiku $0.003. Sonnet $0.033. Opus $0.061. Fable $0.130.
- 13 tool runs. Sonnet low: 6 of 6 pass. Haiku low: 5 of 6 pass. Haiku miss one CLI sum (256,068 vs 1,236,588). Haiku medium redo: pass.
- Weak spot: tests too easy. They not rank top models. They only show floor and cost.

## What mod do

All automatic. No command. No gate. Never block work.

1. **Router.** Each subagent go to cheapest fit model:
   - Lookup, search: Haiku medium.
   - Code: Sonnet medium.
   - Review: Opus max.
   - Design: Opus xhigh.
   - Research: Opus max (was Fable; Fable now cost extra).
2. **Governor.** Fix bad effort on every step:
   - Sonnet xhigh/max → high. Opus low → medium. Fable xhigh → high.
   - Any subagent on Fable → Opus max.
   - Main model never changed (change break prompt cache, cost more).
   - Main model on Fable: one warning. Tell you `/model opus`.
3. **Meter.** Status line show 5-hour % and week %. Economy mode on at 5h ≥ 90% or week ≥ 85%. Off below 85% and 80%. Economy: max → xhigh (Fable max → high).
4. **Diet.** Keep main context small:
   - Subagent report: max 25 lines, proof only.
   - Main Read of text file over 256 KB with no limit: read first 600 lines, add note.
   - Main Grep content with no limit: cap 200 lines.
5. **Four rules.** Charter load in every session. Short rule block go in every subagent. Status show `directives n/4` (which of four plugins on).
6. **Crew.** Five worker types: scout (Haiku medium), builder (Sonnet medium), reviewer (Opus max), architect (Opus xhigh), sage (Opus max).

## Proof

| Claim | Proof | How sure |
|---|---|---|
| Code right | `claude plugin test`: 140 pass, 0 fail | Run today, `measure/checks-2026-11-19.txt` |
| Mod load OK | `claude plugin validate`: pass (warnings: no author, no icon) | Same file |
| Types clean | `tsc` exit 0 | Same file |
| On GitHub | local HEAD = remote | Same file |
| Router work live | Live run: subagent served by Haiku | Live |
| Grep cap work live | Live run: 6,000 matches cut to 200 (`PROJECT.md`) | Live |
| Crew live | `company:scout` etc. show in agent list | Live |
| Saves money | Live test below | Live, small |

Live test, round 1. Main model Opus medium. One run each. Same four plugins on in both. Setup: `measure/run.sh` (task text, `--model opus --effort medium`, old account copy of `company` off in stock). Result: `measure/r1-results.txt` (columns: task, setup, grade, cost $, input tokens summed over all requests, output tokens, requests, models, tools, answer).

| Task | Stock | Mod | Change | Right answer? |
|---|---|---|---|---|
| Subagent lookup | $0.269 | $0.125 | −54% | both yes |
| Line 4500 of big file | $0.085 | $0.088 | +3% | both yes |
| Count lines with "7" | $0.085 | $0.088 | +4% | both yes |

What it mean:

- Router = big win. Subagent go Haiku, cost $0.001 not Opus.
- Mod add about 3,600 input tokens per 2-request task, so about 1,800 per request (charter + crew). Cost about $0.003 on small tasks with no subagent.
- Read cap and Grep cap not fire in these tasks. Opus already read small.

## Not proven (honest)

1. **Effort changes live.** Logs not show effort. Only tests prove.
2. **Read cap live.** Only tests prove.
3. **Sync to all devices.** Proven: account plugins load in cloud sessions (this one did). Not proven: desktop app, terminal on your PC.
4. **Fable billing change.** You said. Me not check.
5. **Real limit cost per model.** Nobody publish it. Me use API price as stand-in.
6. **Big saving number.** Round 1 = 3 tasks, 1 run each. Show direction. Not firm percent.

## Not done yet

1. Live test round 2: code edit task, 2 runs each. Set for 09:05 UTC (5-hour limit was 89%).
2. Six Opus tool runs. Same time.
3. Three Fable runs: dropped. Would cost credits.

## Mistakes on record (rule 19)

All by manager (me). All fixed.

1. Built slash-command gates. You wanted automatic mods. Gates dropped, code archived.
2. `!solo` matched `!soloist`. Fixed: whole word only.
3. First diet live proof used a limit, so proved nothing. Redone with Grep: real proof.
4. New file missed type check once (`directives.ts`). Fixed before ship.
5. Old test expected Fable kept after the no-Fable change. Test fixed.

## Files

- Mod source: `claude-company-mods/company/`
- Charter: `claude-company-mods/CHARTER.md`
- Project log: `claude-company-mods/PROJECT.md`
- Research: `claude-company-mods/research/`
- Live test: `claude-company-mods/measure/`

## Next

Wait 09:05 UTC. Round 2 run. Me add numbers here.
