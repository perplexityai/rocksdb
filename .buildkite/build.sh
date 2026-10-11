#!/usr/bin/env bash
set -euo pipefail
source .buildkite/setup.sh
python3 tests/validate_bcr.py
bazel build -c opt //:dist //:rocksdb-smoke-x86_64-unknown-linux-gnu //:rocksdb-smoke-aarch64-unknown-linux-gnu //:rocksdb-smoke-aarch64-apple-darwin
bash tools/package_dist.sh
mkdir -p release
cp artifacts/*.tar.gz release/
python3 .buildkite/artifacts.py pack release
