## Pulsar笔记
---
*written by Alex Stocks on 2018/10/16，版权所有，无授权不得转载*

刚开始看 Apache Pulsar 一些资料，后面逐步补充。

### 1 Pulsar vs Kafka
---

很多人查看 Pulsar 之前可能对 Kafka 很熟悉，下面详述二者的异同以明确 Pulsar 的特点。

#### 1.1 名词对应表
---

 根据个人对[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)的理解，整理如下**Pulsar 和 Kafka名词对应列表**：

| Pulsar | Kafka |
| :---- | :--- |
| Topic | Topic |
| Ledger | Partition |
| Fragment | Fragment/Segment |
| Bookie  | Broker  |
| Broker | Client SDK |
| Ensemble Size | Replica Number |
| Write Quorum Size (Qw) | metadata.broker.list |
| Ack Quorum Size (Qa) | request.required.acks |

Pulsar 的数据存储节点 Bookkeeper 被称为 Bookie，相当于一个 Kafka Broker。Ledger 是 Topic 的若干日志的集合，是 Pulsar 数据删除的最小单元，即 Pulsar 每次淘汰以 Ledger 为单位进行删除。Fragment 是 Bookkeeper 的概念，对应一个日志文件，每个 Ledger 有若干 Fragment 组成。 

Pulsar 进行数据同步时采用相关共识算法保证数据一致性。Ensemble Size 表示 Topic 要用到的物理存储节点 Bookie 个数，类似于 Kafka，其副本数目 Ensemble Size 不能超过 Bookie 个数，因为一个 Bookie 上不可能存储超过一个数据副本。每次写数据时最低写入的 Bookie 个数 Qw 的上限当然是 Ensemble Size。

Qa 是每次写请求发送完毕后需要回复确认的 Bookie 的个数，类似于 Kafka 的 `request.required.acks`，其数值越大则需要确认写成功的时间越长，其值上限当然是 Qw。[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ) 提到 `为了一致性，Qa应该是：(Qw + 1) / 2 或者更大`，即为了确保数据安全性，Qa 下限是 `(Qw + 1) / 2`。

![](../pic/pulsar/pulsar_notions.webp)

本小节的所有概念，以上面来自于[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)的一幅图作为总结比较合适。

#### 1.2 Kafka 的缺陷与 Pulsar 各个组件
---

[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ) 给出了 Kafka 的一些不足：

- 1 Kafka 每个 Partition replica 都完整的存储在kafka节点上，Partition 以及 Partition replica 由一系列的 Segment 和索引文件组成，整个架构简单快捷，但是单个节点必须有足够的磁盘空间来处理副本；
- 2 在集群扩展时必须做 Rebalance，需要 Broker 有良好的执行流程保证没有任何故障的情况下分散节点的存储压力。

