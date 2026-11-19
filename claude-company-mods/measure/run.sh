#!/bin/bash
# usage: run.sh <outdir>; runs each task in base and mod arms
OUT=$1; SP=/tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad
M=/root/.claude/dev-mods/5b430f7e-0f7b-55c5-8d67-00dd071d0571/company
OFF='{"enabledPlugins":{"company@synced":false}}'
BIG=$SP/diet-big.txt; HOOKS=/home/user/antigravity-setup/claude-company-mods/company/hooks
T1="Use one subagent to find which file under $HOOKS defines the function governEffort, and its line number. Answer only as path:line."
T2="What exactly does line 4500 of the file $BIG say? Line numbers start at 1. Answer with the line's text only."
T3="How many lines of the file $BIG contain the digit 7? Answer with the number only."
mkdir -p $OUT; cd $SP/measure
for t in 1 2 3; do eval P=\$T$t
 for arm in base mod; do
  extra=(); [ $arm = mod ] && extra=(--plugin-dir $M)
  timeout 600 claude -p "$P" --model opus --effort medium --settings "$OFF" "${extra[@]}" \
   --tools "Read,Grep,Glob,Agent" --allowedTools "Read,Grep,Glob,Agent" --max-budget-usd 1 \
   --output-format stream-json --verbose > $OUT/t$t-$arm.jsonl 2>&1
  echo "t$t $arm exit=$?"
 done; done
