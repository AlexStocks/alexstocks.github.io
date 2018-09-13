## getty 开发日志
---
*written by Alex Stocks on 2018/03/19，版权所有，无授权不得转载*


### 0 说明
---

[getty](https://github.com/alexstocks/getty)是一个go语言实现的网络层引擎，可以处理TCP/UDP/websocket三种网络协议。

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

这个测试的另一个结论是：不管是 connected UDP 还是 unconnected UDP，如果启用了 SetTimeout，则会增大发送延迟。

#### 1.3 Go UDP
---

Go 语言 UDP 编程也对 connected UDP 和 unconnected UDP 进行了明确区分，参考文档2 详细地列明了如何使用相关 API，根据这篇文档个人也写一个 [程序](https://github.com/alexstocks/go-practice/blob/master/udp-tcp-http/udp/connected-udp.go) 测试这些 API，测试结论如下：

	* 1 connected UDP 读写方法是 Read 和 Write；
	* 2 unconnected UDP 读写方法是 ReadFromUDP 和 WriteToUDP（以及 ReadFrom 和 WriteTo)；
	* 3 unconnected UDP 可以调用 Read，只是无法获取 peer addr；
	* 4 connected UDP 可以调用 ReadFromUDP（填写的地址会被忽略）
	* 5 connected UDP 不能调用 WriteToUDP，”即使是相同的目标地址也不可以”，否则会得到错误 “use of WriteTo with pre-connected connection”；
	* 6 unconnected UDP 不能调用 Write, “因为不知道目标地址”, error:”write: destination address requiredsmallnestMBP:udp smallnest”；
	* 7 connected UDP 可以调用 WriteMsgUDP，但是地址必须为 nil；
	* 8 unconnected UDP 可以调用 WriteMsgUDP，但是必须填写 peer endpoint address。

综上结论，读统一使用 ReadFromUDP，写则统一使用 WriteMsgUDP。

#### 1.4 Getty UDP
---

版本 v0.8.1 Getty 中添加 connected UDP 支持时，其连接函数 [dialUDP](https://github.com/alexstocks/getty/blob/master/client.go#L141) 这是简单调用了 net.DialUDP 函数，导致昨日（20180318 22:19 pm）测试的时候遇到一个怪现象：把 peer UDP endpoint 关闭，local udp endpoint 进行 connect 时 net.DialUDP 函数返回成功，然后 lsof 命令查验结果时看到确实存在这个单链接：

	COMMAND     PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
	echo_clie 31729 alex    9u  IPv4 0xa5d288135c97569d      0t0  UDP localhost:63410->localhost:10000

然后当 net.UDPConn 进行 read 动作的时候，会得到错误 “read: connection refused”。

于是模仿C语言中对 TCP client connect 成功与否判断方法，对 [dialUDP](https://github.com/alexstocks/getty/blob/master/client.go#L141) 改进如下：

	* 1 net.DialUDP 成功之后，判断其是否是自连接，是则退出；
	* 2 connected UDP 向对端发送一个无用的 datagram packet【”ping”字符串，对端会因其非正确 datagram 而丢弃】，失败则退出；
	* 3 connected UDP 发起读操作，如果对端返回 “read: connection refused” 则退出，否则就判断为 connect 成功。

### 2 Compression
---

去年给 getty 添加了 TCP/Websocket compression 支持，Websocket 库使用的是 [gorilla/websocket](https://github.com/gorilla/websocket/)，[Go 官网](https://godoc.org/golang.org/x/net/websocket)也推荐这个库，因为自 `This package("golang.org/x/net/websocket") currently lacks some features`。


#### 2.1 TCP compression
---

最近在对 Websocket compression 进行测试的时候，发现 CPU 很容易就跑到 100%，且程序启动后很快就 panic 退出了。

根据 panic 信息提示查到 [gorilla/websocket/conn.go:ReadMsg](https://github.com/gorilla/websocket/blob/master/conn.go#L1018) 函数调用 [gorilla/websocket/conn.go:NextReader](https://github.com/gorilla/websocket/blob/master/conn.go#L928) 后就立即 panic 退出了。panic 的 `表层原因` 到是很容易查明：

* 1 [gorrilla/websocket:Conn::advanceFrame](https://github.com/gorilla/websocket/blob/master/conn.go#L768) 遇到读超时错误（io timeout）;
* 2 [gorrilla/websocket:ConnConn.readErr](https://github.com/gorilla/websocket/blob/master/conn.go#L941)记录这个error；
* 3 [gorilla/websocket/conn.go:Conn::NextReader](https://github.com/gorilla/websocket/blob/master/conn.go#L959)开始读取之前则[检查这个错误](https://github.com/gorilla/websocket/blob/master/conn.go#L938)，如以前发生过错误则不再读取 websocket frame，并对[gorrilla/websocket:ConnConn.readErr累积计数](https://github.com/gorilla/websocket/blob/master/conn.go#L957)；
* 4 [当gorrilla/websocket:ConnConn.readErr数值大于 1000](https://github.com/gorilla/websocket/blob/master/conn.go#L958) 的时候，程序就会panic 退出。

但是为何发生读超时错误则毫无头绪。

2018/03/07 日测试 TCP compression 的时候发现启动 compression 后，程序 CPU 也会很快跑到 100%，进一步追查后发现函数 [getty/conn.go:gettyTCPConn::read](https://github.com/alexstocks/getty/blob/master/conn.go#L228) 里面的 log 有很多 “io timeout” error。当时查到这个错误很疑惑，因为我已经在 TCP read 之前进行了超时设置【SetReadDeadline】，难道启动 compression 会导致超时设置失效使得socket成了非阻塞的socket？

于是在 [getty/conn.go:gettyTCPConn::read](https://github.com/alexstocks/getty/blob/master/conn.go#L228) 中添加了一个逻辑：启用 TCP compression 的时不再设置超时时间【默认情况下tcp connection是永久阻塞的】，CPU 100% 的问题很快就得到了解决。

至于为何 `启用 TCP compression 会导致 SetDeadline 失效使得socket成了非阻塞的socket`，囿于个人能力和精力，待将来追查出结果后再在此补充之。

#### 2.2 Websocket compression
---

TCP compression 的问题解决后，个人猜想 Websocket compression 程序遇到的问题或许也跟 `启用 TCP compression 会导致 SetDeadline 失效使得socket成了非阻塞的socket` 有关。

于是借鉴 TCP 的解决方法，在 [getty/conn.go:gettyWSConn::read](https://github.com/alexstocks/getty/blob/master/conn.go#L527) 直接把超时设置关闭，然后 CPU 100% 被解决，且程序运转正常。

### 3  unix socket

本节与 getty 无关，仅仅是在使用 unix socket 过程中遇到一些 keypoint 的记录。

#### 3.1 reliable

unix socket datagram 形式的包也是可靠的，每次写必然要求对应一次读，否则写方会被阻塞。如果是 stream 形式，则 buffer 没有满之前，写者是不会被阻塞的。datagram 的优势在于 api 简单。

```
Unix sockets are reliable. If the reader doesn't read, the writer blocks. If the socket is a datagram socket, each write is paired with a read. If the socket is a stream socket, the kernel may buffer some bytes between the writer and the reader, but when the buffer is full, the writer will block. Data is never discarded, except for buffered data if the reader closes the connection before reading the buffer.  ---[Do UNIX Domain Sockets Overflow?](https://unix.stackexchange.com/questions/283323/do-unix-domain-sockets-overflow)
```
```
On most UNIX implementations, UNIX domain datagram sockets are always reliable and don't reorder
       datagrams.   ---[man 7 socketpair](http://www.man7.org/linux/man-pages/man7/unix.7.html)
```


​                                                                                                                          ---[Do UNIX Domain Sockets Overflow?](https://unix.stackexchange.com/questions/283323/do-unix-domain-sockets-overflow)

#### 3.2  buffer size

datagram 形式的 unix socket 的单个 datagram 包最大长度是 130688 B。

```
AF_UNIX SOCK_DATAGRAM/SOCK_SEQPACKET datagrams need contiguous memory. Contiguous physical memory is hard to find, and the allocation fails. The max size actually is 130688 B.  --- [the max size of AF_UNIX datagram message that can be sent in linux](https://stackoverflow.com/questions/4729315/what-is-the-max-size-of-af-unix-datagram-message-that-can-be-sent-in-linux)
```
```
It looks like AF_UNIX sockets don't support scatter/gather on current Linux. it is a fixed size 130688 B.                      --- [Difference between UNIX domain STREAM and DATAGRAM sockets?](https://stackoverflow.com/questions/13953912/difference-between-unix-domain-stream-and-datagram-sockets)

```

## 总结
---

本文总结了 getty 近期开发过程中遇到的一些问题，囿于个人水平只能给出目前自认为最好的解决方法【如何你有更好的实现，请留言】。

随着getty若有新的 improvement 或者新 feature，我会及时补加此文。

此记。

## 参考文档
---
- 1 [connect Function with UDP](http://www.masterraghu.com/subjects/np/introduction/unix_network_programming_v1.3/ch08lev1sec11.html)
- 2 [深入Go UDP编程](http://colobu.com/2016/10/19/Go-UDP-Programming/)

## 扒粪者-于雨氏

> 于雨氏，2018/03/19，初作此文于帝都海淀 “硅谷”。
>
>
> 于雨氏，2018/07/19，于海淀 “硅谷”， 补充 “unix socket” 一节。
