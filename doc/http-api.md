# hvv 本地 HTTP 接口

## 调用约定

前端页面和 Go HTTP 服务使用同一个来源，前端接口统一使用相对路径，不需要关心实际端口，也不要写死端口：

```js
fetch('/api/settings')
```

当前接口返回 JSON 时使用：

```http
Content-Type: application/json; charset=utf-8
```

错误响应统一格式：

```json
{
  "error": "错误说明"
}
```

## 配置接口

### 获取配置

```http
GET /api/settings
```

响应示例：

```json
{
  "apiKeyConfigured": true,
  "apiKey": "your-agnes-api-key",
  "baseURL": "https://api.agnes-ai.cn/v1",
  "model": "agnes-2.5-flash"
}
```

前端调用：

```js
// 读取 LLM 配置并更新前端状态。
async function loadSettings() {
    const response = await fetch('/api/settings');
    if (!response.ok) throw new Error('读取配置失败');
    return response.json();
}
```

### 保存 API Key

```http
POST /api/settings
Content-Type: application/json
```

请求体：

```json
{
  "apiKey": "your-agnes-api-key"
}
```

响应为保存后的完整配置，格式与 `GET /api/settings` 相同。

前端调用：

```js
// 保存 API Key，并返回保存后的配置。
async function saveAPIKey(apiKey) {
    const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({apiKey}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存 API Key 失败');
    return result;
}
```

可能的响应状态：

| 状态码 | 说明 |
| --- | --- |
| `200` | 保存成功 |
| `400` | JSON 格式错误或 API Key 为空 |
| `500` | 配置文件读取或保存失败 |

## 媒体文件

`~/.hvv/media` 通过静态 HTTP 暴露：

```text
GET /media/<相对媒体路径>
```

示例：

```text
/media/20260607/images/123456777-1111.png
/media/20260607/videos/123456777-1111.mp4
/media/20260607/audios/123456777-1111.mp3
```

前端显示图片：

```vue
<img :src="`/media/${media.path}`" alt="" />
```

前端播放视频：

```vue
<video :src="`/media/${media.path}`" controls />
```

媒体接口只提供 `GET` 静态读取。上传、删除、查询媒体列表等业务接口后续单独增加，不直接让前端拼接本地绝对路径。

## 图片制作接口

### 获取公网媒体地址

```http
GET /api/images/status
```

响应：`{"publicURL":"https://xxxx.trycloudflare.com"}`。

### 查询参考图

```http
GET /api/images/references?date=20260818
```

日期为空时默认查询今天。响应是图片数组，每项包含 `path`、`url` 和 `date`。

### 保存参考图

```http
POST /api/images/references
Content-Type: application/json
```

请求体中的 `dataURL` 必须是 `data:image/...;base64,...`，图片会保存到当天的 `img` 目录。

### 删除图片

```http
DELETE /api/images/references?path=20260818/img/150405.123-1234.png
```

只允许删除媒体目录下的图片文件。

### 保存 Agent 生成结果

```http
POST /api/images/results
Content-Type: application/json
```

请求体中的 `dataURL` 是 TS 侧 Agent 图片工具调用 Agnes 后得到的 Base64 Data URI：

```json
{"dataURL":"data:image/png;base64,..."}
```

图片生成由前端 Agents SDK 驱动，Agent 工具使用 `/api/settings`、`/api/images/status` 和参考图接口完成 Agnes 调用；Go 只负责把最终结果保存到当天的 `img` 目录。

## 视频制作接口

视频 Session 和视频生成过程中的图片、视频、manifest 文件统一保存到：

```text
~/.hvv/media/{日期}/video/{session-id}/
```

### 创建视频 Session

```http
POST /api/videos/sessions
Content-Type: application/json
```

请求体：

```json
{
  "orientation": "landscape",
  "ratio": "16:9",
  "content": "动画片，小明拿起 TS5100 产品",
  "minDuration": 20,
  "maxDuration": 50
}
```

`ratio` 目前只允许 `16:9` 或 `9:16`。时长为 `0` 表示交给 Agent 根据内容决定。

响应示例：

```json
{
  "session": {
    "id": "session-1720000000000000000",
    "date": "20260819",
    "orientation": "landscape",
    "ratio": "16:9",
    "status": "draft"
  },
  "path": "20260819/video/session-1720000000000000000/session.json",
  "url": "/media/20260819/video/session-1720000000000000000/session.json"
}
```

### 获取视频 Session 列表

```http
GET /api/videos/sessions?date=20260819
```

### 删除视频 Session

```http
DELETE /api/videos/sessions/{session-id}?date=20260819
```

删除指定 Session 目录下的剧本、日志、关键帧、视频片段和最终视频。删除前由前端弹出确认框。

