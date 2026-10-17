#!/usr/bin/env bash
# Run one pstack task headless, and say honestly whether it worked.
#
#   bash scripts/run-task.sh tasks/<file>.md
#   bash scripts/run-task.sh tasks/<file>.md --tools "read,grep,find,ls,bash"
#   PI_MAX_MINUTES=20 bash scripts/run-task.sh tasks/<file>.md
#
# pi has no turn cap and no budget flag, and a failed response in JSON mode still
# exits zero. So this wrapper supplies the wall clock, reads the event stream to
# decide success, and writes a report a human can check afterwards.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

task=${1:?usage: run-task.sh <task.md> [--tools <list>]}
[ -f "$task" ] || { echo "no such task file: $task" >&2; exit 2; }
shift

tools=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tools) tools=${2:?--tools needs a list}; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# A broken setup should stop before it spends anything.
if ! bash scripts/doctor.sh >/dev/null 2>&1; then
  echo "doctor failed, refusing to run:" >&2
  bash scripts/doctor.sh >&2
  exit 3
fi

stamp=$(date +%Y%m%d-%H%M%S)
slug=$(basename "$task" .md | tr -cd 'A-Za-z0-9._-')
run=".runs/$stamp-$slug"
mkdir -p "$run"
cp "$task" "$run/task.md"

minutes=${PI_MAX_MINUTES:-30}
session="run-$stamp-$slug"

args=(--mode json --approve --session-id "$session" --name "$slug")
[ -n "$tools" ] && args+=(--tools "$tools")
args+=(-p "/poteto-mode $(cat "$task")")

echo "task   $task"
echo "run    $run"
echo "ceiling ${minutes}m"
echo

start=$(date +%s)
if command -v timeout >/dev/null 2>&1; then
  MSYS_NO_PATHCONV=1 timeout "$((minutes * 60))" pi "${args[@]}" > "$run/events.jsonl" 2> "$run/stderr.log"
  rc=$?
else
  MSYS_NO_PATHCONV=1 pi "${args[@]}" > "$run/events.jsonl" 2> "$run/stderr.log"
  rc=$?
fi
end=$(date +%s)

python - "$run" "$rc" "$((end - start))" <<'PY'
import json, os, sys

run, rc, secs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
events = os.path.join(run, "events.jsonl")

text, agent_msgs, turns, tools, models, stops = [], 0, 0, {}, {}, []
subs = []
settled = False
usage = {}
for line in open(events, encoding="utf-8", errors="replace"):
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except Exception:
        continue
    t = e.get("type")
    if e.get("usage"):
        usage = e["usage"]
    if t == "agent_settled":
        settled = True
    if t == "message_end":
        m = e.get("message") or {}
        role = m.get("role")
        if role == "assistant":
            agent_msgs += 1
            model = m.get("model")
            if model:
                models[model] = models.get(model, 0) + 1
            if m.get("stopReason"):
                stops.append(m["stopReason"])
            for p in (m.get("content") or []):
                if isinstance(p, dict):
                    if p.get("type") == "text":
                        text.append(p["text"])
                    elif p.get("type") == "toolCall":
                        name = p.get("name")
                        tools[name] = tools.get(name, 0) + 1
                        if name in ("subagent", "task"):
                            a = p.get("arguments") or {}
                            subs.append((a.get("agent") or "(chain/parallel)", str(a.get("agentScope") or "")))
    if t == "tool_execution_end":
        detail = e.get("details") or {}
        for r in detail.get("results") or []:
            if isinstance(r, dict):
                subs.append((r.get("agent", "?"), r.get("model", "?")))

turns = agent_msgs
final = text[-1].strip() if text else ""
failed_reasons = []
if rc != 0:
    failed_reasons.append(f"process exited {rc}")
if not settled:
    failed_reasons.append("no agent_settled event, the run was cut off")
for bad in ("error", "aborted", "length"):
    if bad in stops:
        failed_reasons.append(f"a response stopped with '{bad}'")

report = []
report.append(f"seconds      {secs}")
report.append(f"turns        {turns}")
for m, n in sorted(models.items(), key=lambda x: -x[1]):
    report.append(f"model        {m}  ({n} turns)")
if usage:
    report.append("tokens       in={input} out={output} cacheRead={cacheRead} total={totalTokens}".format(**{
        k: usage.get(k, 0) for k in ("input", "output", "cacheRead", "totalTokens")}))
if tools:
    report.append("tools        " + ", ".join(f"{k}x{v}" for k, v in sorted(tools.items(), key=lambda x: -x[1])))
if subs:
    report.append("seats        " + ", ".join(f"{a}@{m}" for a, m in subs))
report.append(f"verdict      {'FAILED' if failed_reasons else 'ok'}")
for r in failed_reasons:
    report.append(f"  - {r}")

summary = "\n".join(report)
print(summary)
print()
print("--- final reply ---")
print(final[:4000] or "(empty)")

open(os.path.join(run, "report.md"), "w", encoding="utf-8").write(
    f"# {os.path.basename(run)}\n\n```\n{summary}\n```\n\n## Final reply\n\n{final}\n")
open(os.path.join(run, "reply.txt"), "w", encoding="utf-8").write(final)
sys.exit(1 if failed_reasons else 0)
PY
agent_rc=$?

# The check is the only thing that decides whether the work is done. The agent's
# own word is a report, not a verdict.
check_cmd=$(sed -n 's/^check:[[:space:]]*//p' "$run/task.md" | head -1)
check_rc=0
if [ -n "$check_cmd" ]; then
  echo
  echo "--- the check ---"
  echo "$check_cmd"
  MSYS_NO_PATHCONV=1 bash -c "$check_cmd" 2>&1 | tee "$run/check.log"
  check_rc=${PIPESTATUS[0]}
else
  echo
  echo "no 'check:' line in the task file, so this run cannot prove itself done" >&2
  check_rc=127
fi

echo
if [ "$check_rc" -eq 0 ] && [ "$agent_rc" -eq 0 ]; then
  echo "VERDICT ok"
  exit 0
fi
[ "$agent_rc" -ne 0 ] && echo "VERDICT failed: the agent run did not finish cleanly"
[ "$check_rc" -ne 0 ] && echo "VERDICT failed: the check is not green (exit $check_rc)"
exit 1
