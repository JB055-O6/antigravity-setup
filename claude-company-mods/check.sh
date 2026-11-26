#!/usr/bin/env bash
# CHECK: plugin test, plugin validate, tsc. Run from anywhere.
R="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/company"
rc=0
run() { # name, cmd...
  local name=$1; shift
  out=$("$@" 2>&1); st=$?
  if [ $st -ne 0 ]; then echo "FAIL $name"; echo "$out" | tail -20; rc=1; return 1; fi
  return 0
}
if run TEST claude plugin test "$R"; then
  n=$(echo "$out" | grep -oE '[0-9]+ pass' | tail -1)
  if [ -n "$n" ]; then echo "TEST OK $n 0 fail"; else echo "FAIL test"; echo "$out" | tail -20; rc=1; fi
fi
run VALIDATE claude plugin validate "$R" && echo "VALIDATE OK"
run TSC npx -y -p typescript tsc -p "$R" --noEmit && echo "TSC OK"
exit $rc
