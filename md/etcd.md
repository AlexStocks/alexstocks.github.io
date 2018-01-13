## etcd使用经验总结 ##
---
*written by Alex Stocks on 2018/01/09*


### 0 说明 ###
---

为分布式集群提供一致性服务的组件，先有google内部的Chubby，后有hadoop生态的zookeeper。基于Java的zookeeper保证CP，但是廉颇老矣——个人以往的同事曾经测试过在三千左右的客户端的频繁读写情况下zookeeper会频繁死掉。相对zookeeper等同类产品，coreos开发的同样保证CP的etcd的优点自不必说，容器时代的王者kubuernets依赖它可实现上万个容器的管理。

近日在单机上部署了一个etcd静态集群和基于这个静态集群的动态集群，并进行了相关测试，本文是部署以及测试过程的遇到的相关问题的流水账，权做记忆，以备后来参考。

etcd目前主要有v2和v3两个版本，但v3比v2在API层做了大幅度的优化，且etcd2客户端经过解析优化后与etcd3的消息处理性能仍然有2倍的差距，而v2的JSON外部协议和集群内部协议在v3中同样支持，所以本文以v3为主。个人使用etcd的体会：etcd与其说是一个提供一致性服务的分布式系统，不如说是一个分布式kv数据库。

### 1 静态集群 ###
---

关于集群如何部署，其实参考文档1已经有详细说明，本节只说明我自己测试时的使用方式。

etcd单节点启动命令如下：

	etcd --name=${name} \
        --data-dir=${data_dir} \
        --wal-dir=${wal_dir} \
        --auto-compaction-retention=1 \
        --quota-backend-bytes=$((160*1024*1024*1024)) \
        --max-request-bytes 1536 \
        --initial-advertise-peer-urls http://${ip}:${peer_port} \
        --listen-peer-urls http://${ip}:${peer_port} \
        --listen-client-urls http://${ip}:${client_port},http://127.0.0.1:${client_port} \
        --advertise-client-urls http://${ip}:${client_port} \
        --initial-cluster-token ${cluster_name} \
        --initial-cluster etcd_node0=http://${ip}:${peer_port},etcd_node1=http://${peer1_ip}:${peer1_peer_port},etcd_node2=http://${peer2_ip}:${peer2_peer_port} \
        --initial-cluster-state new  >> ${log_dir}/${name}.log 2>&1 &

各个参数的详细意义见参考文档17，下面列出一些主要参数的含义如下：   

- 1 name是node的名称，用于在集群中标识当前节点，etcd单节点允许迁移，迁移后名称不变即可被其他节点识别；
- 2 etcd底层使用的kv数据库coreos/bbolt是类似于Rocksdb的一个LSM数据库实现，与Rocksdb一样数据有wal和data两种，建议两种数据分别存储到不同的存储系统上，以保证数据安全和系统性能；
- 3 etcd底层使用的coreos/bbolt类似于rocksdb会定期做compaction以清除过期数据，上面的auto-compaction-retention指定的时间单位是小时，当然也可以借助工具etcdctl强行进行compaction，使用方法详见参考文档9#History compaction#一节；
- 4 参考文档9#Space quota#一节建议给etcd限定磁盘使用量，以防止etcd无限度的使用磁盘导致磁盘爆满后再去做compaction导致系统响应速度下降进而导致系统不稳定，当etcd使用的磁盘额度到达限定额度的时候会发出cluster级别的alarm使集群进入maintenance模式，只接收读和删除请求，当进行compaction和defragmenting(碎片化整理)完毕留出足够空间的时候才会回到正常工作状态；
- 5 max-request-bytes可以限制key的最大长度，此处限制长度为15KiB；
- 5 initial-cluster-token用于标识集群的名称，initial-cluster则给出了静态cluster的各个成员的名称以及地址；
- 6 initial-cluster-state说明单节点启动时候的状态，节点重启时这个参数值改为 **existing**；
- 7 initial-cluster列出了cluster的初始成员，cluster启动后可通过命令 **etcdctl member update** 进行更改；
- 8 --force-new-cluster这个选项用于创建一个单节点集群； 

