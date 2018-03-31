## RocksDB 笔记 ##
---
*written by Alex Stocks on 2018/03/28，版权所有，无授权不得转载*

### 0 说明 
---

近日在写一个分布式 KV DB，存储层使用了 RocksDB。

RocksDB 的优点此处无需多说，它的 feature 是其有很多优化选项用于对 RocksDB 进行调优。欲熟悉这些参数，必须对其背后的原理有所了解，本文主要整理一些 RocksDB 的 wiki 文档，以备自己参考之用。


### 1 [Block Cache](https://github.com/facebook/rocksdb/wiki/Block-Cache) 
---

Block Cache是RocksDB的数据的缓存，这个缓存可以在多个RocksDB的实例下缓存。一般默认的Block Cache中存储的值是未压缩的，而用户可以再指定一个Block Cache，里面的数据可以是压缩的。用户访问数据先访问默认的BC，待无法保证后再访问用户Cache，用户Cache的数据可以直接存入page cache中。

Cache 有两种：LRUCache 和 BlockCache。Block 分为很多 Shard，以减小竞争，所以 shard 大小均匀一致相等，默认 Cache 有 64 个 shards，每个 shard 大小不超过 512k，总大小是 8M，类别是 LRU。

<!---C++--->
	std::shared_ptr<Cache> cache = NewLRUCache(capacity);
	BlockedBasedTableOptions table_options;
	table_options.block_cache = cache;
	Options options;
	options.table_factory.reset(new BlockedBasedTableFactory(table_options));
	
这个 Cache 是不压缩数据的，用户可以设置压缩数据 BlockCache，方法如下：

<!---C++--->
	table_options.block_cache_compressed = cache;
	
如果 Cache 为 nullptr，则RocksDB会创建一个，如果想禁用 Cache，可以设置如下 Option：

<!---C++--->
	table_options.no_block_cache = true;
	
默认情况下RocksDB用的是 LRUCache，大小是 8MB， 每个 shard 单独维护自己的 LRU list 和独立的 hashtable，以及自己的 Mutex。
 
 RocksDB还提高了一个 ClockCache，每个 shard 有自己的一个 circular list，有一个 clock handle 会轮询这个 circular list，寻找过时的 kv，如果 entry 中的 kv 已经被访问过则可以继续存留，相对于 LRU 好处是无 mutex lock，circular list 本质是 tbb::concurrent_hash_map，从 benchmark 来看，二者命中率相似，但吞吐率 Clock 比 LRU 稍高。
 
Block Cache初始化之时相关参数：

* capacity 总的内存使用量
* num_shards_bits 把 key 的前 n bits 作为 shard id，则总 shard 的数目为 2 ^ num_shards_bits；
* strict_capacity_limit 在一些极端情况下 block cache 的总体使用量可能超过 capacity，如在对 block 进行读或者迭代读取的时候可能有插入数据的操作，此时可能因为加锁导致有些数据无法及时淘汰，使得总体capacity超标。如果这个选项设置为 true，则此时插入操作是被允许的，但有可能导致进程 OOM。如果设置为 false，则插入操作会被 refuse，同时读取以及遍历操作有可能失败。这个选项对每个 shard 都有效，这就意味着有的 shard 可能内存已满， 别的 shard 却有很多空闲。
* high_pri_pool_ratio block中为高优先级的 block 保留多少比例的空间，这个选项只有 LRU Cache 有。

默认情况下 index 和filter block 与 block cache 是独立的，用户不能设定二者的内存空间使用量，但为了控制 RocksDB 的内存空间使用量，可以用如下代码把 index 和 filter 也放在 block cache 中：

<!---C++--->
	BlockBasedTableOptions table_options;
	table_options.cache_index_and_filter_blocks = true;

