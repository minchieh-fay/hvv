# HVV

HVV 是一个基于 Wails、Go 和 Vue 3 的 AI 视频制作工作台。当前版本先实现项目工作区、故事拆分、角色和地点管理、场景卡片以及 Agnes 文本模型接入。

## 开发运行

环境要求：

- Go 1.25+
- Wails v2
- Node.js 20+

在项目根目录执行：

```bash
wails dev
```

没有 Agnes API Key 时，故事分析会使用内置演示分镜，方便先体验界面。点击右上角“设置”，填写 API Key 后，才会调用 `agnes-2.5-flash`。

## 构建

```bash
wails build
```

## 当前功能

- 横屏/竖屏项目设置
- 故事创意输入
- 演示分镜和 Agnes 文本分镜规划
- 场景卡片编辑
- 角色和地点素材管理
- 本地项目持久化
- Agnes 中国站点配置
- Agnes 图片生成和场景首帧保存
- Agnes 视频任务提交、轮询和上一场景尾帧继承
- Edge TTS 配音（缺少 Edge TTS 时自动使用静音音轨）
- SRT 字幕生成
- ffmpeg 片段拼接、音频合成和字幕烧录

## 媒体依赖

视频拼接和导出需要本机安装 `ffmpeg` 并确保它在 `PATH` 中。真实 Edge TTS 配音可以安装：

```bash
python3 -m pip install edge-tts
```

如果没有安装 Edge TTS，HVV 仍会生成等长静音音频和字幕，最终 MP4 可以正常导出。
