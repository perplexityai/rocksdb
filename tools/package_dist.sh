#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root after building the optimized distribution targets.
execroot="$(bazel info execution_root)"
mapfile -t source_roots < <(
  bazel cquery -c opt @rocksdb//:rocksdb --output=starlark \
    --starlark:expr=target.label.workspace_root | sort -u
)
[[ "${#source_roots[@]}" -eq 1 ]]

for triple in x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu aarch64-apple-darwin; do
  mapfile -t archives < <(
    bazel cquery -c opt "//:rocksdb-$triple" --output=files
  )
  mapfile -t executables < <(
    bazel cquery -c opt "//:rocksdb-smoke-$triple" --output=files
  )
  [[ "${#archives[@]}" -eq 1 && "${archives[0]}" == */librocksdb.a ]]
  [[ "${#executables[@]}" -eq 1 ]]
  stage="artifacts/rocksdb-$triple"
  mkdir -p "$stage/lib" "$stage/include"
  install -m644 "$execroot/${archives[0]}" "$stage/lib/librocksdb.a"
  install -m755 "$execroot/${executables[0]}" "$stage/rocksdb_smoke_test"
  cp -R "$execroot/${source_roots[0]}/include/." "$stage/include/"
  cp "$execroot/${source_roots[0]}/LICENSE.Apache" \
    "$execroot/${source_roots[0]}/LICENSE.leveldb" "$stage/"
  tar -czf "artifacts/rocksdb-$triple.tar.gz" -C artifacts "rocksdb-$triple"
done
