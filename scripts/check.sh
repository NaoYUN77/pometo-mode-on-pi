#!/usr/bin/env bash
# This repo's check. One command that decides whether the setup and anything
# built on it are sound. The verify-poteto-pi skill points here.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

rc=0

echo "--- doctor ---"
bash scripts/doctor.sh || rc=1

# The routing surface, checked without a model call.
if [ -f scripts/test-routes.mjs ]; then
  echo
  echo "--- routes ---"
  if ! node scripts/test-routes.mjs; then
    rc=1
  fi
fi

# The gh tool's pure half, checked without a model call or a GitHub token.
if [ -f scripts/verify-gh-tool.mjs ]; then
  echo
  echo "--- gh tool ---"
  if ! node scripts/verify-gh-tool.mjs; then
    rc=1
  fi
fi

# The bash guard, which stops an unbounded search from hanging the session.
if [ -f scripts/test-bash-guard.mjs ]; then
  echo
  echo "--- bash guard ---"
  if ! node scripts/test-bash-guard.mjs; then
    rc=1
  fi
fi

# A subagent result cut to the cap, and stdout split mid-character. Both are
# silent corruption when they go wrong, so they are checked byte by byte.
if [ -f scripts/test-subagent-output.mjs ]; then
  echo
  echo "--- subagent output ---"
  if ! node scripts/test-subagent-output.mjs; then
    rc=1
  fi
fi

# The README's numbers, which rot the moment a skill is added.
if [ -f scripts/verify-readme.mjs ]; then
  echo
  echo "--- readme ---"
  if ! node scripts/verify-readme.mjs; then
    rc=1
  fi
fi

# A package that ships a tool name the project already has must stand down, not
# collide. This is the guard for that, and it costs no tokens.
if [ -f scripts/test-tool-conflicts.mjs ]; then
  echo
  echo "--- tool conflicts ---"
  if ! node scripts/test-tool-conflicts.mjs; then
    rc=1
  fi
fi

# docs/pi-equivalence.md claims how each Claude Code mechanism is provided here.
# Every claim must name a file that exists, and every mechanism the skills name
# must have a row. A table nobody can audit is worse than no table.
if [ -f scripts/verify-equivalence.mjs ]; then
  echo
  echo "--- equivalence ---"
  if ! node scripts/verify-equivalence.mjs; then
    rc=1
  fi
fi

# The seat files, and the one pi flag whose meaning is easy to get wrong:
# `--tools` replaces the whole selection, extension tools included.
if [ -f scripts/test-seats.mjs ]; then
  echo
  echo "--- seats ---"
  if ! node scripts/test-seats.mjs; then
    rc=1
  fi
fi

# Aborting a subagent must end it. `killed` is not liveness, and the stub here
# is what proves the SIGKILL escalation actually fires.
if [ -f scripts/test-kill.mjs ]; then
  echo
  echo "--- kill ---"
  if ! node scripts/test-kill.mjs; then
    rc=1
  fi
fi

# The child protocol: prompt on stdin, events out, and a steer that reports
# whether the run was still live when it read it. Runs against scripts/fake-pi.mjs.
if [ -f scripts/test-child.mjs ]; then
  echo
  echo "--- child ---"
  if ! node scripts/test-child.mjs; then
    rc=1
  fi
fi

# The background path end to end: launch returns an id, the id addresses the run,
# a steer reaches it, and a steer to a finished run is refused. Also fake-pi.
if [ -f scripts/test-background.mjs ]; then
  echo
  echo "--- background ---"
  if ! node scripts/test-background.mjs; then
    rc=1
  fi
fi

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