比较才有优劣。相比 Pulsar，Kafka 的存储模型的缺陷导致了其负载均衡能力的不足，[参考文档3](https://jack-vanlightly.com/sketches/2018/10/2/kafka-vs-pulsar-rebalancing-sketch) 对这点很形象地以下图说明之。

![](../pic/pulsar/KafkaPulsarScaling.png) 

Pulsar 的底层数据 以 Fragments 形式存储在多个 BookKeeper 上，当集群扩容添加 Bookies 后，Pulsar 会在新的Bookie上创建新的 Fragment，所以不需要再扩容时候像 Kafka 一样进行 Rebalance 操作，其结果就是 `Fragments跨多个Bookies以带状分布`。但是这样的结果就是同一个 Ledger 的 Fragments 分布在多个 Bookie 上，导致读取和写入会在多个 Bookies 之间跳跃。Topic的 Ledger 和 Fragment 之间映射关系等元数据存储在 Zookeeper 中，Pulsar Broker 需要实时跟踪这些关系进行读写流程。

Pulsar 有一个 `Ledger的所有权(ownership)` 的概念，其意义为某个 Ledger 数据所在的 Bookie。除去创建新 Ledger 的情况，当集群扩容 Pulsar 把数据写入新的 Bookie 或者 `当前Fragment使用Bookies发生写入错误或超时` 时，`Ledger的所有权` 都会发生改变。

Pulsar 的 metadata 存储在 zookeeper 上，而消息数据存储在 Bookkeeper 上。Broker 虽然需要这些 metadata，但是其自身并不持久化存储这些数据，所以可以认为是无状态的。不像 Kafka 是在 Partition 级别拥有一个 leader Broker，Pulsar 是在 Topic 级别拥有一个 leader Broker，称之为拥有 Topic 的所有权，针对该 Topic 所有的 R/W 都经过改 Broker 完成。

Pulsar Broker 可以认为是一种 Proxy，它对 client 屏蔽了服务端读写流程的复杂性，是保证数据一致性与数据负载均衡的重要角色，所以 Pulsar 可以认为是一种基于 Proxy 的分布式系统。与之形成对比的 kafka 可以认为是一种基于 SmartClient 的系统，所以 Kafka 服务端自身的数据一致性流程还需要 Client SDK 与之配合完成。

[参考文档2](https://mp.weixin.qq.com/s/0dkgA8swNPkpcY5H6CU62w)如下一幅图可以帮助理解 Pulsar Broker 的 proxy 角色。

![](../pic/pulsar/pulsar_proxy.webp) 

上图中的 Writer Proxy 和 Read Proxy 两个逻辑角色的功能由 Pulsar Broker 这一物理模块完成。

Kafka 的所有 Broker 会选出一个 Leader，作为 Broker Leader 决定 Broker 宕机判断、集群扩容、创建删除 Topic、Topic Replica分布、Topic Partition 的 Leader 的选举。Pulsar 的所有 Broker 也会选举一个 Leader【或者称为 Master 更合适，以区分于 Topic 的 Leader】，对 Broker 宕机判断（Failover）、根据 Bookie 集群负载Topic Ledger 所有权【即 Ledger 所在的 Bookie】等任务。

### 2 Pulsar 读写过程
---

在第一章节详细介绍了 Pulsar 的相关概念。对 Kafka 读写流程比较熟悉的人应该会对 Pulsar 的读写流程了然于胸，本节借用[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)的两幅图对读写流程简略叙述后，重点详述 Pulsar 的 fencing 机制，其是保证 Pulsar 数据 CAP 特性中的 Consistency 一项的关键。

#### 2.1 写流程
---

Pulsar 的写流程如下图：

![](../pic/pulsar/pulsar_write.webp) 

Broker 接收到 client 的请求后，把数据写入 Qw 个 Bookie，收到 Qa 个 Bookie 的回应后，可以认为写成功。Kafka 中这个角色是由 client 自身完成的。

如果写流程中有 Bookie 返回错误或者超时没有返回，<font color=red>则 Broker 会用新的 Bookie 替换之</font>，并把数据写入其中的 Ledger/Fragment上。通过这个称之为 `Ensemble Change` 的方法能够保证 Pulsar 肯定能够写成功，而不是由于某个节点故障导致写流程阻塞住进而影响后面 Entry 的写流程。

如果写流程中 Pulsar Broker 发生崩溃，Failover 流程【#2.3 fencing#小节会详述之】完成后，新的 Pulsar Broker 会关闭上个 Broker 写的 Ledger，而后创建新的 Ledger 进行写入。

Pulsar Bookie 是一种日志型存储引擎，每条 Log 称之为 Entry，每个 Log 的 ID 称谓 Entry ID。Entry ID 从0开始有序递增，<Ledger ID, Entry ID> 即唯一的确定了一个 Entry 的坐标。

Pulsar 可以缓存写流程中的部分尾部数据用于加快 client 的读取数据流程，并记下最后一条写成功的消息的 ID（Last Add Confirmed ID，称之为 LAC），可以用来检验读请求的合法性。所有 Entry ID 小于 LAC 的即可确认是 commited index，都可以被安全读出。

与 LAC 相应的，Pulsar 还有一个称谓 LAP 的概念，其全称为 Last-Add-Pushed，即已经发送给 Bookie 但是尚未收到 Ack 的日志条目，整个机制类似于 TCP 发送端的滑动窗口。

#### 2.2 读流程
---

Pulsar 的读流程如下图：

![](../pic/pulsar/pulsar_read.webp) 

Kafka 的 Consumer 会从 Partition 对应的 leader Broker 上读取数据，Pulsar 的 client 是从 Topic owner 对应的 Broker 读取数据。如果该 Broker 有缓存，则直接返回相应数据，否则就从任一个 Bookie 读取数据并返回给 client。

一个新的 Pulsar Broker 发起读取请求之前，需要知道 Pulsar 集群的 LAC，Broker 会向所有 Bookie 发送获取 LAC 请求，得到大多数回复后即可计算出一个安全的 LAC 值，这个流程就是采用了 Quorum Read 的方式。 

Pulsar Broker 获取可靠的 LAC 之后，其读取可以从任一 Bookie 开始，如果在限定时间内没有响应则给第二个 Bookie 发送读取请求，然后同时等待这两个 Bookie，谁先响应就意味着读取成功，这个流程称之为 Speculative Read。

#### 2.3 fencing
---

上面提到 Pulsar Broker 本质上是一个 Proxy，其区别就是自身是无状态的：不存储任何状态数据。Broker 决定了数据如何分片，保证数据一致性，具有常见分布式系统 leader-follower 架构中 leader 的部分职权：当一个 Topic owner 所在的 Broker 宕机时，要选举出一个新的 Broker 作为 Topic owner。同 Raft leader 选举一样，选举过程中不处理数据读写请求。

[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)描述了整个选举流程如下：

- 1 Topic X 的当前拥有者(B1)不可用(通过Zookeeper);
- 2 其他Broker(B2)将Topic X 的当前Ledger状态从OPEN修改为IN_RECOVERY;
- 3 B2向Ledger的当前Fragment的Bookies发送fence信息并等待(Qw-Qa) + 1个Bookies响应。收到此响应数后Ledger将变成fenced。如果旧的Broker仍然处于活跃状态则无法再进行写入，因为无法获得Qa确认(由于fencing导致异常响应);
- 4 B2然后从Fragment的Bookies获得他们最后确认的条目是什么。它需要最新条目的ID，然后从该点开始向前读。它确保从哪一点开始的所有条数(可能以前未向Pulsar Broker承认)都会被复制到Qw Bookies。一旦B2无法读取并复制任何条目，Ledger将完全恢复;
- 5 B2将Ledger的状态更改为CLOSED;
- 6 B2现在可以创建新的Ledger并接受写入请求。

整个流程 Pulsar 称之为 fencing。如果对 Codis 数据迁移流程了解的人应该会觉得这个流程与 Codis Migration 操作流程甚是相似，[参考文档4](https://www.csdn.net/article/2015-02-02/2823796-spark-codis-crazyjvm-goroutine/2)给出了 Codis Migration 流程如下：

![](../pic/pulsar/codis_migration.jpg) 

Codis 也是一种基于 Proxy 的分布式存储系统，架构实质与 Pulsar 无多大差别，所以二者流程类似也在清理之中。Fencing 本质就是一个分布式加锁协议，与 2PC 协议类似，本质上与多 CPU core 之间数据一致性协议 MESI 协议也无差。

#### 2.4 Bookie 数据读写流程
---

Pulsar 的数据最终是靠 Bookkeeper(Bookie) 落地的，其数据写流程如下：

- 1 将写请求记入 WAL；
- 2 将数据写入内存缓存中；
- 3 写缓存写满后，进行数据排序并进行 Flush 操作，排序时将同一个 Ledger 的数据聚合后以时间先后进行排序，以便数据读取时快速顺序读取；
- 4 将 <(LedgerID, EntryID), EntryLogID> 写入 RocksDB。

    > LedgerID 相当于 kafka 的 ParitionID，EntryID 即是 Log Message 的逻辑 ID，EntryLogId 就是 Log消息在 Pulsar Fragment文件的物理 Offset。
    
整个写入流程 Bookie 除了自身把内存缓存数据批量刷盘一步外，整个流程几乎不需要跟磁盘进行IO，所以速度也是极快。

其读取流程如下：

- 1 从写缓存读取数据【因为写缓存有最新的数据】；
- 2 如果写缓存不命中，则从读缓存读取数据；
- 3 如果读缓存不命中，则根据 RocksDB 存储的映射关系查找消息对应的物理存储位置，然后从磁盘上读取数据；
- 4 把从磁盘读取的数据回填到读缓存中；
- 5 把数据返回给 Broker。

整个读写流程借用[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)一图描述如下：

![](../pic/pulsar/pulsar_data_storage.webp)

如果 Bookie 意外崩溃，则其重启后需要进行数据恢复，执行这个任务的流程称之为 AutoRecoveryMain。AutoRecoveryMain 任务是由若干个 worker 线程构成的线程池执行的，每个 worker 线程从由自己负责的 zookeeper path 上找到要恢复数据的 Ledger 进行数据复制。

## 参考文档

> 1 [理解Apache Pulsar工作原理](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)  
> 2 [Twitter高性能分布式日志系统架构解析](https://mp.weixin.qq.com/s/0dkgA8swNPkpcY5H6CU62w)  
> 3 [Kafka vs Pulsar - Rebalancing (Sketch)](https://jack-vanlightly.com/sketches/2018/10/2/kafka-vs-pulsar-rebalancing-sketch)  
> 4 [
Spark生态系统解析及基于Redis的开源分布式服务Codis](https://www.csdn.net/article/2015-02-02/2823796-spark-codis-crazyjvm-goroutine/2)

## 扒粪者-于雨氏 ##

> 2018/10/18，于雨氏，初作此文于西二旗。
> 
> 2018/10/20，于雨氏，于丰台完成 # 2 Pulsar 读写过程 #。

