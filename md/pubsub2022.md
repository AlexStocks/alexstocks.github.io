## 对 2017 年一套 IM 系统的反思 
---
*written by Alex Stocks on 2022/02/19，版权所有，无授权不得转载*

十来年前，个人开始工作时入行的行业就是即时通信系统的开发，前前后后参与或者主导了六七个 IM 系统的研发。上一次开发的 IM 系统的时间点还是 2018 年，关于该系统的详细描述见 [一套高可用实时消息系统实现][1] 一文。这篇文章被 52im 网站更名为 [一套高可用、易伸缩、高并发的IM群聊、单聊架构方案设计实践][2] 发出后产生了广泛的影响力，个人也在文章下面进行了一些答疑。

当时这套系统是在物理机环境中运行的，其可伸缩特性【某大厂谓之 “弹性”】依赖于运维人员的手工操作，其实是颇为繁琐且费时费人力的。2018 年云原生时代已然来临，开发完这套系统后，个人曾想与运维同事合作把它在 k8s 环境运行起来，以解决这个问题。但囿于当时公司的技术实力，以及当时自己的水平限制，这个工作就没再进行，个人也接了蚂蚁集团的从事云原生 Service Mesh 工作的 offer。

这三年来的云原生方面的工作的确让我眼界大开。站在当下 [20220219] 这个时间节点，回头对这套系统进行审视，觉得其还有大量的可改进之处，且对 IM 系统的认知又增进了一个层次。

### <a name="0">0 数据类型</a>
---

个人陋见，所谓数据，必须区分好类型，才能分别处理。譬如以前把数据分为 kv【如 redis 的数据】、结构化【如 rdbms 的数据】、blob【如多媒体的富文本】 等类型的数据，分别使用不同的数据库。

就算是结构化数据，根据数据类型，也分为流水型数据和状态型数据。

流水型数据如交易单据，类似于时序或者log型数据，每个数据都有意义，都一个 id，这个 id 里面都有弹性位标识，就算在 group[shard] 内发生了弹出，不用做数据迁移。类似于 MVCC 数据，每个版本号的数据都有意义。

状态数据类似于 MVCC 的最终状态，每个 key 只有最终状态的数据有意义，类似于 zk 的 kv，在进行数据弹出的时候，要停写甚至是停服，进行数据的物理迁移。CP 系统对状态数据实时一致性要求比较高，而 AP 系统则对状态数据的实时性要求稍次之，做到最终一致即可。

IM 系统的数据流有两种：Room Message（房间聊天消息）和Gateway Message（用户登录消息）。Group Message 可以认为是流水型数据，每个数据都是有效的，而 Gateway Message 则是实时性要求非常高的状态数据。


### <a name="1">1 2017 年系统的可改进之处</a>
---

* proxy 没有更好的负载均衡与熔断策略
* broker 没有限流
*  可伸缩机制采用了翻倍法，其好处是路由规则足够简单，缺点是会造成资源的浪费，应该有更好的路由规则，某个 group 内可根据热度进行局部可伸缩
*  在 k8s 环境可以单独部署一个 IM Operator，负责每个 broker group 的弹性伸缩
*  broker 到 gateway 的消息流推送机制过于机械，可以采用分级窗口策略
   * 1 gateway 与 broker 之间如果在 1ms 之内消息窗口内数量差异小于 100，则 broker 认为这个 gateway 能实时地处理数据，把它放入 alive 队列，批量地把 1ms 以内的消息推送到 gateway； 
   * 2 gateway 与 borker 之间如果在 1ms 内消息窗口内数据量差异大于 100 小于 1000，则 broker 认为这个 gateway 处理能力欠佳，把它放入 weakness 队列，批量地把 10ms 以内的消息推送到 gateway；
   * 3 gateway 与 borker 之间如果在 1ms 内消息窗口内数据量差异大于 1000，则 broker 认为这个 gateway 处理能力欠佳，把它放入 dying 队列，broker 不再给这个 gateway 推送消息，gateway 自己主动到 broker 拉取消息；
   * 4 gateway  与 broker 的心跳时间间隔根据其在队列的不同采用不同的时间间隔：
   * 5 broker 根据 gateway 与其之间的消息窗口内数据量差异动态放入不同的队列，然后采取不同的推拉策略下发消息。

[^参考文档]: 

[1]:https://alexstocks.github.io/html/pubsub.html
[2]:http://www.52im.net/thread-2015-1-1.html

## Payment

<div>
<table>
  <tbody>
  <tr></tr>
    <tr>
      <td align="center"  valign="middle">
        <a href="" target="_blank">
          <img width="100px"  src="../pic/pay/wepay.jpg">
        </a>
      </td>
      <td align="center"  valign="middle">
        <a href="" target="_blank">
          <img width="100px"  src="../pic/pay/alipay.jpg">
        </a>
   </tbody>
</table>
</div>

## Timeline ##

>- 于雨氏，2022/02/19，初作此文于朝阳黄金场。
