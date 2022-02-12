## 分布式系统中三个小技巧 ##
---
*written by Alex Stocks on 2016/03/07，版权所有，无授权不得转载*

### 1 综述 ###
---

开发一个系统，大处着眼，小处入手，做分布式开发必须受限于目前硬件的资源的能力的限制。

一些常见的系统参数如下表：

			L1-数据缓存		L2-缓存		L3-缓存		内存		磁盘			SSD
	缓存大小	32KB			256KB		8MB			十几GB	几TB		几百GB
	访问时间	2ns				5ns			14-18ns		24-93ns	13.0ms	30-300us
	吞吐量	6500MB/s		3300MB/s	2200MB/s	800MB/s		60MB/s	250MB/s

* 1 小包合并发送
* 2 大包拆分发送
* 3 双缓冲
* 4 Pipeline

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

## 参考文档 ##


## Timeline ##
