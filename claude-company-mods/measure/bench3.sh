#!/bin/bash
# usage: [DRY=1] [LANES=3] [SETUPS="A0 A B C D E F"] [TASKS="T1 T2 T3 T4 T5 T6 T1-big"] bench3.sh <reps>
# Benchmark v3 (spec section 10): repetitions 1..<reps> of every setup x task through run3.sh.
# A run is done when its .grade exists and score3.py --valid accepts it; done runs are skipped, so
# a later call with a larger <reps> adds runs (adaptive n). SETUPS names the setups to extend; each
# brings its cost base and stock A along (D/E/F: C and A; B/C: A), so its pairs stay complete.
# Per repetition and setup, a block: one discarded warm-up run (T6, into $R3/warm), then that setup's
# tasks; the warm-up sits right before the scored runs, so each setup meets a warm prompt cache.
# Order: repetition r rotates the setups by (r-1)/2 and reverses them in even repetitions (ABBA),
# so each pair of repetitions balances every position; tasks rotate by r. Lanes run in parallel,
# each in its own work dirs; block i of repetition r goes to lane (i + (i / LANES) * (r - 1)) % LANES,
# so the setups that share a lane change. The next repetition starts when all lanes are done.
# Before each run, fail closed: wait while $SCRATCH/PAUSE exists, on any meter error, and while the
# 5 h use is >= 85% or week use >= 83% (score3.py --meter); a reading older than METER_AGE s (900) gets a fresh one
# from a Haiku probe in safe mode (about $0.002) before any run starts. An INVALID run runs once more.
# DRY=1 prints the plan and runs nothing.
set -u
[[ ${1:-} =~ ^[1-9][0-9]*$ ]] || { sed -n '2,16p' "$0"; exit 2; }
REPS=$1
HERE=$(cd "$(dirname "$0")" && pwd)
export SCRATCH=${SCRATCH:-/tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad/bench3}
export R3=${R3:-$SCRATCH/r3}
LANES=${LANES:-3}
METER_AGE=${METER_AGE:-900}
ALL=(A0 A B C D E F)
read -ra WANT <<< "${SETUPS:-${ALL[*]}}"
read -ra TASKS <<< "${TASKS:-T1 T2 T3 T4 T5 T6 T1-big}"
WARM=T6 # a subagent task, so the warm-up also warms the subagent's prompt prefix
SETUPS=()
for s in "${ALL[@]}"; do
  for w in "${WANT[@]}"; do
    [[ " ${ALL[*]} " == *" $w "* ]] || { echo "bench3: unknown setup $w" >&2; exit 2; }
    case $w in D|E|F) need="$w C A" ;; B|C) need="$w A" ;; *) need=$w ;; esac
    if [[ " $need " == *" $s "* ]]; then SETUPS+=("$s"); break; fi
  done
done

rot() { # rot <k> <items...>: the items rotated left by k
  local k=$1; shift
  local a=("$@") i
  for ((i = 0; i < ${#a[@]}; i++)); do echo "${a[(i + k) % ${#a[@]}]}"; done
}

order() { # order <rep>: this repetition's setup order (ABBA)
  local o=($(rot $((($1 - 1) / 2)) "${SETUPS[@]}")) i
  if (($1 % 2)); then printf '%s\n' "${o[@]}"; else for ((i = ${#o[@]} - 1; i >= 0; i--)); do echo "${o[i]}"; done; fi
}

reading() { # the meter, with a fresh reading from a probe when the newest one is stale
  local out
  out=$(python3 -I "$HERE/score3.py" --meter "$R3" "$METER_AGE") || return 1
  if [[ $out == stale* ]]; then
    echo "meter: ${out#stale }; taking a fresh reading" >&2
    mkdir -p "$R3/meter" && (cd "$SCRATCH" && timeout 120 claude -p 'Reply with the word OK.' --model haiku \
      --safe-mode --max-budget-usd 0.05 --output-format stream-json --verbose \
      < /dev/null > "$R3/meter/probe-$(date +%s%N).jsonl" 2>/dev/null)
    out=$(python3 -I "$HERE/score3.py" --meter "$R3" "$METER_AGE") || return 1
  fi
  echo "$out"
}

meter() { # returns only on a fresh reading under 85%; every other case waits and looks again
  local out s why
  while :; do
    if [ -e "$SCRATCH/PAUSE" ]; then echo "paused: $SCRATCH/PAUSE exists; remove it to go on"; sleep 60; continue; fi
    out=$(exec 9> "$SCRATCH/.meter.lock" && flock 9 && reading) || out="error (score3.py --meter failed)"
    case $out in
      go*) return ;;
      wait\ *) read -r _ s why <<< "$out" # sleep at most 1 h, then look again (PAUSE, a fresh reading)
        echo "meter: $why; all lanes wait ${s}s for the reset"; sleep $((s < 3600 ? s : 3600)) ;;
      *) echo "meter: ${out:-no output}; no run starts; looking again in 60s"; sleep 60 ;;
    esac
  done
}

done_run() { # done_run <dir> <name>: graded and valid
  [ -e "$1/$2.grade" ] && python3 -I "$HERE/score3.py" --valid "$1/$2.jsonl" > /dev/null 2>&1
}

go() { # go <lane> <out dir> <setup> <task> <rep>
  local lane=$1 out=$2 try
  shift 2
  if [ -n "${DRY:-}" ]; then
    echo "lane $lane: $1 $2 $3$([ "$out" != "$R3" ] && echo '  (warm-up, discarded)')"
    return
  fi
  for try in 1 2; do
    meter
    R3=$out bash "$HERE/run3.sh" "$@" "$lane"
    python3 -I "$HERE/score3.py" --valid "$out/$1-$2-$3.jsonl" && return # prints why when INVALID
  done
}

lane() { # lane <rep> <lane> <setups in this repetition's order>
  local r=$1 l=$2 i=0 s t todo
  shift 2
  for s in "$@"; do
    (((i + (i / LANES) * (r - 1)) % LANES == l - 1)) || { ((i++)); continue; }
    ((i++))
    todo=()
    for t in $(rot "$r" "${TASKS[@]}"); do
      [[ $t == T1-big && $s != [CEF] ]] && continue # T1-big runs only for C, E and F (spec 15)
      done_run "$R3" "$s-$t-$r" || todo+=("$t")
    done
    ((${#todo[@]})) || continue
    go "$l" "$R3/warm" "$s" "$WARM" "w$r"
    for t in "${todo[@]}"; do go "$l" "$R3" "$s" "$t" "$r"; done
  done
}

[ -n "${DRY:-}" ] || mkdir -p "$SCRATCH" "$R3" || exit 2
for ((r = 1; r <= REPS; r++)); do
  order=($(order "$r"))
  echo "rep $r: setup order ${order[*]}"
  for ((l = 1; l <= LANES; l++)); do
    if [ -n "${DRY:-}" ]; then lane "$r" "$l" "${order[@]}" | sed "s/^/rep $r /"; else lane "$r" "$l" "${order[@]}" & fi
  done
  wait
done