日期为空时默认查询当天。响应为 Session JSON 数组，用于视频制作列表页面。

### 获取视频 Session

```http
GET /api/videos/sessions/{session-id}?date=20260819
```

响应为 Session JSON。`date` 为空时默认使用当天日期。

### 保存视频 Session

```http
PUT /api/videos/sessions/{session-id}?date=20260819
Content-Type: application/json
```

请求体为完整 Session JSON，服务会覆盖该 Session 的 `session.json`。

### 保存视频媒体或 manifest

```http
POST /api/videos/sessions/{session-id}/files?date=20260819&path=segments/segment-001/last-frame.png
Content-Type: application/octet-stream
```

请求体为文件二进制数据。`path` 只能是 Session 目录内的相对路径，不能使用本地绝对路径或 `..` 穿越路径。

响应示例：

```json
{
  "path": "20260819/video/session-1720000000000000000/segments/segment-001/last-frame.png",
  "url": "/media/20260819/video/session-1720000000000000000/segments/segment-001/last-frame.png"
}
```

视频生成由前端 `frontend/src/video` 模块中的 Agents SDK tools 驱动。Go HTTP 服务只负责 Session 和媒体文件持久化，不使用 Wails IPC，也不调用 `ffmpeg`。

### 追加视频 Agent 日志

```http
POST /api/videos/sessions/{session-id}/logs?date=20260819&path=logs/agent.jsonl
Content-Type: application/json
```

请求体为一条 JSON 日志事件，服务端会自动追加换行并写入 Session 的 JSONL 日志文件。日志路径只能位于当前 Session 的 `logs/` 目录，并且必须使用 `.jsonl` 扩展名。

建议事件格式：

```json
{
  "timestamp": "2026-08-19T03:00:00.000Z",
  "sessionID": "session-1720000000000000000",
  "event": "video.requested",
  "payload": {
    "segmentID": "segment-001",
    "prompt": "本片段只说：...",
    "frames": ["20260819/video/session-.../first-frame.png"],
    "taskID": "task_xxx",
    "model": "agnes-video-v2.0"
  }
}
```

前端 Agents SDK 的 Trace processor 会把 Agent 和工具生命周期追加到同一个 `logs/agent.jsonl` 文件。事件包括：

- `agent.trace.started`、`agent.trace.completed`：一次 Agent workflow 的开始和结束；
- `agent.span.started`、`agent.span.completed`：Agent、模型 generation、工具 function、handoff 等 span；
- `tool` span 的 `data` 中包含工具名称、参数和返回值（仅开启 Agent 调试追踪时记录完整内容）。

Agent 调试追踪默认关闭敏感内容，只保存事件类型、Trace ID、Span ID、父子关系、时间和错误状态。设置页面打开“记录完整输入输出”后，Agents SDK 的 `traceIncludeSensitiveData` 会开启，提示词、模型输出、工具参数和工具返回值才会写入日志。API Key、Authorization、Token、密码和 Base64 图片内容始终脱敏。

首期事件名包括 `session.created`、`references.confirmed`、`script.requested`、`script.completed`、`script.failed`、`keyframe.requested`、`keyframe.completed`、`keyframe.failed`、`video.requested`、`video.completed`、`video.failed` 和 `video.finalized`。

### 读取视频 Agent 日志

```http
GET /api/videos/sessions/{session-id}/logs?date=20260819&path=logs/agent.jsonl
```

响应为 `application/x-ndjson`，每行一个 JSON 事件。日志和 Session、图片、视频统一保存在 `~/.hvv/media/{日期}/video/{session-id}/`，便于后续 Agent 根据视频结果、用户反馈和历史提示词进行复盘调优。

## 路由代码位置

每个模块的路由和 handler 放在对应文件：

```text
httpserver/routes.go             # 总路由组装
httpserver/config_routes.go      # 配置接口
httpserver/media_routes.go       # 媒体接口
httpserver/frontend_routes.go    # 页面静态资源
```

新增模块时遵循以下方式：

```go
// registerChatRoutes 注册聊天模块的 HTTP 路由。
func (s *Server) registerChatRoutes(router chi.Router) {
    router.Post("/api/chat/completions", s.handleChatCompletion)
}
```

然后在 `httpserver/routes.go` 中统一注册：

```go
s.registerChatRoutes(router)
```

## 前端开发约定

1. 前端只使用相对 URL，例如 `/api/settings`，不要写死 `15351` 端口。
2. 所有 JSON 请求明确设置 `Content-Type: application/json`。
3. 所有响应先检查 `response.ok`，再读取错误信息。
4. 不要让前端直接访问 `~/.hvv/media` 的本地绝对路径。
5. 新增接口时先更新本文档，再实现前端调用。
