package httpserver

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// VideoSessionRequest 是创建视频 Session 时提交的配置。
type VideoSessionRequest struct {
	Orientation string  `json:"orientation"`
	Ratio       string  `json:"ratio"`
	Content     string  `json:"content"`
	MinDuration float64 `json:"minDuration"`
	MaxDuration float64 `json:"maxDuration"`
}

// registerVideoRoutes 注册视频制作模块的 HTTP 路由。
func (s *Server) registerVideoRoutes(router chi.Router) {
	router.Post("/api/videos/sessions", s.handleCreateVideoSession)
	router.Get("/api/videos/sessions", s.handleListVideoSessions)
	router.Delete("/api/videos/sessions/{sessionID}", s.handleDeleteVideoSession)
	router.Get("/api/videos/sessions/{sessionID}", s.handleReadVideoSession)
	router.Put("/api/videos/sessions/{sessionID}", s.handleSaveVideoSession)
	router.Post("/api/videos/sessions/{sessionID}/files", s.handleSaveVideoFile)
	router.Get("/api/videos/sessions/{sessionID}/files", s.handleReadVideoFile)
	router.Post("/api/videos/sessions/{sessionID}/logs", s.handleAppendVideoLog)
	router.Get("/api/videos/sessions/{sessionID}/logs", s.handleReadVideoLog)
}

// handleAppendVideoLog 追加一条视频 Agent 日志事件。
func (s *Server) handleAppendVideoLog(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	path := strings.TrimSpace(request.URL.Query().Get("path"))
	if date == "" {
		date = time.Now().Format("20060102")
	}
	if path == "" {
		path = "logs/agent.jsonl"
	}
	data, err := io.ReadAll(io.LimitReader(request.Body, 1<<20))
	if err != nil || !json.Valid(data) {
		help_writeJSONError(writer, fmt.Errorf("日志事件必须是有效 JSON"), http.StatusBadRequest)
		return
	}
	data = append(data, '\n')
	file, err := s.mediaService.AppendVideoFile(date, chi.URLParam(request, "sessionID"), path, data)
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	help_writeJSON(writer, map[string]string{"path": file.Path, "url": "/media/" + file.Path})
}

// handleReadVideoLog 返回视频 Session 的日志文件内容。
func (s *Server) handleReadVideoLog(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	path := strings.TrimSpace(request.URL.Query().Get("path"))
	if date == "" {
		date = time.Now().Format("20060102")
	}
	if path == "" {
		path = "logs/agent.jsonl"
	}
	data, err := s.mediaService.ReadVideoFile(date, chi.URLParam(request, "sessionID"), path)
	if err != nil {
		help_writeJSONError(writer, err, http.StatusNotFound)
		return
	}
	writer.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	_, _ = writer.Write(data)
}

// handleReadVideoFile 返回视频 Session 下的指定文件。
func (s *Server) handleReadVideoFile(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	path := strings.TrimSpace(request.URL.Query().Get("path"))
	if date == "" {
		date = time.Now().Format("20060102")
	}
	data, err := s.mediaService.ReadVideoFile(date, chi.URLParam(request, "sessionID"), path)
	if err != nil {
		help_writeJSONError(writer, err, http.StatusNotFound)
		return
	}
	writer.Header().Set("Content-Type", "application/octet-stream")
	_, _ = writer.Write(data)
}

// handleListVideoSessions 返回视频制作列表中的 Session。
func (s *Server) handleListVideoSessions(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	sessions, err := s.mediaService.ListVideoSessions(date)
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	help_writeJSON(writer, sessions)
}

// handleDeleteVideoSession 删除视频 Session 及其全部生成文件。
func (s *Server) handleDeleteVideoSession(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("20060102")
	}
	if err := s.mediaService.DeleteVideoSession(date, chi.URLParam(request, "sessionID")); err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	help_writeJSON(writer, map[string]any{"success": true})
}

// handleCreateVideoSession 创建视频 Session 并保存初始配置。
func (s *Server) handleCreateVideoSession(writer http.ResponseWriter, request *http.Request) {
	var payload VideoSessionRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		help_writeJSONError(writer, fmt.Errorf("视频配置格式错误: %w", err), http.StatusBadRequest)
		return
	}
	if payload.Ratio != "16:9" && payload.Ratio != "9:16" {
		help_writeJSONError(writer, fmt.Errorf("视频比例必须是 16:9 或 9:16"), http.StatusBadRequest)
		return
	}
	invalidDuration := payload.MinDuration < 0 || payload.MaxDuration < 0
	invalidRange := payload.MaxDuration > 0 && payload.MinDuration > payload.MaxDuration
	if invalidDuration || invalidRange {
		help_writeJSONError(writer, fmt.Errorf("视频时长范围无效"), http.StatusBadRequest)
		return
	}
	date := time.Now().Format("20060102")
	sessionID := fmt.Sprintf("session-%d", time.Now().UnixNano())
	session := map[string]any{
		"id": sessionID, "date": date, "orientation": payload.Orientation, "ratio": payload.Ratio,
		"content": payload.Content, "minDuration": payload.MinDuration, "maxDuration": payload.MaxDuration,
		"status": "draft", "createdAt": time.Now().Format(time.RFC3339), "updatedAt": time.Now().Format(time.RFC3339),
	}
	data, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		help_writeJSONError(writer, err, http.StatusInternalServerError)
		return
	}
	file, err := s.mediaService.CreateVideoSession(date, sessionID, data)
	if err != nil {
		help_writeJSONError(writer, err, http.StatusInternalServerError)
		return
	}
	help_writeJSON(writer, map[string]any{"session": session, "path": file.Path, "url": "/media/" + file.Path})
}

// handleReadVideoSession 返回视频 Session 的当前配置。
func (s *Server) handleReadVideoSession(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("20060102")
	}
	data, err := s.mediaService.ReadVideoSession(date, chi.URLParam(request, "sessionID"))
	if err != nil {
		help_writeJSONError(writer, err, http.StatusNotFound)
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = writer.Write(data)
}

// handleSaveVideoSession 保存用户修改后的视频 Session JSON。
func (s *Server) handleSaveVideoSession(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("20060102")
	}
	data, err := io.ReadAll(io.LimitReader(request.Body, 4<<20))
	if err != nil || !json.Valid(data) {
		help_writeJSONError(writer, fmt.Errorf("Session JSON 无效"), http.StatusBadRequest)
		return
	}
	file, err := s.mediaService.SaveVideoFile(date, chi.URLParam(request, "sessionID"), "session.json", data)
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	help_writeJSON(writer, map[string]string{"path": file.Path, "url": "/media/" + file.Path})
}

// handleSaveVideoFile 保存视频模块生成的图片、视频或 manifest 文件。
func (s *Server) handleSaveVideoFile(writer http.ResponseWriter, request *http.Request) {
	date := request.URL.Query().Get("date")
	path := strings.TrimSpace(request.URL.Query().Get("path"))
	if date == "" {
		date = time.Now().Format("20060102")
	}
	if path == "" {
		help_writeJSONError(writer, fmt.Errorf("媒体相对路径不能为空"), http.StatusBadRequest)
		return
	}
	data, err := io.ReadAll(io.LimitReader(request.Body, 256<<20))
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	if len(data) == 0 {
		help_writeJSONError(writer, fmt.Errorf("媒体内容不能为空"), http.StatusBadRequest)
		return
	}
	file, err := s.mediaService.SaveVideoFile(date, chi.URLParam(request, "sessionID"), path, data)
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	help_writeJSON(writer, map[string]string{"path": file.Path, "url": "/media/" + file.Path})
}