index 与 filter 一般访问频次比 data 高，所以把他们放到一起会导致内存空间与 cpu 资源竞争，进而导致 cache 性能抖动厉害。有如下两个参数需要注意：cache_index_filter_blocks_with_high_priority 和 high_pri_pool_ratio 一样，这个参数只对 LRU Cache 有效，两者须同时生效。这个选项会把 LRU Cache 划分为高 prio 和低 prio 区，data 放在 low 区，index 和 filter 放在 high 区，如果高区占用的内存空间超过了 capacity * high_pri_pool_ratio，则会侵占 low 区的尾部数据空间。

* pin_l0_filter_and_index_blocks_in_cache 把 level0 的 index 以及 filter block 放到 Block Cache 中，因为 l0 访问频次最高，一般内存容量不大，占用不了多大内存空间。

SimCache 用于评测 Cache 的命中率，它封装了一个真正的 Cache，然后用给定的 capacity 进行 LRU 测算，代码如下:

<!---C++--->
	// This cache is the actual cache use by the DB.
	std::shared_ptr<Cache> cache = NewLRUCache(capacity);
	// This is the simulated cache.
	std::shared_ptr<Cache> sim_cache = NewSimCache(cache, sim_capacity, sim_num_shard_bits);
	BlockBasedTableOptions table_options;
	table_options.block_cache = sim_cache;
	
大概只有容量的 2% 会被用于测算。

	
### 2 [RocksDB Memory](https://github.com/facebook/rocksdb/wiki/Memory-usage-in-RocksDB) 
---

RocksDB的内存大致有如下四个区：

* Block Cache
* Indexes and bloom filters
* Memtables
* Blocked pinned by iterators

#### 2.1 Block Cache
---

Block Cache 存储一些缓存数据，它的下一层是操作系统的 Page Cache。

#### 2.2 Indexes and bloom filters
---

Index 由 key、offset 和 size 三部分构成，当 Block Cache 增大 Block Size 时，block 个数必会减小，index 个数也会随之降低，如果减小 key size，index 占用内存空间的量也会随之降低。

filter是 bloom filter 的实现，如果假阳率是 1%，每个key占用 10 bits，则总占用空间就是 num_of_keys * 10 bits，如果缩小 bloom 占用的空间，可以设置 `options.optimize_filters_for_hits = true`，则最后一个 level 的 filter 会被关闭，bloom 占用率只会用到原来的 10% 。

结合 block cache 所述，index & filter 有如下优化选项：

* cache_index_and_filter_blocks 这个 option 如果为 true，则 index & filter 会被存入 block cache，而 block cache 中的内容会随着 page cache 被交换到磁盘上，这就会大大降低 RocksDB的性能，把这个 option 设为 true 的同时也把 pin_l0_filter_and_index_blocks_in_cache 设为 true，以减小对性能的影响。

如果 cache_index_and_filter_blocks 被设置为 false （其值默认就是 false），index/filter 个数就会受 max_open_files 影响，官方建议把这个选项设置为 -1，以方便 RocksDB 加载所有的 index 和 filter 文件，最大化程序性能。

可以通过如下代码获取 index & filter 内存量大小：
	
<!---C++--->
	std::string out;
	db->GetProperty(“rocksdb.estimate-table-readers-mem”, &out);
	
	
#### 2.3 Indexes and bloom filters
---
	
block cache、index & filter 都是读 buffer，而 memtable 则是写 buffer，所有 kv 首先都会被写进 memtable，其 size 是 write_buffer_size。 memtable 占用的空间越大，则写放大效应越小，因为数据在内存被整理好，磁盘上就越少的内容会被 compaction。如果 memtable 磁盘空间增大，则 L1 size 也就随之增大，L1 空间大小受 max_bytes_for_level_base option 控制。

可以通过如下代码获取 memtable 内存量大小：
	
<!---C++--->
	std::string out;
	db->GetProperty(“rocksdb.cur-size-all-mem-tables”, &out);
	
#### 2.4 Blocks pinned by iterators
---

