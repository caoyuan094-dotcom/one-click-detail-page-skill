#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.local}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

keys=(
  YUNWU_API_BASE
  YUNWU_API_KEY
  YUNWU_GEMINI_MODEL
  YUNWU_IMAGE_MODEL
  GEMINI_API_KEY
  GEMINI_MODEL
  OPENAI_BASE_URL
  OPENAI_API_KEY
  OPENAI_IMAGE_MODEL
  REQUEST_BODY_LIMIT_BYTES
)

for key in "${keys[@]}"; do
  line="$(grep -E "^${key}=" "$ENV_FILE" || true)"
  if [ -z "$line" ]; then
    continue
  fi
  value="${line#*=}"
  if [ -z "$value" ]; then
    echo "Skipping ${key} (empty)"
    continue
  fi
  echo "Setting ${key}"
  npx vercel env add "$key" production --value "$value" --yes --force >/dev/null
done

echo "Vercel production environment variables updated."
