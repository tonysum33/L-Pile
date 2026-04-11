#!/usr/bin/env bash
set -euo pipefail

if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # Ensure this project always runs on the pinned Node version.
  # shellcheck disable=SC1090
  source "${HOME}/.nvm/nvm.sh"
  nvm use >/dev/null
fi

echo "Starting dev server on http://127.0.0.1:4173/"
if command -v lsof >/dev/null 2>&1; then
  existing_pid="$(lsof -tiTCP:4173 -sTCP:LISTEN || true)"
  if [ -n "${existing_pid}" ]; then
    existing_cmd="$(ps -p "${existing_pid}" -o command= || true)"
    if [[ "${existing_cmd}" == *"vite"* ]] && [[ "${existing_cmd}" == *"/L-Pile/"* ]]; then
      echo "Stopping stale local Vite process on :4173 (pid ${existing_pid})..."
      kill "${existing_pid}" || true
      sleep 1
    fi
  fi
fi

npx vite --host 127.0.0.1 --port 4173 --strictPort
