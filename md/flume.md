## flume使用经验总结 ##
---
*written by Alex Stocks on 2017/04/26*


### 0 说明 ###
---
下面列出的相关程序都已经放到我的[python测试程序github repo](https://github.com/alexstocks/python-practice/tree/master/mysql_redis_es_flume/flume)上。

### 1 测试单个agent ###
---

- 0 把flume.conf和flume-env.sh放到flume/conf下面，启动agent1

		/bin/bash agent1_load.sh start

- 1 运行单个test client
	
	 	python tcp_log_clt.py:
	 	
		Processed 300000 messages in 52.34 seconds
		14.93 MB/s
		5731.43 Msgs/s

- 2 同时运行12个client   
	
		/bin/bash multiple_tcp_log_clt.sh:
		
		Processed 300000 messages in 52.34 seconds
		1.23 MB/s
		470.60 Msgs/s

可见瓶颈是在flume，当n个client运行的时候，其性能是单个进程执行结果的1/n。

## 2 优化措施 ##
---

- 1 把flume.conf的flume_agent1.channels.ch1.capacity从8192改为16384，结果如故。

- 2 把flume-env.sh中G1 GC算法关闭且修改启动命令(关闭console并修改log level)后优化效果明显

	    原启动命令：nohup bin/flume-ng agent --conf ./conf/ -f conf/flume.conf -Dflume.root.logger=DEBUG,console -n $name >$name.nohup.out 2>&1 &
	    修改后的启动命令：nohup bin/flume-ng agent --conf ./conf/ -f conf/flume.conf -Dflume.root.logger=INFO -n $name >$name.nohup.out 2>&1 &
	    
	    执行单个client(python tcp_log_clt.py)测试结果：
	    Processed 300000 messsages in 18.22 seconds
	    42.89 MB/s
	    16462.31 Msgs/s

- 3 启动agent1( sink是file )& agent2( sink是kafka )，然后同时启动两个tcp client

		启动agent1： /bin/bash agent1_load.sh start
		启动agent2： /bin/bash agent2_load.sh start
	
	    client1(python tcp_log_clt1.py)运行结果：
	    Processed 300000 messsages in 21.45 seconds
	    36.43 MB/s
	    13983.04 Msgs/s
	    
	    client2(python tcp_log_clt2.py)运行结果：
	    Processed 300000 messsages in 20.19 seconds
	    38.71 MB/s
	    14857.84 Msgs/s

   此次测试sink目的地kafka和sink均在本机上，通过iostat -x 1命令可以看到，参数wkB/s高峰可达155136.00，低峰则仅为42.00，均衡值为78613.20。
  

## 3 flume中并行运行多个流 ##
---

有这样的需求：flume监听两个tcp端口，然后把两个端口收到的日志分别发送到各自对应的kafka topic。

我刚开始误以为一个agent只能运行一个流，我的对策就是启动多个agent，然后我只想启动一个flume进程，我竟然荒唐地想在一个flume里面启动两个agent！

后来经过测试发现在一个flume agent中可以启动多个流，只要保证每个流的sink和source配置正确各自的channel即可，这个问题就迎刃而解了。

相关配置请参考[flume-log-agent.conf](https://github.com/alexstocks/python-practice/blob/master/mysql_redis_es_flume/flume/flume_log_agent.conf)。

## 4 实时监控多个log文件 ##
---

`在flume1.7之前如果想要监控一个文件新增的内容，我们一般采用的source 为 exec tail, 但是这会有一个弊端，就是当你的服务器宕机重启后，此时数据读取还是从头开始。在flume1.7没有出来之前我们一般的解决思路为：当读取一条记录后，就把当前的记录的行号记录到一个文件中，宕机重启时，我们可以先从文件中获取到最后一次读取文件的行数，然后继续监控读取下去。保证数据不丢失、不重复。`【*本段文字引自[参考文档2](https://my.oschina.net/u/1780960/blog/793783)*】

而在flume1.7时新增了一个source 的类型为taildir,它可以监控一个目录下的多个文件，并且实现了实时读取记录保存的功能。相关详细配置见[flume-all.conf](https://github.com/alexstocks/python-practice/blob/master/mysql_redis_es_flume/flume/flume-all.conf)。

[参考文档3](http://www.freebuf.com/sectool/168471.html)提到 flume 的实时监控文件原理：	`Source 线程在检测有新的更新，会一直读取推向 Channel，当所有的更新处理完毕，线程会退出。启动一个 Timer 线程。定期3秒重新启动，如此反复。在这个过程中，没有充分利用 Java 的多线程通知机制，每次启动都有一些调度，排队，检测及任务初始化过程。影响性能。`。

## 5 flume注意事项 ##
---

- 1 sink只能有一个，否则日志会被平均输出到各个sink中，而不是每个sink都能得到相同的数据拷贝
- 2 对于BatchSize的详细解释见参考文档1。[**BatchSize的意义是：你希望将多个事件打包为一个事务，这样事务确认的开销就会摊薄到批量事务中的每一个事件，这样可以大大的提高你的吞吐量。**]

	[参考文档3](http://www.freebuf.com/sectool/168471.html)”flume 事务机制“提到 `Flume 本身已对事各进行了优化，允许批量提交事件。但本质上还是需要检测Sink的处理结果，再进行 Commit 或 Roolback`。

## 参考文档 ##

- 1 [Apache Flume 性能调优 (第一部分)](http://myg0u.com/hadoop/2016/05/04/flume-performance-tuning-part-1.html)
- 2 [flume1.7 新特性介绍 taildir 介绍](https://my.oschina.net/u/1780960/blog/793783)
- 3 [借鉴开源框架自研日志收集系统](http://www.freebuf.com/sectool/168471.html)

## 扒粪者-于雨氏 ##

> 2017/04/26，于雨氏，于致真大厦。
> 
> 2017/05/01，于雨氏，于致真大厦添加 “flume中并行运行多个流” 章节。
> 
> 2017/05/10，于雨氏，于丰台住所添加 “实时监控多个log文件” 章节。
> 
> 2018/04/21，于雨氏，于海淀添加 “source的Timer机制” 和 “flume 事务机制” 章节。

