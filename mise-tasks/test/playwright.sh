# shellcheck shell=bash
# `playwright_test <config> <task args>`, sourced by the Playwright tasks (test:e2e, test:e2e-all, test:e2e-collab,
# test:e2e-docs, test:e2e-gitlab): runs the suite of <config>; the first argument is the browser (all, or one
# Playwright project), the rest go to Playwright.
playwright_test() {
  local config="$1"
  shift
  local args=("$@")
  [[ ${#args[@]} -gt 0 && "${args[0]}" == "$usage_browser" ]] && args=(${args[@]+"${args[@]:1}"})
  [[ "$usage_browser" != all ]] && args=(--project="$usage_browser" ${args[@]+"${args[@]}"})
  pnpm exec playwright test -c "$config" ${args[@]+"${args[@]}"}
}
