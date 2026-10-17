#!/usr/bin/env bash
# Preflight for this repo. Exits non-zero on any failure.
set -uo pipefail

script=${BASH_SOURCE[0]}
ROOT=$(cd "$(dirname "$script")/.." && pwd)
cd "$ROOT" || exit 1

fail=0
pass() { printf 'PASS %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }

# 1. The mode block, which is what makes this a custom mode at all.
if [ -s .pi/APPEND_SYSTEM.md ]; then
  n=$(wc -l < .pi/APPEND_SYSTEM.md)
  pass "1 mode block: .pi/APPEND_SYSTEM.md, $n lines"
else
  bad "1 mode block: .pi/APPEND_SYSTEM.md missing or empty"
fi

# 2. The skill tree, and the router inside it.
if [ -f .agents/skills/poteto-mode/SKILL.md ]; then
  n=$(find .agents/skills -name SKILL.md | wc -l)
  pass "2 skills: $n skills, router present"
else
  bad "2 skills: .agents/skills/poteto-mode/SKILL.md missing"
fi

# 3. Every seat names a model the catalog serves.
models=$(pi --list-models 2>/dev/null | awk 'NF>=2 {print $1"/"$2}')
bad_seat=""
for f in .pi/agents/*.md; do
  [ -e "$f" ] || { bad "3 seats: no .pi/agents/*.md"; break; }
  m=$(sed -n 's/^model:[[:space:]]*//p' "$f" | head -1)
  if [ -z "$m" ]; then bad_seat="$bad_seat $(basename "$f" .md)=none"; continue; fi
  if [ -n "$models" ] && ! printf '%s\n' "$models" | grep -qx -- "$m"; then
    bad_seat="$bad_seat $(basename "$f" .md)=$m"
  fi
done
if [ -n "$bad_seat" ]; then
  bad "3 seats: model not in the catalog:$bad_seat"
else
  pass "3 seats: $(ls .pi/agents/*.md | wc -l) seats, every model resolves"
fi

# 4. Read-only seats must not be able to write.
writers=""
for name in explorer judge reviewer; do
  f=".pi/agents/$name.md"
  [ -e "$f" ] || continue
  line=$(sed -n 's/^tools:[[:space:]]*//p' "$f" | head -1)
  case ",$line," in
    *,write,*|*,edit,*|*,patch,*) writers="$writers $name" ;;
  esac
done
if [ -n "$writers" ]; then
  bad "4 read-only seats: writer tool declared:$writers"
else
  pass "4 read-only seats: explorer, judge, reviewer declare no writer tool"
fi

# 5. The subagent tool, and the command that starts a run.
missing=""
[ -f .pi/extensions/subagent/index.ts ] || missing="$missing subagent-extension"
[ -f .pi/prompts/poteto-mode.md ] || missing="$missing poteto-mode-prompt"
[ -f .agents/harness/pi.md ] || missing="$missing harness-adapter"
if [ -n "$missing" ]; then
  bad "5 wiring: missing$missing"
else
  pass "5 wiring: subagent extension, /poteto-mode prompt, harness adapter"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "doctor: all 5 checks passed"
  exit 0
fi
echo "doctor: $fail of 5 checks failed"
exit 1
