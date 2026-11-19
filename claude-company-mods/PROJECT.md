# Project record: Claude Code mods ("the company")

Live record. Updated at every stage change. Last update: 2026-11-16, stage = Gate 4 (client review), awaiting client agreement.

## 1. Client charter (the 21 rules, as given by the client on 2026-11-16)

Parties: client = the user. Company and manager = the main session. Employees = the Claude models, working as pinned subagents.

1. Client hands over a project.
2. Company takes it up for assessment and analysis.
3. It is read, planned, questioned, re-affirmed, designed, and simulated for expected and imaginable consequences.
4. Consequences and approach are laid bare to the client for discussion.
5. Both sides go back and forth until they mutually agree.
6. Any company suggestion or improvement is raised with the client immediately, before work begins or whenever it occurs. Never held back.
7. The final plan, data, approach, simulated responses and foreseeable outcomes are broken into steps, phases and development cycles, following recognised industry practice.
8. Each phase is broken further into small executable chunks.
9. The planner finalises, then decides how to distribute the workload.
10. Employees are assessed for who suits which chunk best.
11. Each employee gets the chunks in the field where they lead.
12. Each employee works in small steps, one at a time, per the plan.
13. Each completion is reported to the manager, who checks all of it.
14. Anything broken, missing, unwanted or below standard is called out, and the responsible worker redoes it per instructions (with help if needed).
15. If the manager does not understand something, they contact the client directly for direction.
16. The manager oversees all work until it meets the client's need.
17. Every claim by anyone needs real, grounded proof. Nothing is claimed until the proof can be shown.
18. Never lie, cover up or hide anything. Say it directly. No sugar-coating.
19. Whoever makes a mistake is told they will be punished and reprimanded, so nobody slacks. Work is strict, no leniency.
20. Always conclude with proof and tests. Never report back until the whole test suite has run and every worker's job is reported and checked as in rule 16.
21. Keep project updates in real time, including mid-work changes, so nothing is forgotten.

Scope stated by client: every task, always.

## 2. Points raised by the company under rule 6 (awaiting client decision)

- A. Scale by job size. Running all 21 steps on a one-line job costs several times the stock cost and conflicts with the client's "stingiest tokens" demand. Proposal: three tiers. Quick (one bounded step): route, do, check, receipt. Standard (multi-step): short plan, checks, review if risky. Project: the full process with client sign-offs. Rules 13, 14, 15, 17, 18, 20, 21 apply in every tier.
- B. Rule 19. Threats in worker prompts do not improve model output and can make it worse. Proposed enforcement with real effect: failed work is rejected and logged on that model's record, sent back with the defect named, and after repeat failures the model loses that task type in the routing table.
- C. Rule 20 versus rules 4, 5, 6, 15, 21. Company reads rule 20 as "never claim completion without proof". Questions, suggestions and status updates still go to the client at any time.
- D. Manager seat. Opus 5.5 at medium (the stock setting) in a fresh session. Fable becomes a consultant called by trigger, not the manager. Evidence: in this session the main loop was the largest cost.
- E. Persistence. AGREED by client 2026-11-16: install the mods to the client's account so they persist. Install method not yet verified (chunk 1.1).
- F. Client requirement added 2026-11-16: the effort level of every employee is decided before work starts, per task type, and stamped on each chunk at staffing. A worker never chooses its own effort. Pre-set values come from the evidence table; Gatekeeper raises effort on a failed check; Audit revises the pre-sets from the record.
- Point A DECIDED by client 2026-11-16 (replaces the three-tier proposal). Two modes. FULL PROCESS (all 21 rules) when any of these holds: the work is huge; the manager does not understand something; the manager is in a bind. SOLO when the manager can do the task itself with full accuracy and precision. Company reading, stated to client: a solo job still ends with a check and proof before "done" (rules 17, 18, 20); a failed check in solo mode counts as "in a bind" and moves the job to the full process.

## 2a. Client decisions, second round (2026-11-16)

