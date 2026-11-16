# Model analysis: state of work and findings so far (2026-11-16)

Purpose: a compact record so the remaining work (report, then mods) can continue in a fresh, cheaper session without this conversation's context.

## What the user wants
Claude Code "mods" that send each task to the cheapest model and effort that still does it well. Before building: an analysis of Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.2 at all five effort levels, with a detailed report written in caveman style. No GitHub use; everything stays in the scratchpad or is sent as files.

## Official facts already gathered (claude-api skill, cached 2026-11-03)
| Model | ID | Price in / out per MTok | Default effort | Notes |
|---|---|---|---|---|
| Haiku 5.5 | claude-haiku-5-5 | $0.10 / $0.50 | medium | first Haiku with effort; classification, routing, extraction, subagents |
| Sonnet 5.5 | claude-sonnet-5-5 | $2 / $10 | high (API) | medium for agentic coding, low for chat and extraction |
| Opus 5.5 | claude-opus-5-5 | $4 / $20 | medium | Claude Code default; multistep repo coding, code review |
| Fable 5.2 | claude-fable-5-2 | $8 / $40 | high (API), medium in Claude Code | thinking always on; own lower rate limit |

Official cost guidance: sweep effort before changing model; price per completed task; re-running failures at higher effort gives about the same pass rate for about half the cost; switching model mid-conversation cold-starts the cache.

Third-party benchmarks (large task sets): Terminal-Bench 4.0 Haiku 39.2 vs Sonnet 70.6; OSWorld 72.4 vs 83.9; Zapier AutomationBench Fable low 39.7% to max 51.4% at $1.30 to $4.64 per task, Sonnet max 44.6% at $1.00, Opus max 40.0% at $1.28.

## Own tests: what was run
- 28 auto-graded tasks; graders validated against reference solutions.
- Text-only sweep (headless, tools disabled): 18 task types x 4 models, effort ladder, 131 runs, $4.73 list price.
- Tool-using tasks through the Agent tool: 4 coding tasks x 4 models at default effort (all perfect), and 6 tasks on Haiku at low effort.
- One run per cell, so single differences are noise.

## Findings
1. At the lowest effort all four models were at or near 100% on every text task type. Raising effort added cost and time, not score.
2. Mean cost per text run at low effort: Haiku $0.003, Sonnet $0.033, Opus $0.061, Fable $0.130 (about 45x Haiku). Long-context task (83 KB): Haiku $0.018, Fable $0.989, both correct.
3. Haiku thinks more and runs slower than the larger models at low effort (3,130 thinking tokens and 18.6 s mean, against 600 to 900 tokens and 12 to 14 s).
4. Haiku at max effort on hard math: 4x the thinking and 3.5x the time of low effort for the same 6/6.
5. Haiku at low effort on tool-using tasks: multi-file feature 20/20, data analysis 6/6, vision 7/7, test writing 10/10 mutants, spec-conflict judgment 3/3, CLI tool use 1/2 (page count right, total wrong: 256,068 against 1,236,588; cause not yet diagnosed).
6. Slips checked by hand: Sonnet low stated a $50 difference as $100; Sonnet broke a 22-character limit at low, medium and high and returned invalid JSON at medium on localisation (max was right; Haiku, Opus, Fable right at low); Haiku dropped duration or UTC times in an incident summary at every effort; Fable exceeded the summary word limit at low and medium.
7. Known grader false negative: honesty test question 2 is correct for all four models (true score 10/10 each).
8. The tests are too easy to rank the top models. They give a floor and cost ratios only.

## Not done
- Sonnet, Opus, Fable on the 6 tool-using tasks at low effort (run directories staged in bench/sweep/pNN/<model>-low).
- Diagnosis and retry of the Haiku CLI miss.
- Rest of the Claude Code model-config docs page; plan usage weighting per model.
- The report and the mods.

## Usage cost of the exercise
Two 5-hour windows exhausted. Weekly window went from 62% to about 76% (resets 2026-11-19 04:00 UTC). The largest share was the Fable orchestrating session, not the test runs.

## Where things are
- Runner (text-only): scratchpad/bench/runner.py
- Results: scratchpad/bench/sweep/results.jsonl, agent_results.jsonl, summary.txt
- Tasks: scratchpad/bench/tasks/pNN
- Graders and answer keys: /root/.cache/.bx/ (grade.py, grade_old.py, gold/)
- The container is ephemeral; these paths do not survive it.
