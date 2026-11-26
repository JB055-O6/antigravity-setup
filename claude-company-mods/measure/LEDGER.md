# Experiment ledger (spec 10.1)

One row for each attempt. Read the numbers from `python3 -I score3.py <r3 dir>`.
Write the verdict: keep, drop or tune. For each loss, write its cause, so nobody tries it again.
Change one thing for each attempt. Keep each change that wins in later attempts.
Stop rule: 2 full 5 h windows with no proven saving, then report to the client.

| date | change | setups | runs | cost $ | tokens in/out | pass/fail | verdict | next action |
|---|---|---|---|---|---|---|---|---|
