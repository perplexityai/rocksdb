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
`npm ci` (Node.js 22 or newer).

Release versions match the checked-in BCR module version. The first overlay for
an upstream release uses its version, such as `11.8.1`; subsequent overlay-only
revisions use `11.8.1.bcr.1`, `11.8.1.bcr.2`, and so on. An upstream upgrade
starts again at the new upstream version. Published registry entries are
immutable: add a new version directory and append it to `metadata.json` for
each revision, updating both registry and overlay `MODULE.bazel` files and
their checksums. Update the development module, overlay paths, and consumer
example to the new version as well; the upstream archive URL and strip prefix
continue to use the upstream version without the `.bcr.N` suffix.

The `Release Please` workflow opens or updates a release PR when the newest
checked-in BCR version is newer than `.release-please-manifest.json`. Merging
that PR publishes the corresponding `v<version>` GitHub release. Dispatch the
workflow manually to refresh the PR; it also runs on pushes to `main`.
Historical `0.x` tags and changelog entries retain their original versions.

`tools/bcr_release.cjs` wraps the pinned release-please library. Its BCR version
adapter preserves `.bcr.N` throughout tag, PR, changelog, and manifest parsing,
and orders revisions numerically. The custom Bazel strategy takes the next
version from registry metadata, including upstream upgrades, rather than
bumping the upstream version according to commit types or `Release-As` footers.
An overlay-only release requires a new registry entry; the workflow does not
republish the same version for later edits. Keep the adapter tests passing when
upgrading release-please, because the adapter uses the library's internal
`Version` and Bazel strategy modules. Run `npm test` to check this integration.

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

The release workflow requires a `GH_RELEASE_TOKEN` repository secret with
permission to create releases. A separate token allows published releases
to trigger the artifact and BCR workflows.
The BCR publishing workflow uses `BCR_PUBLISH_TOKEN` (a classic PAT with `repo`
and `workflow` scopes and access to `perplexityai/bazel-central-registry`) to
stage the checked-in module and open a public BCR PR. It supports manual module
version selection; on releases it checks out the release tag and publishes
that tag's module version.

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
  --registry=https://bcr.bazel.build \
  --test_arg='--gtest_filter=-PrefetchTest/PrefetchTest.Basic/*' @rocksdb//:all
```

The previous overlay's known test exclusions are retained. BCR presubmit tests
Linux with the default codecs, io_uring enabled, and compression disabled, plus
macOS with its existing prefetch-test exclusion.
The tests share the library's feature macros so they exercise the enabled codecs.
A test-only patch allows an empty dictionary-compression parameter list when all
codecs are disabled.
On Linux, four `PrefetchTest.Basic` cases are filtered from presubmit: v11.8.1
expects 2 MiB compaction reads but observes adaptive 256 KiB reads. The target
remains available, and its other 102 cases still run.
Bazel can retry the compaction service target after an intermittent checksum
failure during background compactions. The large table, WAL, iterator, and
transaction suites have one-hour timeouts for slower CI runners. macOS presubmit
uses `-O1` without `NDEBUG` to retain test hooks, and filters only the two
compaction-service cases whose custom objects fail remote compaction on macOS.

The overlay CI also runs the complete table and WAL suites natively on macOS
ARM64 with Bazel 8 and 9. These jobs use `-O1` with assertions enabled, bypass
cached test results, and run each suite once so timeouts remain visible. Test
logs and XML results are uploaded even when a suite fails. The test targets and
one-hour timeouts match the checked-in BCR entry; a faster CI runner may finish
without reproducing BCR's timeout.

GoogleTest `1.17.0.bcr.2` loads the C++ rules explicitly for Bazel 9. The overlay
also patches v11.8.1 to keep trie bitvector storage aligned under libc++, use
the correct buffer type in the Zstd checksum test callback, check the documented
status for unavailable allocator factories, and test compression ratios without
depending on platform-specific SST metadata size.
