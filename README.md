# RocksDB Bazel overlay

Bazel overlay for [facebook/rocksdb](https://github.com/facebook/rocksdb),
following the [Watchman overlay](https://github.com/perplexityai/watchman)
layout. Upstream sources are pinned to **v11.8.1**.

## Development build

The development harness registers hermetic LLVM toolchains and a Linux ARM64
platform using glibc 2.28 and libc++. It can cross-compile from Linux x86_64
or build on a Linux ARM64 or macOS ARM64 host. Darwin ARM64 uses the hermetic macOS SDK
and libc++. Bazel 9.2.0 is pinned in `.bazelversion`.

```sh
bazel build -c opt //:rocksdb-aarch64-unknown-linux-gnu
bazel build -c opt //:rocksdb-aarch64-apple-darwin
bazel build -c opt //:rocksdb-smoke-aarch64-unknown-linux-gnu
bazel build -c opt //:rocksdb-smoke-aarch64-apple-darwin
```

The library targets produce `librocksdb.a` for
`aarch64-unknown-linux-gnu` and `aarch64-apple-darwin`.
Link consumers with the matching C++ runtime.
Locate the archives and smoke executables with `bazel cquery -c opt <target>
--output=files`; the platform transitions place them in configuration-specific
output directories.

No host-specific CPU instructions are enabled. Optional external compression
libraries, io_uring, jemalloc, and plugins are currently disabled.

Run the smoke executable on a matching ARM64 Linux or macOS host with a fresh database
path. It verifies writing, SST flush, close/reopen, reading, deletion, and cleanup:

```sh
/path/to/rocksdb_smoke_test /tmp/rocksdb-smoke-new
```

For local x86_64 validation:

```sh
bazel run -c opt //:rocksdb_smoke_test -- /tmp/rocksdb-smoke-new
```

## BCR overlay

The consumer API is:

```starlark
bazel_dep(name = "rocksdb", version = "11.8.1")
```

Depend on `@rocksdb//:rocksdb` from a `cc_library` or `cc_binary`.


`bcr/modules/rocksdb/11.8.1` contains the registry module, upstream archive
checksum, overlay file checksums, and Linux x86_64/ARM64 and macOS ARM64 presubmit matrix.
The published module uses the consumer's C++ toolchain; LLVM toolchains are
registered only in the development harness. The overlay supports Linux and macOS.
It is checked in locally and has not been published to the public BCR.

To validate it through the local registry:

```sh
python3 tests/validate_bcr.py
cd tests/bcr
bazel build --registry=file://$(realpath ../../bcr) \
  --registry=https://bcr.bazel.build @rocksdb//:rocksdb //:smoke_test
bazel run --registry=file://$(realpath ../../bcr) \
  --registry=https://bcr.bazel.build //:smoke_test -- /tmp/rocksdb-bcr-new
```

After changing overlay files, run `python3 tools/update_bcr_integrity.py`
and `python3 tests/validate_bcr.py`.
The library source list follows upstream `CMakeLists.txt`; review it when
upgrading RocksDB. Build version metadata is expanded deterministically without
consulting the host Git checkout or current time.

## Development hooks

The repository includes Watchman's Conventional Commit hooks. Install them with
`npm ci` (Node.js 22 or newer). The release-please configuration tracks the
harness version separately from the upstream RocksDB version; automated release
publishing has not been configured.

## License

Overlay scaffolding is Apache-2.0. Upstream RocksDB keeps its own licensing.
