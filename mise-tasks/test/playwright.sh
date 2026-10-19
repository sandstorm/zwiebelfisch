# shellcheck shell=bash
# Sourced by the Playwright tasks (not executable, so no task itself). `playwright_test <config> <task args>` runs the
# suite of <config> on the task's arguments: the first is the browser (`[browser]` in their usage: all, or one
# Playwright project), the rest go to Playwright.
playwright_test() {
  local config="$1"
  shift
  local args=("$@")
  [[ ${#args[@]} -gt 0 && "${args[0]}" == "$usage_browser" ]] && args=(${args[@]+"${args[@]:1}"})
  [[ "$usage_browser" != all ]] && args=(--project="$usage_browser" ${args[@]+"${args[@]}"})
  pnpm exec playwright test -c "$config" ${args[@]+"${args[@]}"}
}
