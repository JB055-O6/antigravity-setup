# Spec: context diet (automatic, no commands)

Work folder: W = /tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/work/company (already equal to the live mod 0.3.0: charter, router, governor, meter; 127 tests). Read W/hooks/register.tsx, router.ts and governor.ts first and keep every existing behaviour and test.
API reference: P = /tmp/claude-0/bundled-skills/2.1.328/f280d9c908710af4722b2fd3cc25b7ea/plugin-authoring (grep types/claude-code.d.ts; read the doc of every event, field and `$` call you use).

## Purpose
The largest token cost in a Claude Code session is the main loop re-reading its own growing context on every request. Keep that context small, automatically, without losing information the work needs and without blocking anything.

## 1. Compact subagent reports (agent.spawn)
For every spawn the router does not leave alone for a reason of identity (that is: every built-in type except `fork`, resumes, teammates and workflow agents; plugin agents included), append to the subagent's `prompt` this exact block, once (do not append if the prompt already contains the marker `[company-diet]`):

```
[company-diet] Your final report goes into the main conversation's context and is paid for on every later request. Keep it to what the caller needs: the answer or result, the proof (file paths with line numbers, the command and its exit status, a short excerpt), and anything unresolved. At most 25 lines. Never paste whole files, full logs or long command output; give a path and the relevant lines instead.
```
Do it in the existing agent.spawn hook, combined with the routing rewrite (one `next({ ...e, model, prompt })`). Read in AgentSpawnInput's doc whether a prompt rewrite is applied for each kind of spawn, and skip the kinds where it is not.

## 2. Large-file reads in the main loop (tool.call on Read)
Only on the main loop (no `agentId`), only when the call has neither `offset` nor `limit` nor `pages`: check the file size with `$.fs.stat`. If the file is larger than 256 KB and is a text file (not .pdf, .ipynb, or an image extension), rewrite the call to `limit: 600` and attach context to the result (read ToolCallResult: `context`) saying: "[company-diet] This file is <size> KB; only its first 600 lines were read to protect the context. Read further with offset/limit, or delegate full reading or searching of it to the scout subagent." Every other Read passes untouched. On any error (stat fails, path unresolvable) pass the call untouched. Not a guard: never deny.

## 3. Big search output in the main loop (tool.call on Grep)
Only on the main loop, only when `output_mode` is `content` and `head_limit` is absent: set `head_limit: 200`. Everything else untouched.

## 4. Status
Count each diet action (reports trimmed, reads capped, greps capped) in a module counter; add ` · <n> diet` to the status line built by the meter (keep its format otherwise).

## 5. Tests (claude-code/testing)
diet.test.ts: the block is appended once to a general-purpose spawn, to an Explore spawn and to a crew agent spawn; not appended twice; not appended to a fork; routing still applies in the same rewrite. Main-loop Read of a 300 KB text file without limit gets limit 600 and the context note; with a limit it is untouched; a subagent Read is untouched; a 300 KB .pdf is untouched; a stat failure passes untouched. Main-loop Grep content without head_limit gets 200; with head_limit, files_with_matches, or from a subagent: untouched. Status line shows the diet count. If the kit cannot raise an event or answer `$.fs.stat`, say so and test the logic as far as possible.

## 6. Acceptance (run each, paste real output)
A. `claude plugin validate W` passes. B. `claude plugin test W` all pass (127 existing + new). C. tsc clean with scratchpad/tc/router.tsconfig.json (add new files).

## 7. Rules
Touch only W and that tsconfig. No commands, no blocking, nothing asked of the person. No silent workarounds; report deviations and anything unproven. Do not claim anything you did not run.
