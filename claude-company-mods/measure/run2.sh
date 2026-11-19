#!/bin/bash
# usage: run2.sh <outdir> <rep>; round 2: r1 tasks + bug fix, stock vs mod
OUT=$1; REP=$2; SP=/tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad
M=/root/.claude/dev-mods/5b430f7e-0f7b-55c5-8d67-00dd071d0571/company
OFF='{"enabledPlugins":{"company@synced":false}}'
BIG=$SP/diet-big.txt; HOOKS=/home/user/antigravity-setup/claude-company-mods/company/hooks
mkdir -p $OUT
for t in 1 2 3 4; do for arm in base mod; do
  W=$OUT/w-t$t-$arm-$REP; rm -rf $W; cp -r $SP/measure/fixture $W
  case $t in
   1) P="Use one subagent to find which file under $HOOKS defines the function governEffort, and its line number. Answer only as path:line.";;
   2) P="What exactly does line 4500 of the file $BIG say? Line numbers start at 1. Answer with the line's text only.";;
   3) P="How many lines of the file $BIG contain the digit 7? Answer with the number only.";;
   4) P="In $W, calc.py has a bug: python3 $W/test_calc.py fails. Fix calc.py so the test passes. Do not change test_calc.py. Answer with one line saying what you fixed.";;
  esac
  extra=(); [ $arm = mod ] && extra=(--plugin-dir $M)
  timeout 600 claude -p "$P" --model opus --effort medium --settings "$OFF" "${extra[@]}" \
   --tools "Read,Grep,Glob,Agent,Edit,Bash" --allowedTools "Read,Grep,Glob,Agent,Edit,Bash(python3:*)" --max-budget-usd 1 \
   --output-format stream-json --verbose > $OUT/t$t-$arm-$REP.jsonl 2>&1
  echo "t$t $arm rep$REP exit=$?"
  if [ $t = 4 ]; then (cd $W && python3 test_calc.py >/dev/null 2>&1 && sha256sum -c test.sha >/dev/null 2>&1 && echo PASS || echo FAIL) > $OUT/t4-$arm-$REP.grade; fi
done; done
