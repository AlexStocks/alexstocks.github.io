## 快速读写文件
---
*written by Alex Stocks on 2019/05/05，版权所有，无授权不得转载*

4月初读到 PolarDB 开发团队的一篇文章[《how to write file faster》](https://mp.weixin.qq.com/s/GbjWN9-B11DkUFgCZba_rQ)，受教颇多，现拾人牙慧成就本文，以示致敬！

### 1 快速写文件

对文件的操作一般区分为读写两种动作。如果文件特指为 SATA 磁盘文件，文件写操作其实就是 append 操作，文件读操作则有顺序和随机两种。

个人在2014年时对 7200转 的 SATA 磁盘文件的读写操作有两个经验数据：优化后的写速度可达 150MB/s，顺序读可达 800 MB/s。一般情况下，随机读速度高于写速度，对文件写速度的优化难于对其读速度的优化。本章主要描述对磁盘文件写流程的优化。

#### 1.1 内存对齐与双缓冲

大概五年前吾人写有 [《如何快速的把日志输出到磁盘上》](https://my.oschina.net/alexstocks/blog/299619)一文，其中 `write faster` 的关键之处在于：合并写输出，待输出内容为 4096 Bytes 时再调用系统 API 以 append 方式输出至磁盘。正如此文所述，这种方法其实借鉴自 muduo 的 log 系统。

muduo 的 log 系统还给出了进一步的优化：预先申请两个 buffer，以减少线程输出日志争抢 buffer 时的等待【等待系统分配 buffer 内存空间】时间，颇类似于早期 VGA 显卡加速时采用的双缓冲技术。

用俗话总结这种优化手段就是：写文件时用到的内存资源在写之前预先申请好，不要在输出内容时有等待时间；log 内容输出至磁盘时把内存与磁盘对齐，且以 append 的方式进行顺序输出。

本节所用到的技巧其实仅仅在于如何高效使用内存，并未更进一步地述及如何加快操作磁盘文件写流程【根本原因在于当时水平太渣^_^】。

#### 1.2 fdatasync

linux 系统会在内核内存空间为磁盘文件其分配一个内核缓冲区，有人称其为 “内核态内存区”。既然存在文件的 “内核态” 缓冲区，自然应该有一个 “用户态” 缓冲区。

记得 2011 年在深圳某家公司干活时，老大 Randy Ling 给了一本 APUE 作为见面礼，扉页上有这么一句话：使用 open 函数打开 log 文件时其 flag 参数应该加上 `O_SYNC | O_DIRECT`，以保证系统掉电时不丢失 log 内容。据说老大之所以加上这么一句话，是因为当时的华为 SSD 故障率实在是太高了。使用 linux open 函数打开文件时，文件系统只有一个 “内核态” 缓冲区，如果 linux open 函数的 flag 有 `O_DIRECT` 参数，则对文件进行读写时会绕过这个缓冲区，用户对文件的读写操作会直接作用于磁盘。

如果调用 linux fopen 函数打开文件，则对文件的读写会经 “用户态” 缓冲区 和 “内核态” 缓冲区 而后作用于磁盘。考虑如今的硬件系统健壮性与软件系统稳定性，一般情况下使用 fread/fwrite 之类函数足以保证数据一致性，但是不排除用户程序有 bug。为减少程序 bug 对文件数据安全性【数据丢失风险】的影响，一般的程序会在调用 fwrite 之后，再调用一次 fsync 保证数据被刷新至磁盘。

linux 系统每个文件都有一个 inode 区和 data 区，分别保存文件的 metadata 和 data，调用一次 fsync 会产生两次写操作：更新文件的 metadata 和 data。metadata 的更新内容主要有 size/update time等。

在写日志文件这一场景下，一般都要求每个日志文件大小一致，如果不关心文件的 update time 且预先为 log 文件提前分配了固定 size 的空间，则不需要在写 log 时更新文件的 size，每次调用 fsync 对 metadata 进行更新就显得无意义。针对这种场景，linux 专门提供了 fdatasync api 对文件的 data 区域进行更新。

fdatasync 的意义即为把 fsync 对文件的磁盘区域的两次写减少为一次写。

#### 1.3 fallocate

上节述及 fdatasync 时，提到 `预先为 log 文件提前分配了固定大小的空间`，linux 的 fallocate api 即可实现这一动作。

fallocate 保证系统预先为文件分配相应的逻辑磁盘空间，保证写数据时不会产生 “磁盘空间不足” 这个错误，但是并未分配相应的物理磁盘空间，所以调用 fallocate 仅产生 `预先为 log 文件提前标识了相应 size 的空间（extents）`的效果，在写磁盘文件的过程中还是会产生系统中断：linux 系统在中断过程中为其分配物理磁盘空间。有中断便有等待时间，等待时间过后才能继续 “快速写”。

诚如[《how to write file faster》](https://mp.weixin.qq.com/s/GbjWN9-B11DkUFgCZba_rQ)所述 `FALLOC_FL_ZERO_RANGE mode 是在内核3.15 版本才引入`，3.15 版本的 linux 系统给 fallocate api 的 mode 参数添加了一个 `ALLOC_FL_ZERO_RANGE` 选项，其作用是对相应 size 的逻辑磁盘空间进行 `filling zero` 操作，其效果是 linux 提前为磁盘文件分配相应的磁盘空间，这段磁盘空间对磁盘读操作不可见，所以有文章称这段空间为 "hole"[文件空洞]。文件空洞的一个好处是避免在写文件时因 linux 尚未为逻辑空间分配对应的物理磁盘空间导致的中断等待，另一个好处是固定文件 metadata 的 file size，避免写过程中因为需要更新这个参数而产生的双写行为。

这种 `filling zero` 操作颇类似于对 linux bzero api 的效果：为一段逻辑内存空间提前分配对应的物理内存空间，避免在写内存时产生中断。

#### 1.4 文件复用

[《how to write file faster》](https://mp.weixin.qq.com/s/GbjWN9-B11DkUFgCZba_rQ) 一文还提到另一个优化`通过后台线程提前创建文件并且filling zero 从而达到高效的写入`。

linux 系统创建文件时需要向文件系统申请文件资源，如欲实现文件 “快速写”，这个等待时间也是很可观的，所以类似于第一节的`写文件时用到的内存资源在写之前预先申请好` 优化手段，这种行为即是`写文件时用到的文件资源在写之前预先申请好`。

### 2 快速读文件 

优化文件读取速度的最基本手段即是`顺序读`，其原理在于 linux 系统读取文件数据时会提前对文件进行预读，减少读数据时的缺页中断。

linux 系统有预读行为，但预读数据量则是用户所不知道的。linux 提供了一个叫做 readahead 的 api，用户通过这个 api 可以控制系统的预读行为。

具体实践中，readahead 可以配合 mmap 函数一起使用以加快数据读取速度。

## 参考文档

- 1 [how to write file faster](https://mp.weixin.qq.com/s/GbjWN9-B11DkUFgCZba_rQ)
- 2 [如何快速的把日志输出到磁盘上](https://my.oschina.net/alexstocks/blog/299619)

## 扒粪者-于雨氏

> 2019/05/05，于雨氏，于 G44，初作此文。