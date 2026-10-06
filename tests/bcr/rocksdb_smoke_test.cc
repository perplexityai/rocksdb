#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>

#include "rocksdb/convenience.h"
#include "rocksdb/db.h"
#include "rocksdb/memory_allocator.h"
#include "rocksdb/version.h"

#define JEMALLOC_MANGLE
#include "jemalloc/jemalloc.h"

int main(int argc, char **argv) {
  if (argc != 2 || std::filesystem::exists(argv[1])) {
    std::cerr << "Usage: rocksdb_smoke_test <new-database-path>\n";
    return 1;
  }
  const char *allocator_version = nullptr;
  size_t version_size = sizeof(allocator_version);
  if (mallctl("version", &allocator_version, &version_size, nullptr, 0) != 0)
    return 1;
  std::cout << "jemalloc " << allocator_version << '\n';
  const std::string path = argv[1];
  auto check = [](const rocksdb::Status &status) {
    if (!status.ok()) {
      std::cerr << status.ToString() << '\n';
      std::exit(1);
    }
  };
#ifdef __linux__
  std::shared_ptr<rocksdb::MemoryAllocator> allocator;
  check(rocksdb::NewJemallocNodumpAllocator({}, &allocator));
  void *allocation = allocator->Allocate(4096);
  if (allocation == nullptr || allocator->UsableSize(allocation, 4096) < 4096)
    return 1;
  allocator->Deallocate(allocation);
#endif
  rocksdb::Options options;
  options.create_if_missing = true;
  const auto supported = rocksdb::GetSupportedCompressions();
  const rocksdb::CompressionType codecs[] = {rocksdb::kNoCompression,
                                             rocksdb::kSnappyCompression,
                                             rocksdb::kZlibCompression,
                                             rocksdb::kBZip2Compression,
                                             rocksdb::kLZ4Compression,
                                             rocksdb::kLZ4HCCompression,
                                             rocksdb::kZSTD};
  const std::string payload(65536, 'x');
  for (const auto codec : codecs) {
    if (std::find(supported.begin(), supported.end(), codec) ==
        supported.end()) {
      std::cerr << "Missing compression codec: " << static_cast<int>(codec)
                << '\n';
      return 1;
    }
    options.create_if_missing = true;
    options.compression = codec;
    std::unique_ptr<rocksdb::DB> db;
    check(rocksdb::DB::Open(options, path, &db));
    check(db->Put(rocksdb::WriteOptions(), "key", payload));
    rocksdb::FlushOptions flush;
    flush.wait = true;
    check(db->Flush(flush));
    rocksdb::TablePropertiesCollection tables;
    check(db->GetPropertiesOfAllTables(&tables));
    if (tables.empty())
      return 1;
    for (const auto &[file, properties] : tables) {
      if (codec != rocksdb::kNoCompression &&
          properties->data_size >= payload.size() / 2) {
        std::cerr << "SST data was not compressed: " << file << '\n';
        return 1;
      }
    }
    db.reset();
    options.create_if_missing = false;
    check(rocksdb::DB::Open(options, path, &db));
    std::string value;
    check(db->Get(rocksdb::ReadOptions(), "key", &value));
    if (value != payload)
      return 1;
    check(db->Delete(rocksdb::WriteOptions(), "key"));
    if (!db->Get(rocksdb::ReadOptions(), "key", &value).IsNotFound())
      return 1;
    db.reset();
    check(rocksdb::DestroyDB(path, options));
  }
  std::cout << "RocksDB " << rocksdb::GetRocksVersionAsString(true)
            << ": all compression codecs: write, flush, reopen, read, delete "
               "passed\n";
}