这部分内存空间一般占用总量不多，但是如果有 100k 之多的transactions 发生，每个 iterator 与一个 data block 外加一个 L1 的 data block，所以内存使用量大约为 `num_iterators * block_size * ((num_levels-1) + num_l0_files)`。

可以通过如下代码获取 Pin Blocks 内存量大小：
	
<!---C++--->
    table_options.block_cache->GetPinnedUsage();


### 3 [Column Families](https://github.com/facebook/rocksdb/wiki/Column-Families) 
---

RocksDB 3.0 以后添加了一个 Column Family【后面简称 CF】 的feature，每个 kv 存储之时都必须指定其所在的 CF。RocksDB为了兼容以往版本，默认创建一个 “default” 的CF。存储 kv 时如果不指定 CF，RocksDB 会把其存入 “default” CF 中。

### 3.1 Option
---

RocksDB 的 Option 有 Options, ColumnFamilyOptions, DBOptions 三种。


ColumnFamilyOptions 是 table 级的，而 Options 是 DB 级的，Options 继承自 ColumnFamilyOptions 和 DBOptions，它一般影响只有一个 CF 的 DB，如 “default”。

每个 CF 都有一个 Handle：ColumnFamilyHandle，在 DB 指针被 delete 前，应该先 delete ColumnFamilyHandle。如果 ColumnFamilyHandle 指向的 CF 被别的使用者通过 DropColumnFamily 删除掉，这个 CF 仍然可以被访问，因为其引用计数不为 0.

在以 Read/Write 方式打开一个 DB 的时候，需要指定一个由所有将要用到的 CF string name 构成的 ColumnFamilyDescriptor array。不管 “default” CF 使用与否，都必须被带上。

CF 存在的意义是所有 table 共享 WAL，但不共享 memtable 和 table 文件，通过 WAL 保证原子写，通过分离 table 可快读快写快删除。每次 flush 一个 CF 后，都会新建一个 WAL，都这并不意味着旧的 WAL 会被删除，因为别的 CF 数据可能还没有落盘，只有所有的 CF 数据都被 flush 且所有的 WAL 有关的 data 都落盘，相关的 WAL 才会被删除。RocksDB 会定时执行 CF flush 任务，可以通过 `Options::max_total_wal_size` 查看已有多少旧的 CF 文件已经被 flush 了。

RocksDB 会在磁盘上依据 LSM 算法对多级磁盘文件进行 compaction，这会影响写性能，拖慢程序性能，可以通过 `WriteOptions.low_pri = true` 降低 compaction 的优先级。

### 3.2 [Set Up Option](https://github.com/facebook/rocksdb/wiki/Set-Up-Options)
---

RocksDB 有很多选项以为专门的目的进行以后，但是大部分情况下不需要进行特殊的优化。这里只列出一个常用的优化选项。

* cf\_options.write\_buffer\_size

CF 的 write buffer 的最大 size。最差情况下 RocksDB 使用的内存量会翻倍，所以一般情况下不要轻易修改其值。

* Set block cache size

这个值一般设置为 RocksDB 想要使用的内存总量的 1/3，其余的留给 OS 的 page cache。

<!---C++--->
	BlockBasedTableOptions table_options;
	… \\ set options in table_options
	options.table_factory.reset(new 
	
	std::shared_ptr<Cache> cache = NewLRUCache(<your_cache_size>);
	table_options.block_cache = cache;
	
	BlockBasedTableFactory(table_options));

本进程的所有的 DB 所有的 CF 所有的 table_options 都必须使用同一个 cahce 对象，或者让所有的 DB 所有的 CF 使用同一个 table_options。

* cf\_options.compression, cf\_options.bottonmost\_compression









## 参考文档 ##
---

- 1 [Clustering Guide](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/clustering.md)


## 扒粪者-于雨氏 ##

> 2018/01/09，于雨氏，初作此文于海淀。