- C CONFIRMED: rule 20 means no completion claim without proof. Questions, suggestions and updates go to the client at any time, and only to the client.
- D DECIDED BY CLIENT (overrides the company's proposal): the top Claude model is the company, the manager and the planner, all three. That is Fable 5.2 (Mythos 5.2 is the same model, restricted to approved organisations).
- Fable cap 25% of the weekly window and ask-before-Fable-max: AGREED. Conflict flagged by the company: a Fable manager on every job cannot fit inside a 25% Fable cap. Company proposal, awaiting client: the cap covers Fable as worker and consultant; the manager seat is metered separately with its own alert; manager effort is medium for running jobs and high for planning and simulation, never xhigh, max only with client consent; Opus is deputy manager when Fable's allowance runs out; the manager delegates all bounded work even on solo jobs.
- B: client asked the company to draft a replacement for rule 19 that fits the charter. Draft, awaiting client approval of the wording: "19. Every mistake has a consequence, for everyone, without exception. The work is rejected and returned to whoever made it, with the defect named, and they fix it before anything else. The mistake is written on their record. A second failure on the same kind of task moves that task to a stronger worker, and the weaker one loses that kind of task until it passes test work again. The manager is held to the same standard: its own mistakes are reported to the client the moment they are found, with cause and fix. No leniency and no unrecorded mistake."
- E CHANGED BY CLIENT: deliver the mods by committing to the client's GitHub and giving a link that opens the commit directly. Client keeps manual control of GitHub (company commits to the session branch only; no pull request, no merge).
- Client works mainly on their local system. Ledger and Board can use the mod's persistent store there.
- Nine remaining test runs and the caveman-style report: ON HOLD by client decision until the mod work here is concluded.
- Fixes for the two weaknesses (proposed, see chat of this date): fail-closed guards with the documented catch-and-deny pattern, crash tests through `claude plugin test`, a second independent gate as a shell-command hook, gate-health display, logged override; checks executed by a shell-command hook from a pre-declared check registry, and matched against real tool results.

## 2b. Client decisions, third round (2026-11-16)

- Rule 19: redrafted wording APPROVED by client. It replaces the original rule 19 in the charter.
- Delivery: client says commit to main, or save locally in a new folder on the D: drive. Company note: this cloud session cannot reach the client's D: drive unless the client shares a folder with it.
- Fable: client gave two alternatives. (1) No Fable limit, on condition the company can say the suite burns limits slower than stock single-model Claude Code. Company answer: cannot say that today; it is unmeasured, and a Fable manager pays twice the Opus token price. (2) Reserve Fable as advisor and consultant, used only for the highest-priority tasks where no other model will do. Company recommends (2) with Opus at medium as day-to-day manager. Awaiting client confirmation of who holds the manager seat.

## 2c. Phase 0 closed (2026-11-16)

- Delivery: commit to `main` of `antigravity-setup`, in its own top-level folder, and give the client the direct commit link. No pull request.
- Seats, as the company reads the client's final directive ("the top model in all three roles has been improved over by the 4-step suggestion; proceed with the new directives"): Opus at medium is the day-to-day manager. Fable at high is planner and advisor on huge or stuck jobs and the last-resort worker (max only with client consent). Fable capped at 25% of the weekly window. Promotion of Fable to full manager is reopened only with Phase 4 measurements.

## 2d. Phase 1 chunk plan (awaiting client sign-off)

Model and effort are fixed per chunk before work starts. Every blocking hook is reviewed by reviewer (Opus, max) before it is accepted.

| Chunk | Work | Owner (model, effort) | Passes when | Proof |
|---|---|---|---|---|
| 1.1 | Establish what a mod can do | scout (Haiku, medium) | quotes re-checked by manager | DONE, section 8a |
| 1.2 | Plugin skeleton: manifest, hooks module, folder layout | builder (Sonnet, medium) | `claude plugin validate` passes | command output |
| 1.3 | Charter file: 21 rules with approved rule 19, two-mode rule, seat table with pre-set model and effort | maker (Haiku, medium) | text matches section 1, 2a-2c of this record | diff |
| 1.4 | Load the charter into the model's context at session start | builder (Sonnet, medium) | plugin test finds the context block | test output |
| 1.5 | Job record and gate state machine G1-G8, with mode (solo or full) | builder (Sonnet, medium); tests by maker (Haiku, medium) | valid transitions pass, invalid ones are refused | test output |
| 1.6 | Mode trigger from concrete signals (size, unclear request, irreversible action, failure on record); `!project` and `!solo` prefixes | builder (Sonnet, medium) | 20 labelled prompts classified as labelled | test output |
| 1.7 | Agreement gate: on full-process jobs, no file-changing tool call before client sign-off is recorded; fail-closed | builder (Sonnet, high) | blocked before sign-off, allowed after, denied when the gate is forced to throw | test output, review notes |
| 1.8 | Proof gate (minimal): command log, and "done" refused on full-process jobs with no passing check on record; second gate as shell-command hook; logged override | builder (Sonnet, high) | false "done" refused by both gates; forced throw denies; override is logged | test output, review notes |
| 1.9 | Board: side pane (jobs, gate, chunks, owner, status, evidence) and status line (current job, gate, gate health) | builder (Sonnet, medium) | render test returns a valid tree | test output; look confirmed by client on their machine |
| 1.10 | Persistence of board and job history in the mod's store | maker (Haiku, medium) | history present after reload | test output |
| 1.11 | Phase demo: one toy job through all gates with the plugin loaded | manager | every gate fires in order | captured log |
| 1.12 | Commit folder to `main`, send direct link | manager | commit exists | link |

Not verifiable from the cloud session: how the pane looks on screen. The client confirms that locally.

## 3. Organisation

| Role | Who | Model, effort |
|---|---|---|
| Client | the user | n/a |
| Day-to-day manager (rules 9, 13-16) | main loop | Opus, medium |
| Planner and advisor on huge or stuck jobs (rules 2-8) | called in | Fable, high |
| Specialist for science, long research, costly facts, automation | sage | Fable, high |
| scout: search, explore, lookup | employee | Haiku, medium |
| clerk: extraction, classification, strict format, localisation, bulk edits | employee | Haiku, low |
| maker: SQL, data analysis, tests, small specified code change | employee | Haiku, medium |
| builder: multi-step coding, debugging, documents, fact-complete summaries | employee | Sonnet, medium (high if long, low for summaries) |
| reviewer: code and security review | employee | Opus, max |
| architect: whole-program builds, hard reasoning, twice-failed work | employee | Opus, xhigh, then Fable, high |

## 4. Mods (eight)

| # | Mod | Company function | Charter rules served |
|---|---|---|---|
| 1 | Charter | Loads the rules; tracks each job through gates; blocks work before agreement and delivery before proof | 1-6, 15, 18, 20 |
| 2 | Board | Live project record: jobs, phases, chunks, owner, status, evidence; shown in a side pane | 7, 8, 21 |
| 3 | Router | Dispatcher: tags each task and assigns the best-suited employee | 9-11 |
| 4 | Crew | The employees, each pinned to model and effort | 11, 12 |
| 5 | Gatekeeper | Quality control: required checks, rework by the responsible worker, escalation, proof matching | 13, 14, 16, 17, 20 |
| 6 | Meter | Accounting: tokens, cost, limit use, Fable cap | stinginess |
| 7 | Diet | Operations: keeps the manager's context small | stinginess |
| 8 | Audit | Performance review: record per model and task type, shadow re-runs, promotion and demotion | 10, 19 |

## 5. Job gates (state machine inside Charter)

G1 Intake -> G2 Assessment and questions -> G3 Simulation of consequences -> G4 Client review and agreement -> G5 Plan into phases and chunks -> G6 Staffing -> G7 Execution, reports, checks, rework -> G8 Proof and delivery.
Hard blocks: no G5+ before client agreement at G4 (Project tier). No G8 claim unless every claimed check exists in the command log with a pass result.

## 6. Build phases (each ends with a client demo and proof)

| Phase | Builds | Chunks | Exit proof |
|---|---|---|---|
| 0 Agreement | this record | charter wording, points A-E, open settings | client sign-off |
| 1 Foundation | Charter, Board | 1.1 verify what a mod can do (hooks, pane, status line, state, install); 1.2 charter and tier file; 1.3 gate state machine and board format; 1.4 hooks with logged override; 1.5 pane; 1.6 demo | a toy job run through all gates, with log |
| 2 Workforce | Crew, Router | 2.1 employee definitions; 2.2 routing rules from the research table; 2.3 text-only classifier for unclear prompts; 2.4 override prefixes; 2.5 test on 40 labelled prompts; 2.6 demo | routing accuracy figures |
| 3 Quality | Gatekeeper | 3.1 check registry per task type; 3.2 command log and proof matcher; 3.3 rework loop; 3.4 risky-change detector; 3.5 tests with seeded failures; 3.6 demo | seeded failures caught and reworked |
| 4 Economy | Meter, Diet | 4.1 ledger; 4.2 limit readout; 4.3 Fable cap and economy mode; 4.4 context guards; 4.5 token comparison against stock; 4.6 demo | measured token difference |
| 5 Review | Audit | 5.1 record per model and task type; 5.2 shadow re-runs; 5.3 promotion and demotion rules; 5.4 canary set; 5.5 acceptance test against stock; 5.6 final sign-off | same tasks, stock versus suite: quality not lower, cost lower |

Staffing for the build: specs and client contact = manager. Hook scripts and logic = builder. Config, schemas, tests = maker. Doc lookups = scout. Every hook that can block work = reviewed by reviewer before it ships.

## 7. Evidence index

- Research report: scratchpad/reports/Claude 5 model capability and cost.md
- Own test results: scratchpad/bench/sweep/results.jsonl (131 text-only runs), agent_results.jsonl (13 tool-using runs), summary.txt
- Findings summary: scratchpad/model-analysis-handoff.md

## 8. Not yet proven

- (Resolved by chunk 1.1, see section 8a.)
- Whether the mod's persistent store survives between cloud sessions (inference: it does not, because it is a file in the container's config directory). Depends on where the client runs Claude Code.
- A real example of an agent file with a pinned `effort:` line (the schema allows it; no installed plugin uses it).
- Per-effort cost figures below max effort (secondary source only).
- Community voting and review evidence (second-hand, incomplete).
- Savings ratios beyond small samples (one run per cell in own tests).
- Opus and Fable on the six tool-using tasks (nine runs scheduled 12:45 UTC).

