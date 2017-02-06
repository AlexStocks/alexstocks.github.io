## Kafka 使用过成中遇到的问题以及解决办法 ##
---
*written by Alex Stocks on 2017/02/02*

### 0 引言 ###
---

大年初三(2017-01-30)下午15:56公司线上kafka集群(3 instances)挂了一台，导致整个线上服务瘫痪，由于正处于假期时间，用手机联系了相关同事手工重启系统且待系统服务正常后就暂时弃置一边。

今日稍有闲暇，赶往公司想把事故复盘一遍，以追踪事故原因。下面分别列出相关问题，并记录解决方法。

### 1 无法连接kafka实例 ###
---

由于测试环境机器数目有限，我便在一个测试机器启动了3个kafka实例(kafka_2.11-0.10.1.1)和1个zk实例（zookeeper-3.4.9），并写了相关python程序去连接kafka集群，但是程序一直报如下错误：
	
    kafka.errors.NoBrokersAvailable: NoBrokersAvailable

首先查看了kafka集群的网络监听情况。执行命令 netstat -nlp | grep 9092 得到如下结果：

    tcp6   0      0 127.0.0.1:19092         :::*     LISTEN      18782/java
    tcp6   0      0 127.0.0.1:29092         :::*     LISTEN      19111/java
    tcp6   0      0 127.0.0.1:9092          :::*     LISTEN      18406/java
    
注意到了kafka实例使用的tcp协议的版本是tcp6，google一番后发现解决方法是把如下语句加入你的bash启动脚本（.bash_profile or .bashrc）：

    export _JAVA_OPTIONS="-Djava.net.preferIPv4Stack=true"

再次执行上面的命令查验后，结果如下：

    tcp   0      0 127.0.0.1:19092  0.0.0.0:*               LISTEN   25551/java
    tcp   0      0 127.0.0.1:29092  0.0.0.0:*               LISTEN   25842/java
    tcp   0      0 127.0.0.1:9092   0.0.0.0:*               LISTEN   25254/java 

客户端程序是kafka python(https://github.com/dpkp/kafka-python)写的，再次启动后报如下错误：

    Traceback (most recent call last):
    File "producer.py", line 34, in <module>
    producer_timings['python_kafka_producer'] = python_kafka_producer_performance()
    File "producer.py", line 21, in python_kafka_producer_performance
    producer = KafkaProducer(bootstrap_servers=brokers)
    File "/usr/local/lib/python2.7/dist-packages/kafka/producer/kafka.py", line 328, in __init__
    **self.config)
    File "/usr/local/lib/python2.7/dist-packages/kafka/client_async.py", line 202, in __init__
    self.config['api_version'] = self.check_version(timeout=check_timeout)
    File "/usr/local/lib/python2.7/dist-packages/kafka/client_async.py", line 791, in check_version
    raise Errors.NoBrokersAvailable()
    kafka.errors.NoBrokersAvailable: NoBrokersAvailable
    
再次google后，在producer的参数里加上api_conf字段解决问题，修改后的代码如下：

    brokers = bootstrap_servers.split(',')
    producer = KafkaProducer(
        bootstrap_servers=brokers,
        api_version = (0, 10))

### 2 kafka集群稳定性测试 ###
---

测试环境：

- 在一台机器上部署1个zk实例（zookeeper-3.4.8）;
- 在同一台机器上部署3个kafka实例(kafka_2.11-0.10.1.1); 
- 在同一台机器上部署1个kafka producer实例(基于kafka-python库，以下简称P)；
- 在同一台机器上部署1个kafka consumer实例(基于kafka-python库，以下简称C)；
- topic一个，其replica为3，partition为3；

测试流程：

> case 1 kill全部kafka实例然后30s内再全部重启

    P与C依然能正常工作，但丢失消息若干且部分乱序。
> case 2 kill一个kafka实例然后重启之
    
    重启kafka之前，P与C都能正常工作， 但又部分消息乱序。重启kafka实例之后，60S内P与C都与新实例建立了正常连接，且partition2以新实例为leader。   
> case 3 kill一个kafka实例，kill P然后重启P，再kill C再重启C

    kill P且重启之后，P与C都可以正常工作。干掉C又重启之后，P与C依然能正常工作，但丢失消息若干且部分乱序。
> case 4 新建一个topic，其partition为3，其replica为1，然后kill掉两个kafka实例    

    kill掉一个kafka实例后，这个topic的信息如下图：    
   ![kafka-topic-one-replica](../pic/kafka-topic-one-replica.png)
      
    所以kafka中topic的replica应该大于2。

## 扒粪者-于雨氏 ##

> 2017/02/02，于雨氏，于致真大厦。
