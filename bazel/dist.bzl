"""Build RocksDB artifacts for Linux and Darwin target triples."""

load("@with_cfg.bzl", "with_cfg")

_x64_builder = with_cfg(native.filegroup)
_x64_builder.set("platforms", [Label("//bazel/platforms:linux_x64")])
linux_x86_64_dist, _linux_x86_64_dist_internal = _x64_builder.build()

_builder = with_cfg(native.filegroup)
_builder.set("platforms", [Label("//bazel/platforms:linux_arm64")])
linux_aarch64_dist, _linux_aarch64_dist_internal = _builder.build()

_macos_builder = with_cfg(native.filegroup)
_macos_builder.set("platforms", [Label("@llvm//platforms:macos_arm64")])
macos_aarch64_dist, _macos_aarch64_dist_internal = _macos_builder.build()
