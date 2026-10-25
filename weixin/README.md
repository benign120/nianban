# 微信入口 · 电脑局域网模式

架构：本人微信 → 腾讯官方 iLink 通道 → 电脑 Node 服务 → SQLite 持久化 → 手机原生 HTTPS 拉取 → 校验与去重 → 本地保存 → Android 提醒。

使用公开通道协议，未安装 OpenClaw；无云服务租赁。仅处理扫码本人发来的直接文字消息。任务解析使用与手机相同的保守规则和约束；复杂输入才调用 DeepSeek。没有明确时间不设置提醒，有歧义则追问。

## 启动

双击上级目录「启动微信服务.cmd」。脚本准备私有证书，检查服务状态避免重复接收，启用任务创建，在后台启动 Node，再打开本机管理页。需要 Node 24+（node:sqlite）、JDK keytool，`weixin/node_modules` 已准备 qrcode 依赖。

- 管理页：`http://127.0.0.1:8792/`，只绑定回环地址。
- 手机接口：`https://<电脑内网IP>:8793/api/device/inbox?after=<cursor>`，要求 Bearer 专用凭据，只允许当前接口的同网段来源。
- 管理页 POST `/api/pairings` 校验本机 Host、回环来源和严格 Origin，用户点击后才返回 `NB1:` 连接码。状态接口不返回凭据。
- 连接码：base64url JSON `{v:1, endpoint, token, pin}`，本身是凭据载体，不是加密容器；不要公开。手机原生校验、加密保存，不把值传入 JS。
- 局域网使用自签名证书，手机固定配对证书 SHA256、校验有效期并保留平台 hostname/SAN 校验。独立 SSLSocketFactory，不改变系统信任库。仅根路径、HTTPS 和本地 8793 端口允许连接。
- `scripts/configure_weixin_firewall.ps1` 以管理员身份配置 Node/TCP8793/当前本地地址/对应网段的入站规则，不开放管理页，不做公网转发。

## 保留的私有文件

全部位于忽略目录 `.local/weixin/`：微信授权 credentials、专用手机 device token、SQLite 数据、消息游标、LAN 证书与密码、服务 PID 和日志。手机凭据与微信 token、DeepSeek key 互不相同。此前任务和授权复用，不要删除。服务端 DeepSeek 使用环境变量或私有 ai.json/旧 settings.json，不能写进源码或 APK。

## 可靠性边界

任务与消息处理结果在同一 SQLite 事务保存，重复投递返回同一回复；同内容重发去重。无效/过期时间要求补充，延迟消息按原发送时间解析相对日期。手机按 cursor 拉取，保存成功后再更新游标与调度，导入 ID 账本避免删除后恢复。手机端状态不反向写回电脑记录。

管理页「最近手机连接」只表示认证拉取发生，并非手机落盘或通知送达的回执；本机验收客户端也会更新该时间。关闭应用后不拉取。电脑停机/睡眠后不能依赖微信新建；已导入手机的本地提醒不受影响。同一路由器可能有设备隔离，需真机确认；本版不承诺跨网访问与全天在线。

## 验证

`node --test tests/*.test.mjs weixin/tests/*.test.mjs` 为规则、状态、协议及 LAN 工具测试。
构建自动执行 `NativeWeixinSecurityTest`；`node scripts/check_lan_native.mjs` 用生产 Java 客户端与真实 TLS 服务验证配对、错指纹、错凭据和错主机名。该脚本占用 8793，需在正式服务启动前运行。
`node scripts/check_weixin_setup.cjs` 与 `node scripts/check_weixin_ui.cjs` 检查电脑控制页、手机布局与模拟桥同步。

官方协议：[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) · [protocol](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)。云端部署材料保留在 `deploy/`，本版无需购买或使用。
