#!/usr/bin/env bash
# This repo's check. One command that decides whether the setup and anything
# built on it are sound. Named by a task file's `check:` line, run by
# scripts/run-task.sh before a run is allowed to call itself done.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

rc=0

echo "--- doctor ---"
bash scripts/doctor.sh || rc=1

# Every page or module that carries its own verification script.
found=0
while IFS= read -r script; do
  found=$((found + 1))
  echo
  echo "--- $script ---"
  if ! node "$script"; then
    rc=1
  fi
done < <(find . -name 'verify.mjs' -not -path './.git/*' -not -path './node_modules/*' -not -path './.runs/*' | sort)

[ "$found" -eq 0 ] && echo && echo "(no verify.mjs found; doctor alone decided)"

echo
if [ "$rc" -eq 0 ]; then
  echo "check: green"
else
  echo "check: RED"
fi
exit "$rc"
