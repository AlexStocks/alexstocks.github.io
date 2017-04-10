## Kafka 海滩拾贝 ##
---
*written by Alex Stocks on 2017/02/02*

### 0 引言 ###
---

大年初三(2017-01-30)下午15:56公司线上kafka集群(3 instances)挂了一台，导致整个线上服务瘫痪，由于正处于假期时间，用手机联系了相关同事手工重启系统且待系统服务正常后就暂时弃置一边。

今日稍有闲暇，赶往公司想把事故复盘一遍，以追踪事故原因。下面分别列出相关问题，并记录解决方法。

### 1 kafka启动与无法连接broker问题若干 ###
---

由于测试环境机器数目有限，我便在一个测试机器启动了3个kafka实例(kafka_2.11-0.10.1.1)和1个zk实例（zookeeper-3.4.9），并写了相关python程序去连接kafka集群。

#### Q1 kafka broker无法启动
-

broker无法启动大致有两个原因：第一是内存不足，第二是jmx无法启动。
可以通过修改kafka-server-start.sh如下一行代码来确定broker修改JVM HEAP size：

	export KAFKA_HEAP_OPTS="-Xmx1G -Xms1G"

把kafka-run-class.sh如下代码删除掉就可以关闭kafka的JMX：

	# JMX settings
	if [ -z "$KAFKA_JMX_OPTS" ]; then
	  KAFKA_JMX_OPTS="-Dcom.sun.management.jmxremote -Dcom.sun.management.jmxremote.authenticate=false  -Dcom.sun.management.jmxremote.ssl=false "
	fi
	
	# JMX port to use
	if [  $JMX_PORT ]; then
	  KAFKA_JMX_OPTS="$KAFKA_JMX_OPTS -Dcom.sun.management.jmxremote.port=$JMX_PORT "
	fi

把JMX关掉的坏处在于一些依赖于JMX（KafkaOffsetMonitor)就无法工作了。

#### Q2 python程序无法连接kafka broker
-

程序一直报如下错误：
	
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
      
    所以kafka中topic的replica应该大于1。
    
    
