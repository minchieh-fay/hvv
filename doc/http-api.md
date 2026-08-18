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
