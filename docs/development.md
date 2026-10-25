# 开发与构建

本仓库公开项目源码与演示资料，不提交已安装工具链、私有签名或个人运行状态。当前构建流程源自 Windows 命令行项目，尚未整理为一键跨平台 Android Studio 工程。

## 规则与接口测试

Node.js 24+，在仓库根目录运行 `npm test`。不需要真实模型密钥或云账号。

## Android 构建

参考 `scripts/build_apk.py`。脚本需要 JDK、Android aapt/d8/zipalign/apksigner、Android API 35 的 android.jar、Vosk Android 0.3.75、JNA 5.18.1 和 vosk-model-small-cn-0.22.zip。依赖文件放在脚本中对应的 `toolchain/` 路径；该目录不在仓库中。

脚本的 JDK 默认路径为 `C:/JAVA/bin`，需按本机修改；esbuild 对入口打包并输出 Chrome 74 兼容 JavaScript。自行构建时会在本机 `.local/` 创建自己的签名，不能覆盖安装由其他签名发布的 APK。

参考来源：
- Android 工具：https://developer.android.com/tools
- Vosk：https://github.com/alphacep/vosk-api
- 中文模型：https://alphacephei.com/vosk/models
- JNA：https://github.com/java-native-access/jna

## 搭子服务

源码 `android/buddy-config.json` 留空。请部署自己的 CloudBase 普通云函数，再填写自己的 HTTPS 路由地址；详见 `buddy/README.md`。APK 运行中还可设置服务地址，当前不提供账号跨服务迁移。

## 本地数据

`.local/`、`.env`、签名私钥、证书、任务数据库、临时测试身份和生成的 APK 均在忽略范围内。请勿将真实 API Key 写入代码或上传 `.local/`。预编译 APK 通过 Releases 提供。
