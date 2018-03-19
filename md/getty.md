## getty readme
---
*written by Alex Stocks on 2018/03/19*


### 0 说明
---

[getty](https://github.com/alexstocks/getty)是一个go语言实现的网络层引擎，可以处理TCP/dup/websocket三种网络协议。

2016年6月我在上海做一个即时通讯项目时，接口层的底层网络驱动是当时的同事[sanbit](https://github.com/sanbit)写的，原始网络层实现了TCP Server，其命名规范学习了著名的netty。当时这个引擎比较简洁，随着我对这个项目的改进这个网络层引擎也就随之进化了（添加了TCP Client、抽象出了 TCP connection 和 TCP session），至2016年8月份（又添加了websocket）其与原始实现已经大异其趣了，征得原作者和相关领导同意后就放到了github上。

将近两年的时间我不间断地对其进行改进，年齿渐增但记忆速衰，觉得有必要记录下一些开发过程中遇到的问题以及解决方法，以备将来回忆之参考。

### 1 UDP connection
---

2018年3月5日 起给 getty 添加了UDP支持。

#### 1.1 UDP connect
---

UDP自身分为unconnected UDP和connected UDP两种，connected UDP的底层原理见下图。

![](../pic/connected_udp_socket.gif)

当一端的UDP endpoint调用connect之后，os就会在内部的routing table上把udp socket和另一个endpoint的地址关联起来，在发起connect的udp endpoint端建立起一个单向的连接四元组：发出的datagram packet只能发往这个endpoint（不管sendto的时候是否指定了地址）且只能接收这个endpoint发来的udp datagram packet（如图???发来的包会被OS丢弃）。

UDP endpoint发起connect后，OS并不会进行TCP式的三次握手，操作系统共仅仅记录下UDP socket的peer udp endpoint 地址后就理解返回，仅仅会核查对端地址是否存在网络中。

至于另一个udp endpoint是否为connected udp则无关紧要，所以称udp connection是单向的连接。如果connect的对端不存在或者对端端口没有进程监听，则发包后对端会返回ICMP “port unreachable” 错误。

如果一个POSIX系统的进程发起UDP write时没有指定peer UDP address，则会收到ENOTCONN错误，而非EDESTADDRREQ。

![](../pic/dns_udp.gif)

一般发起connect的为 UDP client，典型的场景是DNS系统，DNS client根据/etc/resolv.conf里面指定的DNS server进行connect动作。

至于 UDP server 发起connect的情形有 TFTP，UDP client 和 UDP server 需要进行长时间的通信， client 和 server 都需要调用 connect 成为 connected UDP。

如果一个 connected UDP 需要更换 peer endpoint address，只需要重新 connect 即可。

#### 1.2 connected UDP 的性能
---

connected UDP 的优势详见参考文档1。假设有两个 datagram 需要发送，unconnected UDP 的进行 write 时发送过程如下：

    * Connect the socket
    * Output the first datagram
    * Unconnect the socket
    * Connect the socket
    * Output the second datagram
    * Unconnect the socket

每发送一个包都需要进行 connect，操作系统到 routine table cache 中判断本次目的地地址是否与上次一致，如果不一致还需要修改 routine table。

connected UDP 的两次发送过程如下：

    * Connect the socket
    * Output first datagram
    * Output second datagram

这个 case 下，内核只在第一次设定下虚拟链接的 peer address，后面进行连续发送即可。所以 connected UDP 的发送过程减少了 1/3 的等待时间。

2017年5月7日 我曾用 [python 程序](https://github.com/alexStocks/python-practice/blob/master/tcp_udp_http_ws/udp/client.py) 对二者之间的性能做过测试，如果 client 和 server 都部署在本机，测试结果显示发送 100 000 量的 UDP datagram packet 时，connected UDP 比 unconnected UDP 少用了 2 / 13 的时间。

#### 1.3 Go UDP
---

Go 语言 UDP 编程也对 connected UDP 和 unconnected UDP 进行了明确区分，参考文档2 详细地列明了如何使用相关 API，根据这篇文档个人也写一个 [程序](https://github.com/alexstocks/go-practice/blob/master/udp-tcp-http/udp/connected-udp.go) 测试这些 API，测试结论如下：
 
    1 connected UDP 读写方法是 Read 和 Write；
    2 unconnected UDP 读写方法是 ReadFromUDP 和 WriteToUDP（以及 ReadFrom 和 WriteTo)；
    3 unconnected UDP 可以调用 Read，只是无法获取 peer addr；
    4 connected UDP 可以调用 ReadFromUDP（填写的地址会被忽略）
    5 connected UDP 不能调用 WriteToUDP，"即使是相同的目标地址也不可以"，否则会得到错误 "use of WriteTo with pre-connected connection"；
    6 unconnected UDP 更不能调用Write, "因为不知道目标地址", error:"write: destination address requiredsmallnestMBP:udp smallnest"；
    7 connected UDP 可以调用 WriteMsgUDP，但是地址必须为 nil；
    8 unconnected UDP 可以调用 WriteMsgUDP，但是必须填写 peer endpoint address。

    总体来说对Read比较宽容，对

#### 1.4 Getty UDP
---


### 总结
---

本文总结了getty近期开发过程中遇到的一些问题，囿于个人水平只能给出一些打补丁式的解决方法。

随着getty若有新的 improvement 或者新 feature，我会及时补加此文。

此记。

## 参考文档
---
- 1 [connect Function with UDP](http://www.masterraghu.com/subjects/np/introduction/unix_network_programming_v1.3/ch08lev1sec11.html)
- 2 [深入Go UDP编程](http://colobu.com/2016/10/19/Go-UDP-Programming/)

## 扒粪者-于雨氏

> 于雨氏，2018/03/19，初作此文于帝都海淀西二旗。
