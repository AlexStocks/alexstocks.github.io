## Pulsar笔记
---
*written by Alex Stocks on 2018/10/16，版权所有，无授权不得转载*

刚开始看 Apache Pulsar 一些资料，后面逐步补充。

### 1 Pulsar vs Kafka
---

很多人查看 Pulsar 之前可能对 Kafka 很熟悉， 根据个人对[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)的理解，整理如下**Pulsar 和 Kafka名词对应列表**：

| Pulsar | Kafka |
| :---- | :--- |
| Topic | Topic |
| Partition | Ledger |
| Segment | Fragment |
| Broker | Bookie |
| Ensemble Size | Broker Number |
| Write Quorum Size (Qw) | Replica Number |
| Ack Quorum Size (Qa) | request.required.acks |

#### 1.1 Kafka 的缺陷
---

[参考文档1](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ) 给出了 Kafka 的一些不足：

- 1 对于kafka，每个Partition副本都完整的存储在kafka节点上，Partition以及Partition副本由一系列的Segment和索引文件组成，优点在于简单快捷，不好的是，单个节点必须有足够的磁盘空间来处理副本，因此非常大的副本可能会迫使你是用非常大的磁盘。
- 2 在集群扩展时必须做Rebalance，这个过程是比较痛苦的，需要良好的计划和执行来保证没有任何故障的情况下分散节点的存储压力。

比较才有优劣。相比 Pulsar，Kafka 的存储模型的缺陷导致了其负载均衡能力的不足，[参考文档3](https://jack-vanlightly.com/sketches/2018/10/2/kafka-vs-pulsar-rebalancing-sketch) 对这点很形象地以下图说明之。

![](../pic/KafkaPulsarScaling.png) 

#### 1.2 Pulsar
---

Pulsar 的底层数据在 BookKeeper 上存储，Topic被分割成Ledgers，Ledgers被分割成Fragments分布在Fragment使用的Bookies上。当需要做集群扩展时，只需添加更多Bookies，它们就会在创建新的Fragment时开始在的Bookies上写入数据，不再需要kafka的Rebalance操作。但是，读取和写入现在在Bookies之间跳跃。

这个元数据存储在Zookeeper中，Pulsar Broker都需要跟踪每个Topic所包含的Ledgers和Fragments。

## 参考文档

> 1 [理解Apache Pulsar工作原理](https://mp.weixin.qq.com/s/CIpCLCxqpLoQVUKz6QeDJQ)  
> 2 [Twitter高性能分布式日志系统架构解析](https://mp.weixin.qq.com/s/0dkgA8swNPkpcY5H6CU62w)  
> 3 [Kafka vs Pulsar - Rebalancing (Sketch)](https://jack-vanlightly.com/sketches/2018/10/2/kafka-vs-pulsar-rebalancing-sketch)

## 扒粪者-于雨氏 ##

> 2018/10/18，于雨氏，于西二旗。

