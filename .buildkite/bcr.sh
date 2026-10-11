#!/usr/bin/env bash
set -euo pipefail
source .buildkite/setup.sh
python3 tests/validate_bcr.py
cd tests/bcr
set -euo pipefail
bazel build -c opt \
  --registry="file://$GITHUB_WORKSPACE/bcr" \
  --registry=https://bcr.bazel.build \
  --incompatible_autoload_externally=+@rules_cc \
  @rocksdb//:rocksdb //:smoke_test

set -euo pipefail
bazel test \
  --registry="file://$GITHUB_WORKSPACE/bcr" \
  --registry=https://bcr.bazel.build \
  --incompatible_autoload_externally= \
  --copt=-O1 \
  --test_output=errors \
  @rocksdb//:util_coding_test @rocksdb//:util_crc32c_test \
  @rocksdb//:util_compression_test \
  @rocksdb//:db_db_basic_test @rocksdb//:env_env_basic_test

set -euo pipefail
bazel test \
  --registry="file://$GITHUB_WORKSPACE/bcr" \
  --registry=https://bcr.bazel.build \
  --incompatible_autoload_externally= \
  --copt=-O1 \
  --test_output=errors \
  --test_arg='--gtest_filter=BitvectorTest.*:LoudsTrieTest.*:*MemoryAllocatorTest.*:CreateMemoryAllocatorTest.*:DBTest2.ZSTDChecksum:*/BlockBasedTableTest.CompressionRatioThreshold/*' \
  @rocksdb//:utilities_trie_index_trie_index_test \
  @rocksdb//:memory_memory_allocator_test \
  @rocksdb//:db_db_etc2_test @rocksdb//:table_table_test