集群部署完毕后，可以借助etcdctl查看集群的成员列表以及集群运行状态。etcdctl自身也分为v2和v3两个版本，集群状态的查看可借助其v2版本，使用方式如下：
    	
	export ETCDCTL_API=2
	echo "-----------------member list----------------"
	etcdctl --endpoints=“http://localhost:2379” member list
	echo "-----------------cluster health-------------"
	etcdctl --endpoints=“http://localhost:2379“ cluster-health
	
静态集群自身也是可以扩容的，具体扩容方法见参考文档6和参考文档7。

### 1.1 更改client的advertise-client-urls ###
---

参考文档7#Update advertise client URLs#提到如果想更改这个参数，只需要在配置文件中把参数值更改后，重启实例即可。

### 1.2 更改client的advertise-peer-urls ###
---

参考文档7#Update advertise peer URLs#给出了更改这个参数的方法：
> 1 执行命令 **etcdctl member update a8266ecf031671f3 http://10.0.1.10:2380** 以告知cluster内其他成员这个节点的新地址；
> 2 更改节点配置，重启节点，以恢复节点的quorum。

### 1.3 添加一个节点 ###
---

具体详细步骤见参考文档7#Add a New Member#一节，下面给出操作过程：
   
> 1 ETCDCTL_API=3 etcdctl --endpoints=http://192.168.11.1:2379,http://192.168.11.1:12379,http://192.168.11.1:22379 member add etcd_node3 --peer-urls=http://192.168.11.1:32379   
>    
>     ETCD_NAME="etcd_node3"
>     ETCD_INITIAL_CLUSTER="etcd_node1=http://192.168.11.1:12380,etcd_node2=http://192.168.11.1:22380,etcd_node0=http://192.168.11.1:2380,etcd_node3=http://192.168.11.1:32379"
>     ETCD_INITIAL_CLUSTER_STATE="existing"
>
> 2 etcd --name=etcd_node3 \
	--data-dir=/tmp/etcd/etcd_node3/./data/ \
	--wal-dir=/tmp/etcd/etcd_node3/./wal/ \
	--listen-peer-urls=http://192.168.11.100:32380 \
	--initial-advertise-peer-urls=http://192.168.11.100:32380 \
	--listen-client-urls=http://192.168.11.100:32379,http://127.0.0.1:32379 \
	--advertise-client-urls=http://192.168.11.100:32379 \
	--initial-cluster-state=existing \
	--initial-cluster="etcd_node2=http://192.168.11.100:22380,etcd_node1=http://192.168.11.100:12380,etcd_node0=http://192.168.11.100:2380,etcd_node3=http://192.168.11.100:32380"
	
一定要注意，”initial-cluster”里面一定要有新成员的peer地址。参考文档7#Strict Reconfiguration Check Mode#提到：etcdctl执行完毕”etcdctl member add“后，etcd cluster就把这个还未存在的node算进quorum了，**第二步必须准确完成**。
	
	如果仅仅通过命令”etcdctl member add“添加一个节点，但是不添加实际节点，然后就通过”etcdctl member remove“删除，则会得到如下结果：
	
	$ ETCDCTL_API=3 etcdctl --endpoints=http://192.168.11.100:2379,http://192.168.11.100:12379,http://192.168.11.100:22379 member add    etcd_node3 --peer-urls=http://192.168.11.100:32380
	Member e9cfc62cee5f30d1 added to cluster 63e8b43e8a1af9bc
	
	ETCD_NAME=“etcd_node3”
	ETCD_INITIAL_CLUSTER=“etcd_node2=http://192.168.11.100:22380,etcd_node1=http://192.168.11.100:12380,etcd_node0=http://192.168.11.100:2380,etcd_node3=http://192.168.11.100:32380”
	ETCD_INITIAL_ADVERTISE_PEER_URLS=“http://192.168.11.100:32380”
	ETCD_INITIAL_CLUSTER_STATE=“existing”
	
	$ etcdctl member remove 63e8b43e8a1af9bc
	Couldn't find a member in the cluster with an ID of 63e8b43e8a1af9bc.

可见如果不添加节点，这个理论上存在但是实际上不存在的node是不可能从quorum中剔除掉的。

### 1.4 删除一个节点 ###
---

具体详细步骤见参考文档7#Remove a New Member#一节，一个命令即可完成任务：

	$ etcdctl member remove a8266ecf031671f3
	Removed member a8266ecf031671f3 from cluster

