#!/usr/bin/env bash
# Run a queue of task files in order, stopping at the first failure.
#
#   bash scripts/run-queue.sh tasks/*.md
#   PI_MAX_MINUTES=15 bash scripts/run-queue.sh tasks/nightly/*.md
#
# Each task runs in its own session with its own log under .runs/, so a failure
# leaves a readable record and the next task does not inherit its context.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

[ $# -gt 0 ] || { echo "usage: run-queue.sh <task.md> [more.md ...]" >&2; exit 2; }

total=$#
n=0
failed=""
for task in "$@"; do
  n=$((n + 1))
  echo "===== [$n/$total] $task ====="
  if ! bash scripts/run-task.sh "$task"; then
    failed="$task"
    echo
    echo "stopped at $task. $((total - n)) task(s) not run." >&2
    break
  fi
  echo
done

if [ -n "$failed" ]; then
  exit 1
fi
echo "queue: all $total task(s) ok"
