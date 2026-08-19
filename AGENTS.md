# 基于新加坡agnes的agent工具, 涵盖聊天, 图片生成, 视频生成

## 开发语言
go+wails
vue3+elementplus

## 设计哲学
1. 每个函数上方都有中文简单介绍该函数的作用
2. 每个超过40行的函数  都应该在重要步骤上面加注释, 如:
```
// 用户登录接口
func login(user, pwd) {
    // step.1 根据user查询数据库
    dbpwd := help_getdbpwd(user)
    // step.2 比较用户和db中的密码
    if ... return true
}
```
3. 模块设计, 就像微服务设计一样, 做模块/对象抽象, 比如chat聊天 独立一个文件夹, 他是聊天模块
4. 每个模块(文件夹)抽取help文件, go就是help.go, ts就是help.ts
说明: 我们希望每个函数都是可读性非常强的
一个函数为什么难读, 在于层级太深入, 比如我看餐馆的菜单, 只看菜名和价格, 而不是展示更底层的: 放了多少克盐,多少克糖, 这些不该提现在主函数中, 将这些代码抽取到help文件中(一个模块(文件夹)一个help文件)
如: auth模块, 有个login.go文件, 里面有个login函数(见2中的login函数的help_getdbpwd, 不关心数据库怎么链接, 查什么表, 只关心登录的步骤 是: 取数据库中的密码 然后 和用户提供的密码比较)
**重要**
4.1. help文件里面的函数名  必须以help开头, 如: help_getdbpwd()
4.2. help文件里面的函数 不允许被跨模块(文件夹)调用
4.3. 所有调用help函数的地方都需要加入中文注释, 如:
```
// 根据user查询数据库
dbpwd := help_getdbpwd(user)
```
5. 后端全部使用http接口给前端使用api, 严谨使用wails的ipc通讯
后端写了http接口后 写入文档  doc/http-api.md
前端开发的时候 可以参考这个api文档

6. 不要把一行代码写很长 不要超过120个字符(含空格等字符)  不然代码不好读
7. 分析制作视频问题, 可以看日志 ~/.hvv/media/{日期}/video/{session}/logs/