在参考文档7#Error Cases When Adding Members#一小节中，提到一个node被remove后，如果再次重新启动，则会得到如下错误提示：

	$ etcd
	etcd: this member has been permanently removed from the cluster. Exiting.
	exit 1


## 2 动态集群 ##
---

当可以预估etcd集群的使用量以及明确知道集群的成员的时候，可以静态方式部署集群。但大部分情况下这两个无法确定的时候，可以使用动态方式部署集群。

动态方式部署etcd集群依赖于etcd具备的动态发现(官文成为discovery)功能：可以使用已有的etcd集群或者dns服务作为etcd通信数据pubsub节点，实现另一个集群中各个已有成员之间的服务发现和新成员的加入，进而实现集群的扩展。

个人倾向于以一个数量有限且压力不大的静态集群作为动态集群各个节点的discovery的基础。个人使用Elasticsearch多年，这种使用方式其实与Elasticsearch集群的部署方式雷同：先部署若干以控制角色启动的Elasticsearch节点组成一个discovery中心，然后各个以数据节点角色启动的Elasticsearch通过这个discovery中心实现服务发现。可见大道所行处，成熟的架构雷同。

在一个静态集群上创建channel如下：

	curl -X PUT "http://${registry_url}/v2/keys/discovery/testdiscoverycluster/_config/size" -d value=3


动态集群etcd单节点启动命令如下：

    etcd --name=${name} \
	    --data-dir=${data_dir} \
	    --wal-dir=${wal_dir} \
	    --auto-compaction-retention=1 \
	    --quota-backend-bytes=$((160*1024*1024*1024)) \
	    --max-request-bytes 1536 \
	    --initial-advertise-peer-urls http://${ip}:${peer_port} \
	    --listen-peer-urls http://${ip}:${peer_port} \
	    --listen-client-urls http://${ip}:${client_port},http://127.0.0.1:${client_port} \
	    --advertise-client-urls http://${ip}:${client_port} \
	    --discovery http://localhost:2379/v2/keys/discovery/testdiscoverycluster \
	    --initial-cluster-token ${cluster_name} >> ${log_dir}/${name}.log 2>&1 &  
   
可见不需要再指定集群内的各个成员，只需要指定discovery channel即可。
   
## 3 测试 ##
--- 

为了测试两种集群模式对集群成员变动的反应，分别进行一系列测试。

## 3.1 静态集群测试 ##
--- 

静态集群成员如果丢失数据或者改变名称，则再次加入集群后不会被接纳。

有作证明的测试过程1如下：

> 1 部署一个静态集群；   
> 2 以kill方式杀死一个成员，然后clear掉数据，重启失败；   

此时etcd的log显示一个critical级别错误log “etcdmain: member 7f198dd1e26bed5a has already been bootstrapped”。

有作证明的测试过程2如下：
> 1 部署一个静态集群；   
> 2 以kill方式杀死一个成员，然后给成员一个新名称，重启失败；

此时etcd的log给出critical级别错误log“etcdmain: couldn't find local name "etcd_node3" in the initial cluster configuration”。

修改名称等同于扩充集群，正确的操作步骤参见#1.3#节。

## 3.2 动态集群测试 ##
--- 

当动态集群启动后，集群内成员间即可相互通信，不依赖于原静态集群。有作证明的测试过程如下：

> 1 部署一个静态集群；   
> 2 以discovery方式在静态集群之上再部署一个动态集群；   
> 3 杀掉静态集群各个成员；   
> 4 通过etcdctl查看动态集群成员列表以及集群状态，成员不变，集群状态是healthy；   
> 5 向动态集群添加新成员失败；   
> 6 杀掉一个动态集群成员，再重新启动后成功加入动态集群；   
> 7 杀掉一个动态集群成员，清空其data_dir和wal_dir下数据，再重新启动后加入动态集群失败；

只要动态集群现有成员的数据还在，就能保证动态集群自身的稳定运行【参考文档6#Do not use public discovery service for runtime reconfiguration#也证实了这点】。又有作证明的测试过程如下：

> 1 部署一个静态集群；   
> 2 以discovery方式在静态集群之上再部署一个动态集群；   
> 3 杀掉动态集群各个成员，清空各个成员数据，然后分别启动之，这些成员加入动态集群失败；   
> 4 修改各个成员的name，然后再启动，加入动态集群成功；     

