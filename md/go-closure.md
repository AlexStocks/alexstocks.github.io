## Golang之闭包 ##
---
*written by Alex Stocks on 2016/09/24，版权所有，无授权不得转载*

### 1 closure定义 ###
---

关于closure的定义，可以参照golang官方示例（参考文档1）中的一句话：
>Go supports anonymous functions, which can form closures. Anonymous functions are useful when you want to define a function inline without having to name it.

从上面这句话可以看出看出，closure首先是匿名函数，其次是在另一个函数里面实现。

很多语言都有closure，其实都是一种语法糖，它与其定义时所在的函数共享同一个函数栈，能够使用其所在函数的内存空间，其访问的内存空间的对象(可称之为closure context)会被runtime放在堆空间上，编译器编译closure后会被inline成所在函数的一部分语句块(golang中是Escape Analysis技术)以提高运行速度。

其实可以这么定义：closure = anonymous function + closure conetxt。关于closure的汇编层面解释，详见最下面列出的参考文档2。

下面列述最近遇到的几个比较典型的golang clousure code example。

### 2 closure与引用 ###
---

golang中通过传递变量值能够起到引用效果的变量类型有slice & map & channel，其本质是这三种var type不是那种类似于int等可以让CPU直接访问的原子变量类型，而是一种C中的类似于struct的复合数据结构，其结构体中存储的值又指向的更大的一块内存地址，这个大内存区域才是真正的“值域”，结构体本身类似域大内存域的proxy。如果能够理解C++的shared_ptr的实现，就能够理解这种变量类型的本质。

因为closure与其所在的函数共享函数栈，所以也能实现类似于引用的效果。如下程序：
​
​```Go	                                                                                                     
	// output: 5                                                                                           
	func main() {                                                                                          
	    var v int = 3                                                                                      
	    func() {                                                                                           
	        v = 5                                                                                          
	    }()                                                                                                
	    println(v)                                                                                         
	}     
​```
​
上面的例子中，main函数内部的closure修改了变量v的值，因为是函数内部调用，其结论可能不能为人信服，又有如下示例：

​```Go
	// output: 5                                                                                           
	func test() (func(), func()) {                                                                         
	    var v int = 3                                                                                      
	    return func() { v = 5 }, func() { println("v:", v) }                                               
	}                                                                                                      
	                                                                                                       
	func main() {                                                                                          
	    f1, f2 := test()                                                                                   
	    f1()                                                                                               
	    f2()                                                                                               
	}  
​```
​
代码示例中f1和f2访问的变量v，其实v在使用时被runtime定义在了heap上。

参考文档1的代码示例也比较经典，一并补录如下：
​
​​```Go	
	func intSeq() func() int {
	    i := 0
	    return func() int {
	        i += 1
	        return i
	    }
	}
	
	func main() {
	    nextInt := intSeq()
	
	    println(nextInt()) // 1
	    println(nextInt()) // 2
	    println(nextInt()) // 3
	
	    newInts := intSeq()
	    println(newInts()) // 1
	}
​```
​
注意上面示例中最后一行的输出，当closure所在函数重新调用时，其closure是新的，其context引用的变量也是重新在heap定义过的。

### 3 closure与context ###
---

context是我见过的golang标准库(go1.7)中最优雅的库之一，对context的分析详见参考文档3，其cancel相关代码如下：

​```Go
	type CancelFunc func()
	
	// WithCancel方法返回一个继承自parent的Context对象，同时返回的cancel方法可以用来关闭返回的Context当中的Done channel
	// 其将新建立的节点挂载在最近的可以被cancel的父节点下（向下方向）
	// 如果传入的parent是不可被cancel的节点，则直接只保留向上关系
	func WithCancel(parent Context) (ctx Context, cancel CancelFunc) {
	    c := newCancelCtx(parent)
	    propagateCancel(parent, &c)
	    return &c, func() { c.cancel(true, Canceled) }
	}
	
	func newCancelCtx(parent Context) cancelCtx {
	    return cancelCtx{
	        Context: parent,
	        done:    make(chan struct{}),
	    }
	}
​```
​
从上可见cancel context也用到了closure，WithCancel返回了一个context对象和一个closure。cancel context的使用示例(参考文档4)如下：

