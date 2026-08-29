#!/usr/bin/env bash
set -euo pipefail
if git diff --cached --name-only | grep -qE '(^|/)\.env($|\.)'; then
  echo "BLOCKED: attempting to commit a .env file"; exit 1
fi
if git diff --cached -U0 | grep -iE 'api[_-]?key|access[_-]?token|x-api-key' \
   | grep -vE 'example|placeholder|<|>'; then
  echo "BLOCKED: possible secret in staged diff"; exit 1
fi
python3 core/test_scoring.py >/dev/null || { echo "BLOCKED: scoring tests failed"; exit 1; }
echo "pre-commit OK"