## 8a. Chunk 1.1 result: what a mod can do (verified 2026-11-16)

Source files: /tmp/claude-0/bundled-skills/2.1.325/ba7bef350ec23e0a3fdb60d29a10382f/plugin-authoring/reference.md and types/claude-code.d.ts. Worker: Haiku, medium. "M" = quote re-checked by the manager; "W" = worker's quote only.

- M. A mod can set model and effort per model request, for the main loop and for subagents: `turn.step`, "`next({ ...e, model })` or `effort` sends another" (d.ts 4785-4789).
- M. A mod can set a subagent's model when it starts, or refuse it: `agent.spawn` (d.ts 4399-4404).
- M. Agent definitions accept `model` and `effort` (low, medium, high, xhigh, max) (d.ts 515-520).
- M. A mod can read the rate-limit windows (`five_hour`, `seven_day`) and the session cost (d.ts 3024-3026, 12633).
- M. Guards fail open: "A hook that fails is skipped and the chain continues without it, unless its registration's `.catch` handler answers in its place" (reference.md 126-127). Every blocking gate must use the catch-and-deny pattern.
- M. Persistence without GitHub: "The mod's folder ends with the session's container, so the mod is handed over in the chat as a plugin file: `<mod>.plugin`" (reference.md 182). Steps: copy, secret scan, validate, zip, SendUserFile; the client presses Save plugin. The company cannot make that click.
- M. `$.store`: per-plugin key-value store "kept between sessions", a JSON file under the Claude Code configuration directory (d.ts 3597-3601).
- W. Surfaces: side pane (`ui.open`, `ui.render`), band above the prompt, status line, toast, native notification, slash commands (reference.md 201, 263, 299-313; d.ts 2562, 8014).
- W. Hooks can rewrite or drop a prompt (`prompt.submit`), add context (`prompt.context`), allow or deny tool calls (`tool.call`, `tool.check`).
- W. A mod runs with no Node and no DOM (reference.md 23): it cannot run tests itself; it verifies checks from observed tool results.
- W. Model calls made by a mod are billed to the session with no per-call cap (reference.md 262).
- W. The marketplace install route needs a GitHub repository (reference.md 141-166). Ruled out by the client.

