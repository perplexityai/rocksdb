#!/usr/bin/env bash
set -euo pipefail
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$PWD/release" "$work/"
python3 .github/ci/artifacts.py verify "$work/release"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) triple=x86_64-unknown-linux-gnu ;;
  Darwin-arm64) triple=aarch64-apple-darwin ;;
  *) echo 'Unexpected smoke agent' >&2; exit 1 ;;
esac
tar -xzf "$work/release/rocksdb-$triple.tar.gz" -C "$work"
"$work/rocksdb-$triple/rocksdb_smoke_test" "$work/database"
