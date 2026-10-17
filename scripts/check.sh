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
