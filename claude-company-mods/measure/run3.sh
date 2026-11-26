#!/bin/bash
# usage: [DRY=1] run3.sh <setup A0|A-F> <task T1..T6|T1-big> <rep> <lane>
# One benchmark v3 run (spec section 10): a fresh work copy at $SCRATCH/<lane>/<setup>-<task>-<rep>,
# one `claude -p` session in it, then grading into $R3/<setup>-<task>-<rep>.{jsonl,err,grade}.
# The work copy is outside the repo, so no repo CLAUDE.md loads and the session never sees
# fixture3/grading or TASKS.md; grading copies the held-out tests in only after the session ends.
# Env: SCRATCH, R3, RTK_MODE (D and F; default full, spec 10 re-runs with light), TIMEOUT (s), BUDGET ($).
# D/F need rtk 1.2.1 and E/F a graph build; when that check fails, no session runs and the
# .grade line (rtk/graph <rc>) makes score3.py call the run INVALID. DRY=1 prints the command, changes nothing.
set -u
[ $# -eq 4 ] || { sed -n '2,9p' "$0"; exit 2; }
SETUP=$1 TASK=$2 REP=$3 LANE=$4
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel) || exit 2
FIX=$HERE/fixture3
SCRATCH=${SCRATCH:-/tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/bench3}
R3=${R3:-$SCRATCH/r3}
NAME=$SETUP-$TASK-$REP
W=$SCRATCH/$LANE/$NAME
die() { echo "run3: $*" >&2; exit 2; }
[[ $SETUP =~ ^(A0|[A-F])$ ]] || die "setup must be A0 or A-F"
[[ $TASK =~ ^(T[1-6]|T1-big)$ ]] || die "task must be T1..T6 or T1-big"
[[ $REP =~ ^[0-9a-z]+$ && $LANE =~ ^[0-9]+$ ]] || die "rep must be [0-9a-z]+, lane a number"
[[ $TASK != T1-big || $SETUP == [CEF] ]] || die "T1-big runs only for C, E and F (spec 15)"

row() { # TASKS.md cell for $TASK through the parser test_gen.py checks: prompt, or the cmd rule ('' if none)
  python3 -I -B -c 'import sys; sys.path.insert(0, sys.argv[1]); import test_gen; r = test_gen.tasks()[sys.argv[2]]
print(r["prompt"] if sys.argv[3] == "prompt" else (r["rules"][0] if r["kind"] == "cmd" else ""))' "$FIX" "$TASK" "$1"
}
P=$(row prompt) || die "no prompt for $TASK in TASKS.md"
CMD=$(row cmd)

# The account-synced company@synced (0.10.2) loads in every session unless disabled. Every setup
# disables it, so a --plugin-dir copy never meets a same-named plugin that loads first.
OFF='{"enabledPlugins":{"company@synced":false}}'
R=$REPO/claude-company-mods/company
B=$SCRATCH/plugins/785718d/claude-company-mods/company
RTK_MODE=${RTK_MODE:-full}
STOCK=() # A0 only
case $SETUP in # plugin, and the module switches the host reads once at session start (Task 6)
  A0) PLUG= ENVS=() STOCK=(--safe-mode) # pure stock Claude: every installed plugin off (listed now, so
      # new ones count too; this also drops plugin MCP servers), and --safe-mode drops user skills,
      # hooks, CLAUDE.md and MCP. Builtin plugins ship with Claude Code and stay. score3 checks init.
      OFF=$(claude plugin list --json | python3 -I -c 'import json, sys
print(json.dumps({"enabledPlugins": {p["id"]: False for p in json.load(sys.stdin) if not p["id"].endswith("@builtin")}}))') \
        || die "cannot list the installed plugins" ;;
  A) PLUG= ENVS=() ;;                                            # client setup minus company
  B) PLUG=$B ENVS=() ;;                                          # 0.10.2 (git 785718d); has no switches
  C) PLUG=$R ENVS=(COMPANY_OFF=rtk,graph) ;;                     # 0.11, rtk and graph off
  D) PLUG=$R ENVS=(COMPANY_OFF=graph COMPANY_RTK_MODE=$RTK_MODE) ;; # 0.11 + rtk
  E) PLUG=$R ENVS=(COMPANY_OFF=rtk) ;;                           # 0.11 + graph
  F) PLUG=$R ENVS=(COMPANY_OFF= COMPANY_RTK_MODE=$RTK_MODE) ;;   # 0.11 + both
esac

# Allowed tools per setup (spec 10: they match each setup's command forms; nothing else differs).
# BASE, every setup: the plain shell forms the tasks need: pytest (T2, T3), git reads (T5),
# text tools for the 5 MB log (T4).
BASE=(python3 python pytest "git log" "git diff" "git status" "git show" "git blame" "git ls-files" "git grep"
      "git rev-parse" grep rg wc head tail cat sed awk sort uniq cut tr nl ls find tree echo)
ALLOW=(Read Grep Glob Edit Write Agent)
for c in "${BASE[@]}"; do ALLOW+=("Bash($c:*)"); done
case $SETUP in
  A0|A|B|C) ;; # A0 pure stock, A client minus company, B 0.10.2, C 0.11 with rtk and graph off: BASE only
  D|F) # rtk: the rtk form of each BASE form (a rewrite must pass with no prompt, spec 7.1), rtk read
       # (rtk's form of cat, head and tail), and `rtk bypass <BASE form>` (named in the savers block)
    for c in "${BASE[@]}" read; do ALLOW+=("Bash(rtk $c:*)"); done
    for c in "${BASE[@]}"; do ALLOW+=("Bash(rtk bypass $c:*)"); done ;;&
  E|F) ALLOW+=("Bash(graphify query:*)" "Bash(graphify explain:*)") ;; # graph: the hint's two commands (spec 7.2)
