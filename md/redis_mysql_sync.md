## 分布式系统的读写流程 ##
---
*written by Alex Stocks on 2016/05/10*

### 0 分布式集群的数据一致性 ###


分布式集群的存储层一般由缓存层与数据固化层构成。

对存储层进行读写的时候，需要考虑到数据的一致性。数据一致性分为强一致（实时一致性）和弱一致(最终一致性)，根据数据一致性要求的不同，读写流程也要做相应的改变。下面结合个人经验给出两种情况下的读写流程步骤。

一般的简单的分布式系统，缓存层可以使用redis集群，固化层则可以使用mysql或者mongodb集群。**限于个人经验，本文所指的缓存层专指redis集群，固化层专指mysql或者mongodb集群。**


下面所有函数都遵循的几个条件：

   - 1 数据的key(如key="foo.bar")有垃圾值rubbish(如rubbish = "rubish-123987401234-zbert-rubish")；
   - 2 key相关的锁为lock(如lock = "lock.foo.bar")
   - 3 lock为乐观锁，其超时时间为ttl(如ttl = 10s)


### 1 强一致性系统的读写流程 ###
---

强一致性系统要求缓存和数据库的数据实时一致。这就要求写操作期间既要防止多个写请求之间发生冲突，又要防止读请求与其发生冲突。

- 写流程

		 func write(key, value) err {
		  	err = "okay"
		  	// 1 生成本次lock的随机值rand，然后申请lock；
		 		rand = time().now() * getpid() * random()
		 		t0 = t1 = time().now()
		 		ret = "null"
		 		while ret != "okay" {
		 		    t1 = time().now()
		 		    if (t1 - t0) >= ttl {
		 		        break
		 		    }

		 		    ret = redis.set(lock PX ttl NX)
		 		}

		 		if (t1 - t0) >= ttl {
		 		    err = "fail"
		 		    goto end
		 		}

		 		// 2 把缓存中的值更新为垃圾值
		 		ret = redis.set(key, rubish)
		 		if ret != "okay" {
		 		   err = "fail"
		 		   goto end
		 		}

		 		// 3 更新db (mysql or mongodb)
		 		ret = db.update(key, value)
		 		if ret != "okay" {
		 		   err = "fail"
		 		   goto end
		 		}

		 		// 4 更新缓存
		 		ret = redis.set(key, value)
		 		if ret != "okay" {
		 		   redis.del(key)
		 		}

		 		end:
		 		// 5 删除锁
		 		ret = get("lock.foo.bar")
		 		if ret == rand {
		 		    redis.del(lock)
		 		}

				return
		 }


- 读流程

		func read_cache(key) (err, value) {
	 	 	err = "okay"

	 	 	err, value = redis.get(key)
     	 	if err == "okay" {
     	 		if value == rubbish {
	 	 			err = "fail"
	 	 		}

	 	 		return
	 	 	}

			return
		}

		func read(key) (err, value) {
     	 	// 1 从缓存读取value
	 	 	err, value = read_cache(key)
     	 	if err == "okay" {
	 	 		return
	 	 	}

     	 	// 2 从db读取value
	 	 	err, value = db.get(key)
     	 	if err == "fail" {
	 	 		return
	 	 	}

	 	 	// 3 写入redis
	 	 	err = redis.setnx(key, value) // 既要防止与write函数的第2 或 4步冲突，又要防止与其他读者执行到这一步时发生冲突
			if err != "okay" {
				// 多个读者同时执行到第三步时，只有第一个会成功，所以后面的读者再次从缓存读取数据
				err, value = read_cache(key)
				return
			}

			return
     	}

### 2 弱一致性系统的读写流程 ###
---

弱一致性系统要求数据库的数据更新成功后，缓存可以过一段时间后与数据库的值一致，读请求读到一个key的旧值时也可以认为其操作成功。

- 读流程

	弱一致性条件下读流程与强一直性条件下流程一致。

- 写流程

		 func write(key, value) err {
		  	err = "okay"
		  	// 1 生成本次lock的随机值rand，然后申请lock；
		 		rand = time().now() * getpid() * random()
		 		t0 = t1 = time().now()
		 		ret = "null"
		 		while ret != "okay" {
		 		    t1 = time().now()
		 		    if (t1 - t0) >= ttl {
		 		        break
		 		    }

		 		    ret = redis.set(lock PX ttl NX)
		 		}

		 		if (t1 - t0) >= ttl {
		 		    err = "fail"
		 		    goto end
		 		}

		 		// 2 把缓存中的值更新为垃圾值
		 		ret, old_value = read(key)
		 		if ret != "okay" {
		 		   err = "fail"
		 		   goto end
		 		}

		 		// 3 更新db (mysql or mongodb)
		 		ret = db.update(key, value)
		 		if ret != "okay" {
		 		   err = "fail"
		 		   goto end
		 		}

		 		// 4 更新缓存
		 		ret = redis.set(key, value)
		 		if ret != "okay" {
		 		   redis.del(key)
		 		}

		 		end:
		 		// 5 删除锁
		 		ret = get("lock.foo.bar")
		 		if ret == rand {
		 		    redis.del(lock)
		 		}
		 }


## 扒粪者-于雨氏 ##

> 2016/05/10，于雨氏，于张衡路。