## 9. Open client decisions

1. Points A, B, C, D, E above.
2. Default profile: standard (Opus medium manager) or lean (Sonnet medium manager).
3. Fable cap (proposed 25% of the weekly window).
4. Escalation consent (proposed: automatic up to Fable high, ask before Fable max).

5. Where the client runs Claude Code (cloud sessions, own computer, or both): decides where the ledger and Board are stored.
6. Nine remaining test runs and the caveman-style report: on hold since 12:41 UTC, weekly window at 89%. Client to confirm run or skip.

## 9a. Work record (one line per chunk; mistakes are recorded here, rule 19)

| Chunk | Worker (model, effort) | Result | Check by manager | Defects |
|---|---|---|---|---|
| 1.1 | scout (Haiku, medium) | accepted | 7 quotes re-read in source | none found |
| 1.2 | builder (Sonnet, medium) | accepted | `claude plugin validate` re-run by manager, exit 0, hooks: session.start | none found; state contract shape `company: {}` not confirmed against an example |
| 1.3 | maker (Haiku, medium) | accepted after fixes | rule 19 text matched word for word by script; all 21 rules present; charter read in full | 1 worker defect: mode section not addressed to "you" as instructed. 2 manager defects: rule 20 wording in the record contradicted its confirmed reading; effort paragraph did not reflect the per-chunk rule clarified to the client. All three fixed by the manager (small edits, solo mode). |
| 1.4 | builder (Sonnet, medium) | accepted | validate and test re-run by manager; charter constant equals source, 4870 bytes | none found |
| 1.5 | builder (Sonnet, medium); tests by maker (Haiku, medium) | accepted | 37 tests pass on manager's run; mutation check: with the client-agreement rule deliberately broken in a copy, the rule 5 test fails as it should | none found |
| 1.6 | builder (Sonnet, medium) | accepted after fix | 79 tests pass on manager's run (20 labelled prompts all classified as labelled); validate passes | 1 manager defect: spec said "starts with", so `!soloist` counted as the `!solo` prefix; fixed by the manager (prefix must be a whole word) with a test added. Worker left a no-op line, removed. |