上面最后一步启动的各个节点，其实是以新node的身份加入了原动态集群。


## 4 分布式一致性 ##
---

目前etcd的同类产品很多，既有通过zab协议实现paxos的zookeeper，也有kafka自身在topic的partition级别实现的类似于raft的一致性的coordinator。

### 4.1 zookeeper ###
---

考虑到zookeeper集群是第一个流行起来的同类组件，已有很多分布式系统已经采用它，这些系统不可能为了使用etcd而重新开发，etcd为了与之兼容而在etcd v3之上开发了一个etcd代理：zetcd。

etcd v3基于grpc提供了REST接口，提供了PUT/DELETE/GET等类似HTTP的幂等原语，使之可在功能上与zookeeper等同，但是使用go开发的etcd性能可甩基于JVM的zookeeper好几条街【参考文档2】。etcd v3的协议与zookeeper不同，zetcd将ZooKeeper客户端的请求转换为适合于etcd数据模型和API要求的消息发送给etcd，然后将etcd的响应消息转换后返回给客户端。

个人建议把zetcd作为服务端环境的基础设置，在使用etcd集群提供的服务的每个系统上都部署一个，把原有依赖zookeeper服务的系统迁移到etcd之上。官方文档【参考文档3】中提到使用proxy的好处是：当etcd cluster成员变动比较大的时候，proxy自动把失效的成员从可用etcd member list中剔除掉，并发送心跳包去探测其是否活过来。

参考文档3说别指望一个proxy对系统性能提高有大的帮助，参考文档8的#Limitions#指出有些情况下还可能造成watch返回的结果不正确。

至于zetcd如何使用本文不再详述。

### 4.2 Raft ###
---

etcd通过boltdb的MVCC保证单机数据一致性，通过raft保证集群数据的一致性。参考文档15#Operation#提到，raft的quorum一致性算法说来也就一句话：集群中至少(n+1)/2个节点都能对一个外部写操作或者内部集群成员更新达成共识。这个模型能够完全规避脑裂现象的发生。

如果raft集群中有处于unhealthy状态的node，需要先把它剔除掉，然后才能进行替换操作。但是添加一个新的node是一件非常高风险的操作：如果一个3节点的etcd集群有一个unhealthy node，此时没有先把unhealthy node剔除掉，而新添加节点时可能由于配置不当或者其他原因导致新的node添加失败，则新集群理论上node number为4而当前quorum只可能达到2，失去consensus的集群对任何操作都无法达成共识。

如果按照正确的操作步骤，先提出unhealthy node，此时n为2而quorum为2，添加新节点后n为3，及时添加新节点失败也不会导致集群不可用。

