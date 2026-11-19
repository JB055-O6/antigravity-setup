# Spec: the model router (automatic, no commands)

Work folder (scratch copy of the mod; work ONLY here): W = /tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/work/company
API reference: P = /tmp/claude-0/bundled-skills/2.1.325/ab992139d7c74ca0b45bbf8b51fdf8b0/plugin-authoring (reference.md, examples/, types/claude-code.d.ts; grep the types, never read them whole). Read the docs of every event and `$` call you use; do not guess field names or result shapes.
Existing mod: W/hooks/register.tsx (session.start sets a status; prompt.compose adds the charter), W/hooks/charter.ts, W/hooks/charter.test.ts. Keep both hooks working.

## Purpose

Make every subagent run on the cheapest model and effort that does its kind of work as well as a pricier one, automatically, with nothing for the person to type. The main loop's model is NOT touched (switching model mid-conversation throws away the prompt cache); subagents start with a fresh context, so routing them costs no cache.

Evidence behind the table (from the project's research and tests): Haiku 5.5 matched the larger models on search, lookup, extraction, classification and long-context retrieval at about 1/20 to 1/45 of the cost; it falls far behind on long multi-step agent work. Sonnet 5.5 tied Opus and Fable on independent multi-step coding tests at the lowest cost of the three. Opus is better at hard code review and architecture. Fable is the last resort for science, long research and problems the others failed.

## 1. Pinned crew: register at session.start with `$.agent.register` (read AgentSpec)

| name | model | effort | tools | use (this is the `description` the model reads) |
|---|---|---|---|---|
| scout | haiku | medium | Read, Glob, Grep, Bash, WebFetch, WebSearch | Fast, cheap lookups: find files, search code, read and summarise files, extract facts, look things up on the web. Read-only work. |
| builder | sonnet | medium | (all) | Multi-step coding, debugging, refactors, tests, documents and fact-complete summaries. |
| reviewer | opus | max | Read, Glob, Grep, Bash | Code and security review of a change; finds bugs before they ship. |
| architect | opus | xhigh | (all) | Architecture, design decisions, whole-program builds and hard reasoning, or work a builder failed twice. |
| sage | fable | high | (all) | Last resort: science, long ambiguous research, costly factual questions, or problems architect could not solve. |

Each `prompt` (the agent's whole system prompt) must be short (under 120 words): its role, "Work only on the task given. Verify your result before reporting (run the tests or the check that proves it). Report in at most 15 lines: what you did, the proof, and anything unresolved. Never paste large raw output; summarise it." The scout's prompt adds: "Never change files."

## 2. Pure logic: W/hooks/router.ts (+ W/hooks/router.test.ts). No `$`, no I/O.

- `export type Route = { model: 'haiku' | 'sonnet' | 'opus' | 'fable'; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; reason: string }`
- `export function classifyTask(text: string): 'lookup' | 'review' | 'architecture' | 'research' | 'code'` from the spawn's description plus prompt, case-insensitive, whole words:
  - review: review, audit, security, vulnerability, "find bugs", "code review", "check the diff", critique
  - architecture: architecture, architect, design, "system design", plan, planning, strategy, tradeoff, trade-off, "from scratch"
  - research: research, investigate, "literature", "deep dive", science, scientific, paper, papers, benchmark, compare options
  - lookup: find, search, locate, list, grep, explore, read, summarise, summarize, extract, "look up", lookup, inventory, "where is", "which files", count
  - otherwise code.
  Precedence when several match: review > architecture > research > code-signal words (implement, fix, refactor, build, write, edit, change, add, debug, test, migrate) > lookup. That is: if any code-signal word appears together with lookup words, the result is code.
- `export function routeSpawn(i: { subagentType: string; model?: string; description: string; prompt: string; providerIsEngine: boolean }): Route | null`
  - returns null (leave the spawn alone) when: the caller gave a `model`; the type is `fork`; the type is not a built-in (providerIsEngine false), because plugin agents carry their own model; the type is one of the crew names above (they are pinned already).
  - `Explore` -> haiku, medium, reason "Explore is read-only search".
  - `general-purpose` (and any other built-in type) -> by classifyTask: lookup -> haiku medium; code -> sonnet medium; review -> opus max; architecture -> opus xhigh; research -> fable high. Reason names the class.
- `export function suggestedAgent(cls)` returning the crew name for a class (lookup->scout, code->builder, review->reviewer, architecture->architect, research->sage).

router.test.ts: one test per class with at least 4 labelled descriptions each (20+), the precedence rules, every null case, and word boundaries (for example "designer" is not "design", "finder" is not "find", "reviewer" alone still counts as review? decide: NO, only the listed words).

## 3. Wiring in W/hooks/register.tsx

- agent.spawn hook (read AgentSpawnInput and its result in the types): compute `routeSpawn`. If null, `return next(e)`. Otherwise return `next({ ...e, model: route.model })` and remember the effort for the spawned agent's id, so that its requests get that effort. Find in the types how to learn the new agent's id (the spawn's result, or `turn.step`'s `agentId` together with something that ties it to the spawn such as `tool_use_id` / `$.agent.list()`); if the API gives no reliable link, set no effort for routed general-purpose spawns and say so in your report (the model alone already carries most of the saving).
- turn.step hook (read its docs: `next({ ...e, effort })` lasts one step; on a subagent, a level on a step with input stays for later tool steps): for a step whose `agentId` has a remembered effort that differs from `e.effort`, pass `next({ ...e, effort })`. Every other step: `next(e)` untouched. Never change `model` here. Never touch steps without `agentId` (the main loop).
- Both hooks are NOT guards: if anything inside throws, the spawn or step must go ahead unchanged (catch and `next(e)`), never block.
- Tally: keep a count of routed spawns per model in `$.store` under key `routes` (shape `{ haiku: n, sonnet: n, opus: n, fable: n, since: <epoch ms> }`), written best-effort (errors ignored). Show `company: router on · <n> subagents routed` on the status line after a routed spawn.
- session.start: register the crew, then the existing status. A failure to register one agent must not stop the others or the session.

## 4. Tests

- router.test.ts as above.
- wiring.test.ts with the testing kit ('claude-code/testing'; see P/examples/pane.test.tsx, W/hooks/charter.test.ts and the `mock` docs). Prove at least: (a) the five crew agents are registered with the right model and effort; (b) a general-purpose spawn whose description is "Find where the config is loaded" is sent on with model haiku; "Fix the failing login test" with sonnet; (c) a spawn with an explicit model, a fork and a plugin agent pass through unchanged; (d) a step of a routed agent gets its effort, and a main-loop step is untouched; (e) if routing throws, the spawn goes ahead unchanged. If the kit cannot raise one of these events, say exactly which and why, and test the logic as far as the kit allows.

## 5. Acceptance (run each, paste real output)

A. `claude plugin validate W` passes and lists the hooks session.start, prompt.compose, agent.spawn, turn.step.
B. `claude plugin test W`: all pass.
C. Type-check: tsc with a tsconfig kept OUTSIDE W (copy /tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/tc/tsconfig.json to scratchpad/tc/router.tsconfig.json and point its `files` at W's files), zero errors.

## 6. Rules

Touch only files in W (and the one tsconfig named above). Do not edit the live mod under /root/.claude/dev-mods/. No slash commands, no prompts to the person, nothing that blocks work. If the API does not allow something here, do not invent a workaround silently: report what the types say and what you did instead. Do not claim anything you did not run. Report: files written, outputs A to C, deviations, and anything unproven.
