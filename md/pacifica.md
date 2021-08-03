## PacificA 要点 ##
---
*written by Alex Stocks on 2021/07/25，版权所有，无授权不得转载*
 

## 数据复制

 Log Replication 流程：

1. update Op 进入 Primary，Primary 为其分配一个单调递增的序号 sn，并将其按序插入到 prepare list 中
2. Primary 通过 prepare message 将其发送给 Secondary，并携带上 configuration version，当 Secondary 收到记录之后，会首先比较 configuration version，如果相同，则将其有序的插入到自己的 prepare list，并返回 acknowledgment 给 Primary；
3. 一旦 Primary 收到所有 Secondary 的响应，那就将 commit list 中的 committed point 就可以向前移动，
4. Primary 返回 client，并给向 Secondary 发送 committed 消息，必要的时候 committed point 可以通过下一次的 prepare message 带过去

写过程很重：leader 需要复制给所有的 follower，保证所有 follower 数据都是最新的。其好处是任何一个 follower 发现网络分区时，都可以不经投票快速宣布自己是 leader，缺点是：

* 1 如果有慢节点或者网络抖动，则写过程 latency 会增加
    * 如果保证机器规格一致，在局域网环境下这个问题几乎不可能成为瓶颈。论文中也强调 `we focus our attention on a local-area network based cluster environment`。

* 2 发生节点变更，则整个写过程也会卡住
    * 发生概率低，影响不大。另外，在 azure storage stream layer 也是使用这种强一致复制，为了减少这种影响，azure storage 的 stream layer 设计成 append only，

     
## Lease 和 失败探测

Pacifica 的心跳方向是：Primary -> Secondary，相比 GFS 从 Master 续租，这种复制组内部维持 Lease（decentralized implementation eliminates loads and dependencies on a centralized entity），可以减小 Leader 的压力，而且在一定程度上可以缩短租约的有效期，从而提高可用性。

grace_period > lease_period > beacon_interval * 2
其中 beacon_interval 就是 heartbeat，其中，grace_period：Secondary timeout > lease_period：Primary timeout，可以保证 Primary 总会先于 Secondary timeout。

Configuration change
一旦通过上面的Failure Detection 发现了错误，就会触发 Configuration change（配置变更），确保存储集群恢复服务，保证可用性。

（1）Removal of Secondaries
Primary 在一定时间内（lease period）未收到 Secondary 对心跳的回应，那 Primary 认为 Secondary异常
它也将自己降级不再作为 Primary，停止处理 new request
向配置管理服务汇报更新复制组，将该下线 Secondary 节点从复制组中移除
Primary 把新的复制组修改到本地（拥有新的 configuration version），并重新变成 Primary，恢复服务
因为是强一致，一旦一个 Secondary 不在，那么复制就没有办法继续了。所以 Primary 需要剔除 Secondary。但是这里需要注意的，一旦 Primary 发现 Secondary 不在了，也就是自己的租约的过期了。这里是因为 Primary 的租约是由所有 Secondaries 来保证，租约过期了，自然必须停止服务，否则就可能产生双主，例如步骤 3 Primary 发送给配置管理服务的配置变更消息由于网路延迟的原因，落后于 Secondary 发送配置变更信息给配置管理服务，那么将会出现双主。实际上这种情况会有两种可能性：

尽管 Primary 先于 Secondary timeout，但是 Primary 的配置变更信息由于网络延迟的原因，或者和配置管理服务局部的网络分区，导致这个消息未能尽快到达，且慢于 Secondary 的配置变更消息
所谓的 timeout，在程序的实现中，都是基于定时器实现，但是定时器的精度本身是有限，而且可能在极端的负载的情况，导致定时器出现一个较大的 timeout 的偏差
实际上第 4 就是通过配置管理服务实现 Primary 续租，所以又可以开始提供服务了.

（2）Change of Primary
如果 Secondary 节点在一定时间内（grace period）未收到 Primary 节点的心跳信息，那么其认为Primary 节点异常（lease period < grace period，保证从节点检测到主节点异常则是在主节点停止作为主以后，此时该副本集是不存在 Primary 了）
于是向配置管理服务汇报更新复制组配置变更，将 Primary 节点从复制组中移除
同时将自己提升为新的 Primary，但是并不开始 process new request
执行 reconciliation process（保持 Secondary 节点和 Primary 节点的数据一致性 ）
完成 reconciliation ，开始处理 new request
（3）Addition of New Secondaries
新的 replica 以 candidate secondary （Learner）的身份加入，Primary 正常处理 update，并发 prepare message 给 candidata secondary
Learner 同时恢复其他不在 prepared list 中数据
一旦 Learner 追上其他 replica，并且没有发生任何异常，Primary 向配置管理服务汇报新 Replica-group，将 Learner 加入 Replica-group，Learner 转变成 Secondary，Recovery 完成
实际上 Recovery 一般就是通过（3）新增 Secondary 来实现的

Notes

配置变更每次都会携带上配置的版本号到配置管理服务，如果版本号小于配置管理服务上面的配置版本，那么自己配置变更就会失败，仅仅学习配置管理服务上面的最新配置



 

## 参考文档 ##

- 1 [Kafka Compression Performance Tests](http://blog.yaorenjie.com/2015/03/27/Kafka-Compression-Performance-Tests/)

## Payment

<center> ![阿弥托福，于雨谢过](../pic/pay/wepay.jpg "阿弥托福，于雨谢过") &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ![无量天尊，于雨奉献](../pic/pay/alipay.jpg "无量天尊，于雨奉献") </center>


## Timeline ##

* 2017/02/02，于雨氏，于致真大厦。