etcd通过设置配置文件中[strict-reconfig-check选项](https://github.com/coreos/etcd/blob/15bfc1b36162805e8a90ae747d955667870c2f95/etcd.conf.yml.sample#L70)为true，禁止任何危及quorum的行为。如果用户把这个选项设为false，则添加一个新节点就轻松多了，结果就是集群数据不一致，大部分情况下会收到"disk geometry corruption”之类的error log。

## 5 运行环境 ##
---

官方文档【参考文档4】给出了etcd稳定运行系统的一些硬件参考指标，本文精简如下：
> 1 CPU: 2~4 core即可保证etcd流畅运行，当每秒的请求成千上万时，CPU需要频繁地从内存加载数据，此时建议使用8 ~ 16个core；   
> 
> 2 Memory: 平常情况下8G内存即可保证etcd流畅运行，其中主要存储kv cache数据和客户端watch的数据，当处理的qps上万的时候，建议16 ~ 64GB的内存量，参考文档15#System requirements#提到etcd要求的内存最小容量是2GB；   
> 
> 3 Disk: 存储介质的质量是etcd运行performance和stability的关键，差劲的存储介质会导致延迟增加和系统不稳定。一般情况下顺序读写能达到50 IOPS(如7200RPM的磁盘)即可满足要求，当压力大的时候，要求能达到500 IOPS（SSD盘或者其他虚拟的block设备）。需要注意的是，一般云厂商提供的磁盘IOPS是并行而非顺序的，这个并行的指标一般是顺序指标的十倍以上，可以使用diskbench or fio工具去测试之。   
>         当etcd死掉重启后，为了快速恢复服务，etcd需要快速进行数据恢复。通常情况下恢复100MB数据需要15s（每秒10MB/s），在大etcd集群中要求1GB数据15s内恢复完毕（每秒100MB/s）。   
>         通常情况下建议使用SSD作为存储介质。如果用磁盘，要求能达到15,000 RPM的RAID0。 
>   
> 4 Network: 一般情况下1GbE（千兆）网卡可以保证稳定运行，对于大的集群则要求10GbE(万兆)网卡。不仅是速度，同时尽量把etcd集群部署在同一个IDC以保证网络稳定，否则很容易出现网络分区导致的集群被划分成大集群和小集群的情况。
> 
> 5 System: 拒参考文档5，etcd官方保证etcd可在amd64 + linux & ppc64Ie + linux上稳定运行，其他硬件凭他不推荐，由于go runtime在32-bit系统上的bug，也不推荐32位操作系统；
> 
> 6 Etcd： 集群的数目一般为3或者5即可，成员不是越多越好，参考文档7的#Change the cluster size#就提到etcd集群成员越多，leader的通信任务就越繁重，可能导致响应延迟上升，参考文档15 #What is maximum cluster size# 则提到Google Chubby认为最适宜的数目是5，最大数目为7。   
>          参考文档15#Should I add a member before removing an unhealthy member#一节提到，当集群出现unhealthy节点的时候，应该先下线这个节点，然后及时添加新节点以保证quorum。
> 
> 7 Go: 参考文档16#Best Practices#要求Go的最低版本是1.4。

### 5.1 与运行环境有关的faq ###
---

参考文档15列出了一些与运行环境有关的faq，列出如下。

### 5.1.1 “apply entries took too long” ###
---

etcd集群接受一个写请求后，每个etcd成员都需要把写请求数据固化到cores/bbolt之中，整个过程不要超过50ms。如果超过100ms，则etcd就会打印此条log进行警告。通常情况下是因为磁盘慢，比如磁盘竞争或者譬如虚拟块磁盘这种烂设备。etcd暴露给Prometheus的metrics指标backend_commit_duration_seconds就显示了commit的瓶颈时间，这个指标低于25ms即可认为服务正常，如果磁盘本身确实慢则设置一个etcd专用磁盘或者更换成SSD通常就能解决问题。

第二个原因是CPU计算力不足。如果是通过监控系统发现CPU利用率确实很高，就应该把etcd移到更好的机器上，然后通过cgroups保证etcd进程独享某些核的计算能力，或者提高etcd的priority。

或者有别的一些低速请求如有人要获取所有的key也会导致写请求受影响。

### 5.1.2 “failed to send out heartbeat on time” ###
---

etcd使用了raft算法，leader会定时地给每个follower发送心跳，如果leader连续两个心跳时间没有给follower发送心跳，etcd会打印这个log以给出告警。通常情况下这个issue是disk运行过慢导致的，leader一般会在心跳包里附带一些metadata，leader需要先把这些数据固化到磁盘上，然后才能发送。写磁盘过程可能要与其他应用竞争，或者因为磁盘是一个虚拟的或者是SATA类型的导致运行过慢，此时只有更好更快磁盘硬件才能解决问题。etcd暴露给Prometheus的metrics指标wal_fsync_duration_seconds就显示了wal日志的平均花费时间，通常这个指标应低于10ms。

第二种原因就是CPU计算能力不足。如果是通过监控系统发现CPU利用率确实很高，就应该把etcd移到更好的机器上，然后通过cgroups保证etcd进程独享某些核的计算能力，或者提高etcd的priority。

第三种原因就可能是网速过慢。如果Prometheus显示是网络服务质量不行，譬如延迟太高或者丢包率过高，那就把etcd移到网络不拥堵的情况下就能解决问题。但是如果etcd是跨机房部署的，长延迟就不可避免了，那就需要根据机房间的RTT调整heartbeat-interval，而参数election-timeout则至少是heartbeat-interval的5倍。

### 5.1.3 “snapshotting is taking more than x seconds to finish ...” ###
---

etcd会把kv snapshot发送给一些比较慢的follow或者进行数据备份。慢的snapshot发送会拖慢系统的性能，其自身也会陷入一种活锁状态：在很慢地收完一个snapshot后还没有处理完，又因为过慢而接收新的snapshot。当发送一个snapshot超过30s并且在1Gbps(千兆)网络环境下使用时间超过一定时间时，etcd就会打印这个日志进行告警。


### 5.1.4 “request ignored (cluster ID mismatch)” ###
---

etcd cluster启动的时候通过“initial-cluster-token”参数指定集群的名称。如果一个老集群已经tear down，但是还有部分成员活着，此时在老集群之上又部署新的集群之后，那些还活着的老成员会尝试连接新集群的各个成员，因为cluster token不一致新成员接收到请求后会报出这个warning。

避免这个错误的方法就是不要使用老集群的地址。

## 6 etcd op ##
---

etcd官方提供了一个万能的工具etcdctl，etcd的op工具都可以借助个工具完成。

### 6.1 snapshot ###
---

etcd v3兼容v2，所以进行数据操作前，需要检查数据的版本，参考文档13给出了一种查看etcd的数据的版本是否是v3的验证方式：

	ETCDCTL_API=3 etcdctl get "" --from-key --keys-only --limit 1 | wc -l

如果输出为0，则数据版本是v2。

参考文档9建议定期对etcd数据进行冷备，其#Snapshot backup#一节给出了冷备的用法：
 
 	$ etcdctl snapshot save backup.db
	$ etcdctl  --endpoints $ENDPOINT —write-out=table snapshot status backup.db
	+———————————+———————————+—————————————+————————————+
	|   HASH    | REVISION  | TOTAL KEYS  | TOTAL SIZE |
	+———————————+———————————+—————————————+————————————+
	| fe01cf57  |   10      |       7     |   2.1 MB   |
	+———————————+———————————+—————————————+————————————+

参考文档10#Snapshotting the keyspace#一节中提到了另一种方法：直接把数据目录member/snap/db下的数据拷贝备份。

至于用冷备数据如何恢复一个cluster，请参见参考文档10#Restoring a cluster#。

### 6.2 data migration ###
---

etcd集群的数据还可以进行数据迁移[migration]，可以采用离线或者在线两种方式，当数据量超过一定量的时候，参考文档13不建议进行在线恢复，建议直接把etcd cluster关停，备份数据然后拷贝到目的地，以离线方式重新启动etcd cluster。

#### 6.2.1 离线迁移 ####
---

首先把集群停服，然后变换etcd每个member的client服务端口再次重启，确保cluster各个成员的raft状态机达到同样的状态，这个可以通过命令 **ETCDCTL_API=3 etcdctl endpoint status** 确认，当所有member的raft index相等或者相差不超过1（raft内部的命令导致）时认为数据一致。

通过命令 **ETCDCTL_API=3 etcdctl migrate** 即可完成数据v2到v3的迁移，v3的数据格式是mvcc格式。数据迁移完毕可以通过命令 **ETCDCTL_API=3 etcdctl endpoint hashkv --cluster** 验证数据的一致性【注意这个命令只能在v3.3以上才可使用】。

但是对于v2中的TTL数据，如果数据commited时所在的member的raft index比leader的的index小，则数据迁移后可能导致数据不一致。

#### 6.2.2 在线迁移 ####
---

在线迁移的好处当然是不停服，但是前提是要求客户端使用v3版本的API。应用支持etcd cluster的migration mode和normal mode，etcd cluster运行在migration cluster期间，应用读取数据先使用v3 API，失败后再尝试v2 API。而在normal mode下应用只能使用v3 API。两种mode下写API只能使用v3。

migration mode下客户端会watch一个swtich mode key，当migration mode切换到normal mode后，这个key的value是true。服务端在migration mode下则会启动一个后台任务，使用v2 API读取数据然后调用v3 API写入mvcc存储引擎中。

参考文档13在文章末尾不建议采用online migration方式，因为这会导致客户端和etcd cluster之间的网络开销外，还会导致etcd自身冗余数据过多。

参考文档14#Limitations#提到：当一个集群有超过50MB的v2数据时，数据升级过程可能花费两分钟，如果超过100MB则可能花费更多时间。

### 6.3 data compaction和data defragment ###
---

etcd的compaction仅仅是合并一些文件并进行过去数据的删除，但是文件占用的磁盘可能有很多碎片，可以使用etcdctl完成碎片整理工作。

参考文档9#History compaction#给出了相关compaction使用方法：

	# keep one hour of history
	$ etcd --auto-compaction-retention=1

上面这种操作方法是通过时间窗口的策略让etcd自动压缩数据，还可以通过etcdctl命令手工进行数据压缩：

	# compact up to revision 3
	$ etcdctl compact 3

通过上面的命令手工压缩数据之后，revision 3之前的数据就被清理掉了，譬如：

	$ etcdctl get --rev=2 somekey
	Error:  rpc error: code = 11 desc = etcdserver: mvcc: required revision has been compacted

参考文档9#Defragmentation#给出了碎片整理相关使用方法：

	$ etcdctl defrag
	Finished defragmenting etcd member[127.0.0.1:2379]
	
如果etcd没有运行，可以直接作用于data目录：

	$ etcdctl defrag --data-dir <path-to-etcd-data-dir>

### 6.4 角色控制 ###
---

如果etcd被当初一个配置中心，此时角色控制就有必要了。参考文档11详细描述了如何借助etcdctl进行角色控制，不过还有一个更好用的带有UI界面的工具[e3w](https://github.com/soyking/e3w)，这个工具的界面是js实现的，通过它就可方便地进行角色创建。

## 7 API ##
---

参考文档11#Request Size Limitation#提到etcd为了防止一个大包请求把连接通道阻塞住，限制一个请求包大小在1MB以内。

### 7.1 Client Request Timeout ###
---

参考文档16#Client Request Timeout#提到当前各种请求的超时参数还不能被修改，这里也给出了各个类型的超时参数：
> 1 Get: 不可设置，应为get请求底层处理是异步的；   
> 2 Watch: 不可设置，除非用户主动取消或者连接中断；   
> 3 Delete, Put, Post, QuorumGet: 默认5s，官方认为5s能够满足绝对部分情况下的超时要求；   

其他情况下如果发生超时的情况，则可能有两种原因：处理请求的server不能提供正常服务，或者集群失去了quorum。

如果客户端请求超时多次发生，系统管理员应该去检查系统的运行情况。

### 7.2 KV ###
---

参考文档18提到etcd大部分API都是对KV对的请求和操作。etcd kv的protobuf定义如下：

	message KeyValue {
  		bytes key = 1;
  		int64 create_revision = 2;
  		int64 mod_revision = 3;
  		int64 version = 4;
  		bytes value = 5;
  		int64 lease = 6;
	}



## 参考文档 ##
---

- 1 [Clustering Guide](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/clustering.md)
- 2 [Exploring Performance of etcd, Zookeeper and Consul Consistent Key-value Datastores](https://coreos.com/blog/performance-of-etcd.html)
- 3 [When to use etcd gateway](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/gateway.md#when-to-use-etcd-gateway)
- 4 [hardware](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/hardware.md)
- 5 [supported platform](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/supported-platform.md)
- 6 [runtime reconf design](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/runtime-reconf-design.md)
- 7 [Runtime reconfiguration](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/runtime-configuration.md)
- 8 [gRPC proxy](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/grpc_proxy.md)
- 9 [Maintenance](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/maintenance.md)
- 10 [Disaster recovery](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/recovery.md)
- 11 [ole-based access control](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/authentication.md)
- 12 [Overview](https://github.com/coreos/etcd/blob/master/Documentation/rfc/v3api.md)
- 13 [Migrate applications from using API v2 to API v3](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/v2-migration.md)
- 14 [Upgrade etcd from 3.1 to 3.2](https://github.com/coreos/etcd/blob/master/Documentation/upgrades/upgrade_3_2.md)
- 15 [faq](https://github.com/coreos/etcd/blob/master/Documentation/faq.md)
- 16 [Administration](https://github.com/coreos/etcd/blob/master/Documentation/v2/admin_guide.md)
- 17 [Configuration Flags](https://github.com/coreos/etcd/blob/master/Documentation/v2/configuration.md)
- 18 [etcd3 API](https://github.com/coreos/etcd/blob/master/Documentation/learning/api.md)

## 扒粪者-于雨氏 ##

> 2018/01/09，于雨氏，初作此文于西二旗。
