#!/bin/bash
set -euo pipefail

# Only run in remote Claude Code on the web environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Install project dependencies
cd "$CLAUDE_PROJECT_DIR"
pnpm install

# Build all packages
pnpm build

# Install CircleCI CLI if not already installed
if ! command -v circleci &> /dev/null; then
  CIRCLECI_VERSION=$(curl -fsSL "https://api.github.com/repos/CircleCI-Public/circleci-cli/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
  curl -fsSL "https://github.com/CircleCI-Public/circleci-cli/releases/download/v${CIRCLECI_VERSION}/circleci-cli_${CIRCLECI_VERSION}_linux_amd64.tar.gz" -o /tmp/circleci.tar.gz
  tar -xzf /tmp/circleci.tar.gz -C /tmp/
  sudo mv "/tmp/circleci-cli_${CIRCLECI_VERSION}_linux_amd64/circleci" /usr/local/bin/circleci
  rm -rf /tmp/circleci.tar.gz "/tmp/circleci-cli_${CIRCLECI_VERSION}_linux_amd64"
fi
