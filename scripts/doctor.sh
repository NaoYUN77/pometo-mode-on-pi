#!/usr/bin/env bash
# Is this setup sound? Works in two places:
#   - a project checkout of pometo-mode-on-pi
#   - an installed package, where agents live in the project or ~/.pi/agent
# Exits non-zero on any failure.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

fail=0
pass() { printf 'PASS %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1"; fail=$((fail + 1)); }

# 1. The mode prompt and the route extension, the two entry points.
if [ -s .pi/prompts/poteto-mode.md ] && [ -s .pi/extensions/skill-routes.ts ]; then
  pass "1 entry points: /poteto-mode template, bare skill and playbook routes"
else
  bad "1 entry points: .pi/prompts/poteto-mode.md or .pi/extensions/skill-routes.ts missing"
fi

# 2. The skill tree, and the router inside it.
if [ -f .agents/skills/poteto-mode/SKILL.md ]; then
  n=$(find .agents/skills -name SKILL.md | wc -l)
  pass "2 skills: $n skills, router present"
else
  bad "2 skills: .agents/skills/poteto-mode/SKILL.md missing"
fi

# 3. Every seat names a model the catalog serves. Seats are found where pi reads
#    them: the project first, then the user directory. A package cannot ship them.
AGENT_DIRS=""
[ -d .pi/agents ] && AGENT_DIRS=".pi/agents"
[ -d "$HOME/.pi/agent/agents" ] && AGENT_DIRS="$AGENT_DIRS $HOME/.pi/agent/agents"
if [ -z "$AGENT_DIRS" ]; then
  bad "3 seats: no .pi/agents/ in the project and none in ~/.pi/agent/agents"
else
  models=$(pi --list-models 2>/dev/null | awk 'NF>=2 {print $1"/"$2}')
  bad_seat=""
  count=0
  for dir in $AGENT_DIRS; do
    for f in "$dir"/*.md; do
      [ -e "$f" ] || continue
      count=$((count + 1))
      m=$(sed -n 's/^model:[[:space:]]*//p' "$f" | head -1)
      if [ -z "$m" ]; then bad_seat="$bad_seat $(basename "$f" .md)=none"; continue; fi
      if [ -n "$models" ] && ! printf '%s\n' "$models" | grep -qx -- "$m"; then
        bad_seat="$bad_seat $(basename "$f" .md)=$m"
      fi
    done
  done
  if [ -n "$bad_seat" ]; then
    bad "3 seats: model not in the catalog:$bad_seat"
  else
    pass "3 seats: $count seats, every model resolves"
  fi
fi

# 4. Read-only seats must not be able to write.
writers=""
for dir in $AGENT_DIRS; do
  for name in explorer judge reviewer; do
    f="$dir/$name.md"
    [ -e "$f" ] || continue
    line=$(sed -n 's/^tools:[[:space:]]*//p' "$f" | head -1)
    case ",$line," in
      *,write,*|*,edit,*|*,patch,*) writers="$writers $name" ;;
    esac
  done
done
if [ -n "$writers" ]; then
  bad "4 read-only seats: writer tool declared:$writers"
else
  pass "4 read-only seats: explorer, judge, reviewer declare no writer tool"
fi

# 5. The wiring every playbook step depends on.
missing=""
[ -f .pi/extensions/subagent/index.ts ] || missing="$missing subagent-extension"
[ -f .pi/extensions/skill-routes.ts ] || missing="$missing skill-routes"
[ -f .pi/extensions/todo.ts ] || missing="$missing todo-tool"
[ -f .pi/prompts/poteto-mode.md ] || missing="$missing poteto-mode-prompt"
[ -f .agents/harness/pi.md ] || missing="$missing harness-adapter"
if [ -n "$missing" ]; then
  bad "5 wiring: missing$missing"
else
  pass "5 wiring: subagent, skill routes, todo tool, /poteto-mode prompt, harness adapter"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "doctor: all 5 checks passed"
  exit 0
fi
echo "doctor: $fail of 5 checks failed"
exit 1
