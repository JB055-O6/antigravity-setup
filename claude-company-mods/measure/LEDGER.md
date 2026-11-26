# Experiment ledger (spec 10.1)

One row for each attempt. Read the numbers from `python3 -I score3.py <r3 dir>`.
Write the verdict: keep, drop or tune. For each loss, write its cause, so nobody tries it again.
Change one thing for each attempt. Keep each change that wins in later attempts.
Stop rule: 2 full 5 h windows with no proven saving, then report to the client.

## Setups

- A0: pure stock Claude Code. All installed plugins are off. `--safe-mode` removes user skills, hooks, CLAUDE.md and MCP servers.
  The builtin plugins stay, because Claude Code ships with them. A0 is the reference row ("vs A0"). No verdict uses it.
- A: the client setup without company. The other plugins (ponytail, caveman, headroom, i-have-adhd, superpowers and more) stay, with their MCP servers.
  A is the baseline for keep and drop: B and C against A, and rule 1 for all setups.
- B: company 0.10.2 (git 785718d). C: 0.11 with rtk and graph off. D: C with rtk. E: C with graph. F: C with rtk and graph.
  D, E and F use C as the cost base.

## Method notes

- E and F start with a graph that run3.sh builds before the session. So they show a later session in a repo, not the first one.
- Economy mode cannot start in the bench. It starts at 5 h 90% or week 85%. The bench waits at 5 h 85% and week 83%.
  This margin keeps a run below the economy line while the run goes on.
- Verdicts use the raw `total_cost_usd`. The normalised cost (norm $) is for display only.
- Risk: B to F and the live session share one company plugin store. Today no setup reads its meter key back.

| date | change | setups | runs | cost $ | tokens in/out | pass/fail | verdict | next action |
|---|---|---|---|---|---|---|---|---|
