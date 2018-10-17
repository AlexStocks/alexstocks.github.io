## Pulsar笔记
---
*written by Alex Stocks on 2018/10/16，版权所有，无授权不得转载*

刚开始看 Apache Pulsar 一些资料，后面逐步补充。

### 1 Pulsar vs Kafka
---

很多人查看 Pulsar 之前可能对 Kafka 很熟悉，下面详述二者的异同以明确 Pulsar 的特点。

#### 1.1 Kafka 的缺陷
---

[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ) 给出了 Kafka 的一些不足：

- 1 Kafka 每个 Partition replica 都完整的存储在kafka节点上，Partition 以及 Partition replica 由一系列的 Segment 和索引文件组成，整个架构简单快捷，但是单个节点必须有足够的磁盘空间来处理副本；
- 2 在集群扩展时必须做 Rebalance，需要 Broker 有良好的执行流程保证没有任何故障的情况下分散节点的存储压力。

比较才有优劣。相比 Pulsar，Kafka 的存储模型的缺陷导致了其负载均衡能力的不足，[参考文档3](https://jack-vanlightly.com/sketches/2018/10/2/kafka-vs-pulsar-rebalancing-sketch) 对这点很形象地以下图说明之。

![](../pic/pulsar/KafkaPulsarScaling.png) 

Pulsar 的底层数据 以 Fragments 形式存储在多个 BookKeeper 上，当集群扩容添加 Bookies 后，Pulsar 会在新的Bookie上创建新的 Fragment，所以不需要再扩容时候像 Kafka 一样进行 Rebalance 操作。但是这样的结果就是同一个 Ledger 的 Fragments 分布在多个 Bookie 上，导致读取和写入会在多个 Bookies 之间跳跃。Topic的 Ledger 和 Fragment 之间映射关系等元数据存储在Zookeeper中，Pulsar Broker 需要实时跟踪这些关系进行。

Pulsar 的 metadata 存储在 zookeeper 上，而消息数据存储在 Bookkeeper 上。Broker 虽然需要这些 metadata，但是其自身并不持久化存储这些数据，所以可以认为是无状态的。

#### 1.2 名词对应表
---

 根据个人对[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)的理解，整理如下**Pulsar 和 Kafka名词对应列表**：

| Pulsar | Kafka |
| :---- | :--- |
| Topic | Topic |
| Partition | Ledger |
| Segment | Fragment/Segment |
| Broker | Bookie |
| Ensemble Size | Broker Number |
| Write Quorum Size (Qw) | Replica Number |
| Ack Quorum Size (Qa) | request.required.acks |

writing.

### 2 Pulsar 读写过程
---

### 2.1 fencing
---

fencing 本质就是一个分布式加锁协议，与 2PC 协议类似，本质上与多 CPU core 之间数据一致性协议 MESI 协议无差。

![](../pic/pulsar/pulsar_write.webp) 

writing.

## 参考文档

> 1 [理解Apache Pulsar工作原理](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)  
> 2 [Twitter高性能分布式日志系统架构解析](https://mp.weixin.qq.com/s/0dkgA8swNPkpcY5H6CU62w)  
> 3 [Kafka vs Pulsar - Rebalancing (Sketch)](https://jack-vanlightly.com/sketches/2018/10/2/kafka-vs-pulsar-rebalancing-sketch)

## 扒粪者-于雨氏 ##

> 2018/10/18，于雨氏，于西二旗。

