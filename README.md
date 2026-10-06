# RocksDB Bazel overlay (`rocksdb`)

Bazel overlay for [facebook/rocksdb](https://github.com/facebook/rocksdb),
following the [Watchman overlay](https://github.com/perplexityai/watchman)
layout. Upstream sources are pinned to **v11.8.1**.

## Development build

The development harness registers hermetic LLVM toolchains and Linux x86_64/ARM64
platforms using glibc 2.28 and libc++. It can cross-compile from Linux x86_64
or build on a Linux ARM64 or macOS ARM64 host. Darwin ARM64 uses the hermetic macOS SDK
and libc++. Bazel 9.2.0 is pinned in `.bazelversion`.

```sh
bazel build -c opt //:rocksdb-x86_64-unknown-linux-gnu
bazel build -c opt //:rocksdb-aarch64-unknown-linux-gnu
bazel build -c opt //:rocksdb-aarch64-apple-darwin
bazel build -c opt //:rocksdb-smoke-aarch64-unknown-linux-gnu
bazel build -c opt //:rocksdb-smoke-aarch64-apple-darwin
bazel build -c opt //:rocksdb-smoke-x86_64-unknown-linux-gnu
```

The distribution targets use `with_cfg` to select their target platform and force
`compilation_mode=opt`, including all compression libraries and smoke executables.
Passing `-c opt` is optional for these targets. The public BCR library inherits
the consumer's platform and compilation mode.

The library targets produce `librocksdb.a` for
`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, and `aarch64-apple-darwin`.
Link consumers with the matching C++ runtime.
Locate the archives and smoke executables with `bazel cquery -c opt <target>
--output=files`; the platform transitions place them in configuration-specific
output directories.

No host-specific CPU instructions are enabled. Snappy, zlib, bzip2, LZ4/LZ4HC,
and Zstd are compiled from pinned BCR sources through the consumer toolchain;
no host compression libraries are used. The optional liburing dependency
configures against the selected target C toolchain. Linux consumers can opt into
io_uring with `--@rocksdb//:with_liburing`. Plugins remain disabled.
RocksDB links the BCR jemalloc overlay. Linux uses its standard symbols;
Darwin uses `_rjem_` symbols without replacing the system allocator.
`@rocksdb//:jemalloc` exposes the same configured allocator for consumers such as
Rust's `tikv-jemalloc-sys` (which must set `--cfg=prefixed` on Darwin).

Run the smoke executable on a matching Linux or macOS host with a fresh database
path. It checks jemalloc linkage (and its nodump allocator on Linux), codec availability,
and writing, SST flush, close/reopen,
reading, deletion, and cleanup with each supported compression codec:

```sh
/path/to/rocksdb_smoke_test /tmp/rocksdb-smoke-new
```

For local x86_64 validation:

```sh
bazel run -c opt --platforms=//bazel/platforms:linux_x64 \
  //:rocksdb_smoke_test -- /tmp/rocksdb-smoke-new
```

## BCR overlay

The consumer API is:

```starlark
bazel_dep(name = "rocksdb", version = "11.8.1")
```

Depend on `@rocksdb//:rocksdb` from a `cc_library` or `cc_binary`.

The module name and repository label are both `rocksdb`; no `repo_name` mapping
is needed. Select this overlay through its registry when consuming it.

`bcr/modules/rocksdb/11.8.1` contains the registry module, upstream archive
checksum, overlay file checksums, and Linux x86_64/ARM64 and macOS ARM64 presubmit matrix.
The published module uses the consumer's C++ toolchain; LLVM toolchains are
registered only in the development harness. The overlay supports Linux and macOS.
The development harness patches jemalloc's build-time `nm` and `awk` actions
for hermetic LLVM; consumers using that toolchain need the same fixes until
they reach the jemalloc BCR module.
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
harness version separately from the upstream RocksDB version.

## GitHub Actions

The `bazel` workflow validates BCR consumption with Bazel 8 and 9 on Linux
amd64. A single Linux amd64 build job compiles all three distributions.
Separate jobs download those artifacts and run persistence smoke tests on
runners matching each target triple: Linux amd64, Linux ARM64, and macOS ARM64.
The ARM64 Linux and macOS smoke jobs do not compile sources.
The commit-hook workflow checks PR titles and commit messages.

On published releases, `bazel-opt` uploads a tarball for each target,
containing `lib/librocksdb.a` and codec archives, public headers, upstream licenses, and a smoke
executable. A manual run can build artifacts or update an existing release tag.
To package locally after building the library and smoke targets, run
`bash tools/package_dist.sh` with Bazel on your `PATH`.

Release-please requires a `GH_RELEASE_TOKEN` repository secret with permission
to create release PRs and releases. A separate token allows published releases
to trigger the artifact and BCR workflows.
The BCR publishing workflow uses `BCR_PUBLISH_TOKEN` (a classic PAT with `repo`
and `workflow` scopes and access to `perplexityai/bazel-central-registry`) to
stage the checked-in module and open a public BCR PR. It supports manual module
version selection; on releases it selects the latest checked-in module version,
independently of the development harness version.

## License

Overlay scaffolding is Apache-2.0. Upstream RocksDB keeps its own licensing.

## Upstream tests and feature flags

The public flags `with_bzip2`, `with_lz4`, `with_zlib`, `with_zstd`, and
`with_liburing` retain the previous BCR configuration interface. Compression
codecs default to enabled, matching this overlay's distributions; `with_snappy`
can also disable Snappy. Linux io_uring remains opt-in.

Upstream GoogleTest targets and their shared test library are available in the
registry module. Run them without `-c opt`, because RocksDB's assertion-enabled
test hooks are removed by `NDEBUG` in optimized builds:

```sh
bazel test --registry=file://$(realpath ../../bcr) \
  --registry=https://bcr.bazel.build @rocksdb//:all
```

The previous overlay's known test exclusions are retained. BCR presubmit tests
Linux with the default codecs, io_uring enabled, and compression disabled, plus
macOS with its existing prefetch-test exclusion.