## 10. Change log

- 2026-11-16: client confirmed build continues in this Fable session until 2026-11-19, when the Opus manager arrangement starts. Client asked whether model and effort are dynamic: answered yes, decided per chunk at staffing, raised on failure, revised by Audit. Phase 1 started: chunks 1.2 and 1.3 done.

- 2026-11-16 12:41 UTC: client decided point A (two modes: full process or solo). Scheduled runs put on hold (weekly window 89%). Chunk 1.1 done by a Haiku worker at medium effort; seven key quotes re-checked by the manager.

- 2026-11-16: research report delivered; routing design proposed (seven mods); client issued the 21-rule charter; design re-based on the charter (eight mods); record created.
- 2026-11-16: client agreed to account-level install (E); added requirement F (effort pre-decided per employee and task type); asked for point A to be re-explained. Points A, B, C, D and settings 2-4 still open.
- 2026-11-16: chunks 1.4 and 1.5 accepted. WORK STOPPED: weekly usage window read at 98% (5-hour window 66%). Remaining Phase 1 chunks 1.6 to 1.12 not started. Correction: the repository has no main branch (default is master) and the first push was refused for lack of access. After the client restored access, the work was pushed on 2026-11-16 13:31 UTC to branch claude/models-capability-analysis-pt61if, commit d4b9675. Not on master. Resume after the weekly reset on 2026-11-19 04:00 UTC.
- 2026-11-16 13:31 UTC: client restored GitHub access and instructed the company to finish chunks 1.6 to 1.12. Weekly window read at 99%, so the chunks cannot run before the reset. Automatic resume scheduled for 2026-11-19 04:05 UTC.
- 2026-11-19 04:01 UTC: weekly window reset (read at 1%, 5-hour at 8%). Client had instructed on 2026-11-16 to start immediately and do what fits; session now runs on Opus 5.5 (client switch). Scheduled resume cancelled as no longer needed. Chunk 1.6 accepted.
- 2026-11-19: plan change (rule 21): chunks 1.7 and 1.8 are built together by one builder (Sonnet, high) because both change register.tsx; spec at scratchpad/specs/1.7-1.8-gates.md. Interface chosen by the company, reversible: the client signs off by typing !agree, closes a job with !close, and overrides a broken gate with !gates off / !gates on (logged). Only prompts the client types (origin composer or bridge) can open jobs or give these commands. Noted: the account copy of the mod (saved by the client, Nov 16 version) loads in this session next to the development copy.
