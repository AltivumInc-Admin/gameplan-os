#!/usr/bin/env bash
# Populate backend/layer/python with the Strands Agents SDK for the Lambda
# layer (AgentDependenciesLayer in template.yaml). Run once before the first
# `sam deploy` on a fresh checkout, and again to pick up SDK updates.
#
# Wheels are pinned to the Lambda platform (manylinux x86_64, python 3.13),
# so the result is NOT importable on macOS - that is expected.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf backend/layer/python
python3.13 -m pip install strands-agents PyJWT \
  --target backend/layer/python \
  --platform manylinux2014_x86_64 \
  --python-version 3.13 \
  --only-binary=:all: \
  --quiet
echo "Layer built: $(du -sh backend/layer/python | cut -f1) in backend/layer/python"
