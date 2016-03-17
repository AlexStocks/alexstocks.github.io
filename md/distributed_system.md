## 分布式系统中三个小技巧 ##
---
*written by Alex Stocks on 2016/03/07*

### 1 综述 ###
---

开发一个系统，大处着眼，小处入手，做分布式开发必须受限于目前硬件的资源的能力的限制。

一些常见的系统参数如下表：

			L1-数据缓存		L2-缓存		L3-缓存		内存		磁盘			SSD
	缓存大小	32KB			256KB		8MB			十几GB	几TB		几百GB
	访问时间	2ns				5ns			14-18ns		24-93ns	13.0ms	30-300us
	吞吐量	6500MB/s		3300MB/s	2200MB/s	800MB/s		60MB/s	250MB/s


## 参考文档 ##
- 1 [携程异步消息系统实践](http://blog.qiniu.com/archives/4791)
- 2 [京东咚咚架构演进](http://blog.csdn.net/mindfloating/article/details/50166169)
- 3 [从腾讯微博的成长分析架构的三个阶段](http://tech.it168.com/a2012/0810/1383/000001383838.shtml)
- 4 [几个大型网站的Feeds(Timeline)设计简单对比](http://datafans.net/?p=1163)
- 5 [腾讯微博架构设计](http://wenku.baidu.com/link?url=YU5duz8qnl-qavXoPY1MfRI-9MIYJNqI0ZRfZqvR08DpBGIZBNnlG2W-DUyIJZVU2YaRw9m-YxRMgaXntbqdiLhMXLCppU7ZmBM_quP8S9u)
- 6 [腾讯IM架构 1亿在线背后的技术挑战](http://wenku.baidu.com/view/caa2161859eef8c75fbfb3c0.html)
- 7 [微信技术总监周颢：一亿用户背后架构秘密](http://news.pedaily.cn/201503/20150301379053.shtml)
- 8 [视频：微信技术总监周颢：一亿用户背后架构秘密](http://www.uml.net.cn/video/lecture/2-20120427-101.asp)

## 扒粪者-于雨氏 ##
> 于雨氏，2016/03/07，初作此文于金箱堂。
>> 于雨氏，2016/03/08，于金箱修改msg cache部分相关字句。
>>> 于雨氏，2016/03/09，于金箱堂修改全文，并着重第五章心跳逻辑的部分流程。