​```Go
	// 模拟一个最小执行时间的阻塞函数
	func inc(a int) int {
		res := a + 1                // 虽然我只做了一次简单的 +1 的运算,
		time.Sleep(1 * time.Second) // 但是由于我的机器指令集中没有这条指令,
		// 所以在我执行了 1000000000 条机器指令, 续了 1s 之后, 我才终于得到结果。B)
		return res
	}
	
	// 向外部提供的阻塞接口
	// 计算 a + b, 注意 a, b 均不能为负
	// 如果计算被中断, 则返回 -1
	func Add(ctx context.Context, a, b int) int {
		res := 0
		for i := 0; i < a; i++ {
			res = inc(res)
			select {
			case <-ctx.Done():
				return -1
			default:
			}
		}
		for i := 0; i < b; i++ {
			res = inc(res)
			select {
			case <-ctx.Done():
				return -1
			default:
			}
		}
	
		return res
	}
	
	// output:
	// Compute: 1+2, result: -1
	// Compute: 1+2, result: -1
	func main() {
		// 手动取消
		a := 1
		b := 2
		ctx, cancel := context.WithCancel(context.Background())
		go func() {
			time.Sleep(2 * time.Second)
			cancel() // 在调用处主动取消
		}()
		res := Add(ctx, 1, 2)
	}
​```
​
### 4 closure与error ###
---

golang中错误处理是一件令人头疼的事情：需要不断的写"if err != nil {}"这样的代码^_^。

golang官方的《Errors are values》(参考文档5)一文中给出了如下一段错误处理示例：
​	
​​```Go	
	_, err = fd.Write(p0[a:b])
	if err != nil {
	    return err
	}
	_, err = fd.Write(p1[c:d])
	if err != nil {
	    return err
	}
	_, err = fd.Write(p2[e:f])
	if err != nil {
	    return err
	}
	// and so on
​```
​
这段代码示例的机巧之处在于:三个错误处理针对同一个函数fd.Write，这便能通过closure上下其手了，官方给出的第一个改进就是：

​```Go
	var err error
	write := func(buf []byte) {
	    if err != nil {
	        return
	    }
	    _, err = w.Write(buf)
	}
	write(p0[a:b])
	write(p1[c:d])
	write(p2[e:f])
	// and so on
	if err != nil {
	    return err
	}
​```
​
上面write closure虽然没有减少代码量，但使得代码优雅了不少。后面官方又给出了第二个优化：

​```Go
	type errWriter struct {
	    w   io.Writer
	    err error
	}
	
	func (ew *errWriter) write(buf []byte) {
	    if ew.err != nil {
	        return
	    }
	    _, ew.err = ew.w.Write(buf)
	}
	
	ew := &errWriter{w: fd}
	ew.write(p0[a:b])
	ew.write(p1[c:d])
	ew.write(p2[e:f])
	// and so on
	if ew.err != nil {
	    return ew.err
	}
​```
​
这个代码示例把closure中的error放入了struct errWriter之中，使得代码更加精妙。

上面代码段中这个技巧被用到了bufio.Writer的实现上，所以调用(bufio.Writer)Write函数时候，不用不断检查其返回值error，其代码示例如下：

​```Go
	b := bufio.NewWriter(fd)
	b.Write(p0[a:b])
	b.Write(p1[c:d])
	b.Write(p2[e:f])
	// and so on
	if b.Flush() != nil {
	    return b.Flush()
	}
​```
​
本节的技巧只有在同一个函数接口以及同一个处理对象error这样的情况下才可使用。

### 6 总结 ###
---

本文总结了closure的本质以及其一些使用场景，囿于个人golang知识范围低下，暂时只能写这么多了。

以后随着个人能力提升，我会逐渐补加此文。

此记。

## 参考文档 ##
---
- 1 [Go by Example: Closures](https://gobyexample.com/closures)
- 2 [Closures in Go](http://sunisdown.me/closures-in-go.html)
- 3 [go程序包源码解读——golang.org/x/net/context](http://studygolang.com/articles/5131)
- 4 [golang中context包解读](http://ju.outofmemory.cn/entry/273349)
- 5 [Errors are values](https://blog.golang.org/errors-are-values)

## Payment

<center> ![阿弥托福，于雨谢过](../pic/pay/wepay.jpg "阿弥托福，于雨谢过") &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ![无量天尊，于雨奉献](../pic/pay/alipay.jpg "无量天尊，于雨奉献") </center>


## Timeline ##
> 于雨氏，2016/09/24，初作此文于东沪。
