# kubernetes client-go 源码分析
---
*written by Alex Stocks on 2020/08/31，版权所有，无授权不得转载*

client-go 是用 Golang 语言编写的官方编程式交互客户端库，提供对 Kubernetes API server 服务的交互访问。源码目录结构如下。

## 1.discovery
提供 DiscoveryClient 发现客户端。

## 2.dynamic
提供 DynamicClient 动态客户端。

## 3.informers
每种 K8S 资源的 Informer 实现。

## 4.kubernetes
提供 ClientSet 客户端。

## 5.listers
为每一个 K8S 资源提供 Lister 功能，该功能对 Get 和 List 请求提供只读的缓存数据。

## 6.plugin
提供 OpenStack，GCP 和 Azure 等云服务商授权插件。

## 7.rest
提供 RESTClient 客户端，对 K8S API Server 执行 RESTful 操作。

## 8.scale
提供 ScaleClient 客户端，用于扩容或缩容 Deployment, Replicaset, Replication Controller 等资源对象。

## 9.tools
提供常用工具，例如 SharedInformer, Relector, DealtFIFO 及 Indexers。提供 Client 查询和缓存机制，以减少想 kube-apiserver 发起的请求数等。主要子目录为/tools/cache。

## 10.transport
提供安全的 TCP 连接，支持 HTTP Stream，某些操作需要在客户端和容器之间传输二进制流，例如 exec，attach 等操作。该功能由内部的 SPDY 包提供支持。

## 11.util
提供常用方法。例如 WorkQueue 工作队列，Certificate 证书管理等。

[^参考文档]:
[1]:http://blog.sina.com.cn/s/blog_48c95a190102wqpq.html

## 于雨氏 ##

* 2019/12/08，于雨氏，于帝都丰台。
