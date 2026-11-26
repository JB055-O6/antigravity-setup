#!/bin/bash
# usage: [DRY=1] [LANES=3] [SETUPS="A B C D E F"] [TASKS="T1 T2 T3 T4 T5 T6 T1-big"] bench3.sh <reps>
# Benchmark v3 (spec section 10): repetitions 1..<reps> of every setup x task through run3.sh.
# A run whose jsonl exists is skipped, so a later call with a larger <reps> adds runs. Adaptive n:
# name the setups and tasks to extend in SETUPS and TASKS, with each pair's base setup (C, or A for C).
# Per repetition and setup, a block: one discarded warm-up run (T6, into $R3/warm), then that setup's
# tasks. The warm-up sits right before the scored runs, so each setup meets a warm prompt cache.
# Repetition r rotates the setup order and the task order by r (a Latin square over 6 repetitions),
# so no setup always runs first. Blocks go round-robin to the lanes; lanes run in parallel, each in
# its own work dirs, and the next repetition starts when all lanes are done.
# Before each run: wait while $SCRATCH/PAUSE exists, and while the 5 h use is >= 85% (score3.py --meter
# reads the newest rate_limit_event in any run's jsonl) until the window resets.
# DRY=1 prints the plan and runs nothing.
set -u
[[ ${1:-} =~ ^[1-9][0-9]*$ ]] || { sed -n '2,13p' "$0"; exit 2; }
REPS=$1
HERE=$(cd "$(dirname "$0")" && pwd)
export SCRATCH=${SCRATCH:-/tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/bench3}
export R3=${R3:-$SCRATCH/r3}
LANES=${LANES:-3}
read -ra SETUPS <<< "${SETUPS:-A B C D E F}"
read -ra TASKS <<< "${TASKS:-T1 T2 T3 T4 T5 T6 T1-big}"
WARM=T6 # a subagent task, so the warm-up also warms the subagent's prompt prefix

rot() { # rot <k> <items...>: the items rotated left by k
  local k=$1; shift
  local a=("$@") i
  for ((i = 0; i < ${#a[@]}; i++)); do echo "${a[(i + k) % ${#a[@]}]}"; done
}

meter() {
  local w
  while [ -e "$SCRATCH/PAUSE" ]; do echo "paused: $SCRATCH/PAUSE exists; remove it to go on"; sleep 60; done
  while w=$(python3 -I "$HERE/score3.py" --meter "$R3") && [ "$w" -gt 0 ]; do
    echo "meter: 5 h use is at 85% or more; all lanes wait ${w}s for the reset"; sleep "$w"
  done
}

go() { # go <lane> <out dir> <setup> <task> <rep>
  local lane=$1 out=$2
  shift 2
  if [ -n "${DRY:-}" ]; then
    echo "lane $lane: $1 $2 $3$([ "$out" != "$R3" ] && echo '  (warm-up, discarded)')"
    return
  fi
  meter
  R3=$out bash "$HERE/run3.sh" "$@" "$lane"
}

lane() { # lane <rep> <lane> <setups in this repetition's order>
  local r=$1 l=$2 i=0 s t todo
  shift 2
  for s in "$@"; do
    ((i++ % LANES == l - 1)) || continue
    todo=()
    for t in $(rot "$r" "${TASKS[@]}"); do
      [[ $t == T1-big && $s != [CEF] ]] && continue # T1-big runs only for C, E and F (spec 15)
      [ -e "$R3/$s-$t-$r.jsonl" ] || todo+=("$t")
    done
    ((${#todo[@]})) || continue
    go "$l" "$R3/warm" "$s" "$WARM" "w$r"
    for t in "${todo[@]}"; do go "$l" "$R3" "$s" "$t" "$r"; done
  done
}

for ((r = 1; r <= REPS; r++)); do
  order=($(rot "$r" "${SETUPS[@]}"))
  echo "rep $r: setup order ${order[*]}"
  for ((l = 1; l <= LANES; l++)); do
    if [ -n "${DRY:-}" ]; then lane "$r" "$l" "${order[@]}" | sed "s/^/rep $r /"; else lane "$r" "$l" "${order[@]}" & fi
  done
  wait
done