上面程序的相关代码详见[kafka failure test](https://github.com/AlexStocks/test/tree/master/kafka/kafka_failure_test)。
    
不改变测试环境其他条件，仅改变topic的replica为1的情况下，再次以下测试：
> case 1 kill全部kafka实例，3分钟后再全部重启

    P与C依然能正常工作，但丢失消息若干且部分乱序。但如果P为confluent_kafka(以下简称CK)实现，则仅仅有消息乱序现象。
> case 2 kill全部kafka实例，48分钟后再全部重启

    P与C依然能正常工作，但丢失消息若干。
    
        
### 3 线上kafka集群服务恢复 ###
---
第一次把线上那台死掉的机器重启后，它不断在重建数据，大约10分钟后仍然没有启动成功，目测是数据彻底乱掉了。于是我们把其数目录清空，然后再启动就成功了。

整个kafka集群服务恢复后，发现服务仍然很慢，通过日志发现这个kafka实例是在复制数据。这台机器从当天17:00pm开始一直到第二天08:00am才把数据重建成功，数据量约为598G，复制速率约为40G/H = 11.38KB/s。

到线上发现kafka数据保存时间配置如下：log.retention.hours=168，也就是保存了7天的数据。

参考上面的case4和这个参数，大约就知道优化方向了。

### 4 kafka消费者与broker连接不断挂掉 ###
---

在上海一家做wifi软件的公司工作的时候遇到这样一个问题：kafka consumer(Java)与broker之间的连接总是不断挂掉，查看了consumer的源码(主要是poll函数)后，发现主要原因是：

    consumer是单线程程序，从broker批量取出一批消息后处理，处理完毕后向broker汇报心跳，即messge process逻辑和heartbeat逻辑在一个线程上。
    
   解决方法是：设置max.partition.fetch.bytes=4096(kafka v0.9.0.0)或者max.poll.records=10(kafka v0.10.0.1)，这两个参数是用来设置每次拉取消息的最大量。
   
通过缩小batch message size来缩短message process时间，从而不阻塞hearbeat上报时间，后面这种现象就再也没有发生了。
   
### 5 kafka使用建议 ###
---

- 据B站服务端老大说经他们测试，partition数目为磁盘数目的4倍（也就是说每个盘上放4个partition）时候kafka的性能最优；
- 磁盘建议使用ssd，为了充分利用CPU提高系统吞吐率计（无论磁盘顺序写再怎么快也跟不上内存和cpu的吞吐率）；
- 如果使用SATA或者ATA磁盘，为了提高吞吐率建议使用多个磁盘，通过log.dirs配置这些磁盘目录，如 “log.dirs=/mnt/diska,/mnt/diskb,/mnt/diskc”，但是相关优缺点自己权衡，根据参考文档2这个参数会导致kafka如下行为：

   > The intention is to allow the use of multiple disks without RAID or
logical volume management.
   >
   > It takes a comma separated list and partition replicas are randomly
distributed to the list.
   >
   > If you get a disk error that results in an IOException the broker will shut itself down.
   
   另外，不要一个目录配置成ssd而另一个目录配置成SATA，否则会导致topic数据传输忽快忽慢；
- 磁盘上数据保留时间(相关参数是log.retention.hours=168)建议改为24小时或者你认为其他的合适值即可；
- 不要想当然认为kafka保存数据的过程是可靠的，broker接收收据后异步批量刷入磁盘的，为了保证数据及时写入磁盘，可以修改参数 “log.flush.interval.messages”（这个参数一般不要修改，过大则影响数据可靠性，过小则影响broker的吞吐率进而影响响应生产者和消费者的速度，详细解释见参考文档3）；
- worker数目最好与parition数目相等（小于当然也可以），鄙人自己测试当partiton数目为1而消费者为10的时候，系统响应速度急剧下降，可见消费者都把时间浪费在消息争用上了；
- 为了保证系统稳定性，replica数目最少为2；
- 生产者发送消息选择压缩方法的时候，建议选择lz4（详见参考文档1）； 
- 如果使用kafka的版本是v0.10以上，建议使用最新版kafka(目前是0.10.2.0)，个人发现 v0.10.1.0 版本的jar包不能正确获取某个consumer group的消费者个数；
- 其实个人真心建议不要使用v0.10，使用v0.8 or v0.9即可，其中一个原因是kafka版本越新则其周围可用的工具越少，工具的更新速度实在比不上kafka版本的个更新速度，每个大版本的更新就意味着其架构的大改；
- kafka v0.10的版本支持了offset存储在kafka上，但是他的offset提交处理速度非常慢，虽然支持异步定时提交offset，但是重启的话还是会丢，所以依赖kafka做主从同步保障数据一致性是不可能的（例如阿里的canal在mysql master和mysql slave之间传递binlog式它们是绝对不会使用kafka的），也就说kafka不考虑消费者是否重复消费，当然也有大厂自己封装kafka后把每个consumer消费的offset存在别的中间件上，通过assign方式读取kafka消息来保证不重复消费kafka message；
- 不要使用github.com/wvanbergen/kafka/consumergroup包，这个包将近两年没有更新，在kafka v0.10.1.0上测试的时候发现其官方example程序不能正确建立consumer group，建议以github.com/bsm/sarama-cluster替代之；
  
   
## 参考文档 ##

- 1 [Kafka Compression Performance Tests](http://blog.yaorenjie.com/2015/03/27/Kafka-Compression-Performance-Tests/)
- 2 [[Kafka-users] new log.dirs property (as opposed to log.dir)
](http://grokbase.com/t/kafka/users/136mjfz5bg/new-log-dirs-property-as-opposed-to-log-dir)
- 3 [apache kafka系列之server.properties配置文件参数说明](http://blog.csdn.net/lizhitao/article/details/25667831)
   
   
## 扒粪者-于雨氏 ##

> 2017/02/02，于雨氏，于致真大厦。
>
> 2017/02/19，于雨氏，于致真大厦，添加replica为1条件下的测试结果。
>
> 2017/03/02，于雨氏，于致真大厦，添加“kafka使用建议”。
> 
> 2017/03/25，于雨氏，于致真大厦，补充“kafka启动与无法连接kafka问题若干”一节。