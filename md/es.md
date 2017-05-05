## es使用经验总结 ##
---
*written by Alex Stocks on 2017/05/05*


### 0 说明 ###
---
下面列出的相关程序都已经放到我的[python测试程序github repo](https://github.com/AlexStocks/python-practice/tree/master/mysql_redis_es_flume/es_cacher)上。

### 1 es新feature ###
---

- 0 es6去除了type(参考文档1)，数据层级变成了index -> doc

    详细阅读了文中提及的pr，是在elasticsearch.conf中多了一个index.mapping.single_type 配置项，其默认值为false。当其值为true的时候，index中只能有一个type，且系es为index创建好的，名称不能改变。
 

## 参考文档 ##

- 1 [Elasticsearch 6.0 移除 Type](https://elasticsearch.cn/article/158)

## 扒粪者-于雨氏 ##

> 2017/05/05，于雨氏，于致真大厦。

