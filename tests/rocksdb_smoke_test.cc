#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>

#include "rocksdb/db.h"
#include "rocksdb/version.h"

int main(int argc, char** argv) {
  if (argc != 2 || std::filesystem::exists(argv[1])) {
    std::cerr << "Usage: rocksdb_smoke_test <new-database-path>\n";
    return 1;
  }
  const std::string path = argv[1];
  auto check = [](const rocksdb::Status& status) {
    if (!status.ok()) {
      std::cerr << status.ToString() << '\n';
      std::exit(1);
    }
  };
  rocksdb::Options options;
  options.create_if_missing = true;
  options.compression = rocksdb::kNoCompression;
  std::unique_ptr<rocksdb::DB> db;
  check(rocksdb::DB::Open(options, path, &db));
  check(db->Put(rocksdb::WriteOptions(), "key", "persisted-value"));
  rocksdb::FlushOptions flush;
  flush.wait = true;
  check(db->Flush(flush));
  db.reset();
  options.create_if_missing = false;
  check(rocksdb::DB::Open(options, path, &db));
  std::string value;
  check(db->Get(rocksdb::ReadOptions(), "key", &value));
  if (value != "persisted-value") return 1;
  check(db->Delete(rocksdb::WriteOptions(), "key"));
  if (!db->Get(rocksdb::ReadOptions(), "key", &value).IsNotFound()) return 1;
  db.reset();
  check(rocksdb::DestroyDB(path, options));
  std::cout << "RocksDB " << rocksdb::GetRocksVersionAsString(true)
            << ": write, flush, reopen, read, delete passed\n";
}
