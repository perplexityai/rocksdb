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
  [[ "${#archives[@]}" -ge 7 ]]
  [[ "${#executables[@]}" -eq 1 ]]
  stage="artifacts/rocksdb-$triple"
  mkdir -p "$stage/lib" "$stage/include"
  for archive in "${archives[@]}"; do
    [[ "$archive" == *.a ]]
    install -m644 "$execroot/$archive" "$stage/lib/$(basename "$archive")"
  done
  install -m755 "$execroot/${executables[0]}" "$stage/rocksdb_smoke_test"
  cp -R "$execroot/${source_roots[0]}/include/." "$stage/include/"
  cp "$execroot/${source_roots[0]}/LICENSE.Apache" \
    "$execroot/${source_roots[0]}/LICENSE.leveldb" "$stage/"
  mkdir -p "$stage/licenses"
  while IFS='|' read -r dependency target license; do
    source_root=$(bazel cquery -c opt "$target" --output=starlark \
      --starlark:expr=target.label.workspace_root)
    install -m644 "$execroot/$source_root/$license" "$stage/licenses/$dependency.txt"
  done <<'LICENSES'
bzip2|@bzip2//:bz2|LICENSE
lz4|@lz4//:lz4|lib/LICENSE
snappy|@snappy//:snappy|COPYING
zlib|@zlib//:zlib|zlib-1.3.2/LICENSE
zstd|@zstd//:zstd|LICENSE
LICENSES
  tar -czf "artifacts/rocksdb-$triple.tar.gz" -C artifacts "rocksdb-$triple"
done