esac
PD=(); [ -n "$PLUG" ] && PD=(--plugin-dir "$PLUG")
SESSION=(env -u COMPANY_OFF -u COMPANY_RTK_MODE "${ENVS[@]}" timeout "${TIMEOUT:-1800}"
  claude -p "$P" --model opus --effort medium --settings "$OFF" "${PD[@]}" "${STOCK[@]}"
  --tools "Bash,Read,Grep,Glob,Edit,Write,Agent" --allowedTools "$(IFS=,; echo "${ALLOW[*]}")"
  --max-budget-usd "${BUDGET:-5}" --output-format stream-json --verbose)
if [ -n "${DRY:-}" ]; then
  printf 'cwd %s -> %s\nplugin %s\nsettings %s %s\nenv %s\nallow %s\n' "$W" "$R3/$NAME.jsonl" "${PLUG:-none}" "$OFF" \
    "${STOCK[*]}" "${ENVS[*]}" "${ALLOW[*]}"
  printf '%q ' "${SESSION[@]}"; echo; exit 0
fi

if [ "$SETUP" = B ] && [ ! -d "$B" ]; then # one copy for all lanes; the rename keeps a racing lane safe
  mkdir -p "$SCRATCH/plugins" && t=$(mktemp -d "$SCRATCH/plugins/.785718d.XXXXXX") || die "no plugin dir"
  git -C "$REPO" archive 785718d -- claude-company-mods/company | tar -x -C "$t" \
    && mv -T "$t" "$SCRATCH/plugins/785718d" 2>/dev/null || rm -rf "$t"
  [ -d "$B" ] || die "no 0.10.2 copy at $B"
fi
rm -rf "$W" && mkdir -p "$W" "$R3" || die "cannot make $W"
case $TASK in # recipes from fixture3/TASKS.md; never a reused copy
  T1-big) (git -C "$REPO" archive 4b40414 | tar -x -C "$W" &&
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      GIT_AUTHOR_NAME=bench GIT_AUTHOR_EMAIL=bench@example.com GIT_AUTHOR_DATE=2026-11-26T00:00:00+00:00 \
      GIT_COMMITTER_NAME=bench GIT_COMMITTER_EMAIL=bench@example.com GIT_COMMITTER_DATE=2026-11-26T00:00:00+00:00 &&
    git -C "$W" init -q -b main && git -C "$W" add -A && git -C "$W" commit -q -m snapshot) ;;
  T3) python3 -I "$FIX/gen.py" "$W" --fixed >/dev/null ;;
  *) python3 -I "$FIX/gen.py" "$W" >/dev/null ;;
esac || die "$NAME: work copy failed"
PREP=() # rtk and graph checks, for the .grade file
if [[ $SETUP == [DF] ]]; then rtk --version 2>/dev/null | grep -qx 'rtk 1\.2\.1'; PREP+=("rtk $?"); fi
if [[ $SETUP == [EF] ]]; then
  # The graph hint goes in only when graph.json exists at session start (spec 7.2), and a fresh copy
  # has none, so E and F get the graph a repo with the graph on already has. No LLM, no tokens.
  (cd "$W" && env GRAPHIFY_BACKEND=none ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= GOOGLE_API_KEY= \
    AZURE_OPENAI_API_KEY= DEEPSEEK_API_KEY= MOONSHOT_API_KEY= OLLAMA_API_KEY= GRAPHIFY_API_KEY= \
    timeout 600 graphify update . >/dev/null 2>&1 && [ -s graphify-out/graph.json ])
  PREP+=("graph $?")
  mkdir -p "$W/.git/info" && echo 'graphify-out/' >> "$W/.git/info/exclude" # keeps git status (T5) clean
fi

case $SETUP in A|A0) code=none ;; B) code=785718d ;; # the code under test, taken before the session loads it
  *) code=$(git -C "$REPO" rev-parse --short HEAD)$([ -n "$(git -C "$REPO" status --porcelain -- "$R")" ] && echo +dirty) ;;
esac
HEAD=("plugin ${PLUG:-none}" "code $code" "env ${ENVS[*]}" "${PREP[@]}")
if [[ " ${PREP[*]} " =~ \ (rtk|graph)\ [1-9] ]]; then # D/F or E/F would run as C: spend nothing
  : > "$R3/$NAME.jsonl"; printf '%s\n' "${HEAD[@]}" "exit skipped" > "$R3/$NAME.grade"
  echo "$NAME lane $LANE skipped: ${PREP[*]}" >&2; exit 1
fi
(cd "$W" && "${SESSION[@]}" < /dev/null > "$R3/$NAME.jsonl" 2> "$R3/$NAME.err")
rc=$?
{ # read by score3.py: plugin, exit, rtk, graph, hashes, cmd; the rest is for the record
  printf '%s\n' "${HEAD[@]}" "exit $rc"
  if [ "$TASK" != T1-big ]; then out=$(cd "$W" && python3 -I "$FIX/grading/grade.py" hashes 2>&1); echo "hashes $?"; echo "$out" | sed 's/^/# /'; fi
  if [ -n "$CMD" ]; then out=$(cd "$W" && FIXTURE=$FIX bash -c "$CMD" 2>&1); echo "cmd $?"; echo "$out" | sed 's/^/# /'; fi
} > "$R3/$NAME.grade"
echo "$NAME lane $LANE exit=$rc $(grep -E '^(hashes|cmd) ' "$R3/$NAME.grade" | tr '\n' ' ')"
