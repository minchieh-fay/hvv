# Backend Video Module

新的后端视频模块目录，后续重新设计视频制作接口和任务流程。

当前旧实现仍由 `httpserver/video_routes.go` 和 `media/service.go` 提供，避免在重构准备阶段破坏现有 HTTP 服务编译。
