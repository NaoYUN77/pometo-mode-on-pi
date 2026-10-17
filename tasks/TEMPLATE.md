---
# The one command that decides this task is done. Required: without it a run
# cannot prove itself, and run-task.sh fails it. Keep it in step with the
# checkpoint item "The check" that the Feature playbook asks for.
check: bash scripts/check.sh
---

<goal: what is wrong, or what you want, in one or two sentences>

Done means <a check that can pass or fail>. Show me <the real output you want to
see>.

<constraints that change what the agent does: "repro first", "don't change any
code yet", "stop and let me review before proceeding", "at most N turns">
