#!/bin/bash
# Held bench cells: Opus low on the six tool tasks, headless, no user settings or plugins.
SP=/tmp/claude-0/-home-user-antigravity-setup/5b430f7e-0f7b-55c5-8d67-00dd071d0571/scratchpad
OUT=$SP/bench/opus6; mkdir -p $OUT
for p in p19 p21 p24 p25 p26 p27; do
  D=$OUT/$p; rm -rf $D; cp -r $SP/bench/tasks/$p $D; rm -rf $D/__pycache__
  (cd $D && timeout 900 claude -p "Your working directory is $D. Read TASK.md there and do the task completely." \
    --model opus --effort low --strict-mcp-config --setting-sources '' --no-session-persistence \
    --tools "Read,Write,Edit,Glob,Grep,Bash" --allowedTools "Read,Write,Edit,Glob,Grep,Bash(python3:*),Bash(ls:*)" \
    --max-budget-usd 2 --output-format stream-json --verbose > $OUT/$p.jsonl 2>&1)
  echo "$p exit=$?"
done
