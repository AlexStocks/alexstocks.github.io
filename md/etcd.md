## etcd使用经验总结 ##
---
*written by Alex Stocks on 2018/01/09*


### 0 说明 ###
---

为分布式集群提供一致性服务的组件，先有google内部的Chubby，后有hadoop生态的zookeeper。基于Java的zookeeper保证CP，但是廉颇老矣——个人以往的同事曾经测试过在三千左右的客户端的频繁读写情况下zookeeper会频繁死掉。相对zookeeper等同类产品，coreos开发的etcd的优点自不必说，容器时代的王者kubuernets依赖它可实现上万个容器的管理。

近日在单机上部署了一个etcd静态集群和基于这个静态集群的动态集群，并进行了相关测试，本文是部署以及测试过程的遇到的相关问题的流水账，权做记忆，以备后来参考。

etcd目前主要有v2和v3两个版本，各有优点，本文都有使用，但以v3为主。个人使用etcd的体会：etcd与其说是一个提供一致性服务的分布式系统，不如说是一个分布式kv数据库。

### 1 静态集群 ###
---

关于集群如何部署，其实参考文档1已经有详细说明，本节只说明我自己测试时的使用方式。

etcd单节点启动命令如下：

	etcd --name=${name} \
        --data-dir=${data_dir} \
        --wal-dir=${wal_dir} \
        --initial-advertise-peer-urls http://${ip}:${peer_port} \
        --listen-peer-urls http://${ip}:${peer_port} \
        --listen-client-urls http://${ip}:${client_port},http://127.0.0.1:${client_port} \
        --advertise-client-urls http://${ip}:${client_port} \
        --initial-cluster-token ${cluster_name} \
        --initial-cluster etcd_node0=http://${ip}:${peer_port},etcd_node1=http://${peer1_ip}:${peer1_peer_port},etcd_node2=http://${peer2_ip}:${peer2_peer_port} \
        --initial-cluster-state new  >> ${log_dir}/${name}.log 2>&1 &

各个参数的详细意义本文不作解释，只给出主要参数的含义如下：   

- 1 name是node的名称，用于在集群中标识当前节点，etcd单节点允许迁移，迁移后名称不变即可被其他节点识别；
- 2 etcd底层使用的kv数据库coreos/bbolt是类似于Rocksdb的一个LSM数据库实现，与Rocksdb一样数据有wal和data两种，建议两种数据分别存储到不同的存储系统上，以保证数据安全和系统性能；
- 3 initial-cluster-token用于标识集群的名称，initial-cluster则给出了静态cluster的各个成员的名称以及地址；
- 4 initial-cluster-state说明单节点启动时候的状态，节点重启时这个参数就不要在用了(但是测试过程中重启且没有注释掉该参数并未发现异常)；

集群部署完毕后，可以借助etcdctl查看集群的成员列表以及集群运行状态。etcdctl自身也分为v2和v3两个版本，集群状态的查看可借助其v2版本，使用方式如下：

    	
	export ETCDCTL_API=2
	echo "-----------------member list----------------"
	etcdctl --endpoints=“http://localhost:2379” member list
	echo "-----------------cluster health-------------"
	etcdctl --endpoints=“http://localhost:2379“ cluster-health

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
	    --initial-advertise-peer-urls http://${ip}:${peer_port} \
	    --listen-peer-urls http://${ip}:${peer_port} \
	    --listen-client-urls http://${ip}:${client_port},http://127.0.0.1:${client_port} \
	    --advertise-client-urls http://${ip}:${client_port} \
	    --discovery http://localhost:2379/v2/keys/discovery/testdiscoverycluster \
	    --initial-cluster-token ${cluster_name} >> ${log_dir}/${name}.log 2>&1 &  
   
可见不需要再指定集群内的各个成员，只需要指定discovery channel即可。
   
## 3 测试 ##
--- 

当动态集群启动后，集群内成员间即可相互通信，不依赖于原静态集群。有作证明的测试过程如下：

> 1 部署一个静态集群；   
> 2 以discovery方式在静态集群之上再部署一个动态集群；   
> 3 杀掉静态集群各个成员；   
> 4 通过etcdctl查看动态集群成员列表以及集群状态，成员不变，集群状态是healthy；   
> 5 向动态集群添加新成员失败；   
> 6 杀掉一个动态集群成员，再重新启动后成功加入动态集群；   
> 7 杀掉一个动态集群成员，清空其data_dir和wal_dir下数据，再重新启动后加入动态集群失败；

只要动态集群现有成员的数据还在，就能保证动态集群自身的稳定运行。又有作证明的测试过程如下：

> 1 部署一个静态集群；   
> 2 以discovery方式在静态集群之上再部署一个动态集群；   
> 3 杀掉动态集群各个成员，清空各个成员数据，然后分别启动之，这些成员加入动态集群失败；   
> 4 修改各个成员的name，然后再启动，加入动态集群成功；     

上面最后一步启动的各个节点，其实是以新node的身份加入了原动态集群。

## 4 zookeeper ##
---

考虑到zookeeper集群是第一个流行起来的同类组件，已有很多分布式系统已经采用它，这些系统不可能为了使用etcd而重新开发，etcd为了与之兼容而在etcd v3之上开发了一个etcd代理：zetcd。

etcd v3基于grpc提供了REST接口，提供了PUT/DELETE/GET等类似HTTP的幂等原语，使之可在功能上与zookeeper等同，但是使用go开发的etcd性能可甩基于JVM的zookeeper好几条街【参考文档2】。etcd v3的协议与zookeeper不同，zetcd将ZooKeeper客户端的请求转换为适合于etcd数据模型和API要求的消息发送给etcd，然后将etcd的响应消息转换后返回给客户端，zetcd性能跟zookeeper相比不遑多让。

个人建议把zetcd作为服务端环境的基础设置，在使用etcd集群提供的服务的每个系统上都部署一个，把原有依赖zookeeper服务的系统迁移到etcd之上。

至于zetcd如何使用本文不再详述。

## 参考文档 ##

- 1 [Clustering Guide](https://github.com/coreos/etcd/blob/master/Documentation/op-guide/clustering.md)
- 2 [Exploring Performance of etcd, Zookeeper and Consul Consistent Key-value Datastores](https://coreos.com/blog/performance-of-etcd.html)

## 扒粪者-于雨氏 ##

> 2018/01/09，于雨氏，初作此文于西二旗。
