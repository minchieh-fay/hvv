package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// ImageReferenceRequest 是前端上传参考图时提交的请求体。
type ImageReferenceRequest struct {
	DataURL string `json:"dataURL"`
	Name    string `json:"name"`
}

// ImageResultRequest 是前端保存图片生成结果时提交的请求体。
type ImageResultRequest struct {
	DataURL string `json:"dataURL"`
	URL     string `json:"url"`
}

// registerImageRoutes 注册图片制作模块的 HTTP 路由。
func (s *Server) registerImageRoutes(router chi.Router) {
	router.Get("/api/images/status", s.handleImageStatus)
	router.Get("/api/images/references", s.handleListImageReferences)
	router.Post("/api/images/references", s.handleSaveImageReference)
	router.Delete("/api/images/references", s.handleDeleteImageReference)
	router.Post("/api/images/results", s.handleSaveImageResult)
}

// handleImageStatus 返回本地媒体公网映射地址。
func (s *Server) handleImageStatus(writer http.ResponseWriter, _ *http.Request) {
	help_writeJSON(writer, map[string]string{"publicURL": s.PublicURL()})
}

// handleListImageReferences 返回指定日期的本地参考图片。
func (s *Server) handleListImageReferences(writer http.ResponseWriter, request *http.Request) {
	files, err := s.mediaService.List(request.URL.Query().Get("date"))
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	for index := range files {
		if !files[index].Generated {
			files[index].URL = "/media/" + files[index].Path
		}
	}
	help_writeJSON(writer, files)
}

// handleSaveImageReference 保存前端粘贴或选择的参考图片。
func (s *Server) handleSaveImageReference(writer http.ResponseWriter, request *http.Request) {
	var payload ImageReferenceRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || strings.TrimSpace(payload.DataURL) == "" {
		help_writeJSONError(writer, errors.New("图片数据不能为空"), http.StatusBadRequest)
		return
	}
	file, err := s.mediaService.SaveDataURL(payload.DataURL, "")
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	file.URL = "/media/" + file.Path
	help_writeJSON(writer, file)
}

// handleDeleteImageReference 删除图片库中的指定图片。
func (s *Server) handleDeleteImageReference(writer http.ResponseWriter, request *http.Request) {
	path := request.URL.Query().Get("path")
	if err := s.mediaService.Delete(path); err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	help_writeJSON(writer, map[string]bool{"deleted": true})
}

// handleSaveImageResult 将 Agent 工具得到的图片结果保存到本地。
func (s *Server) handleSaveImageResult(writer http.ResponseWriter, request *http.Request) {
	var payload ImageResultRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || strings.TrimSpace(payload.URL) == "" {
		help_writeJSONError(writer, errors.New("图片结果不能为空"), http.StatusBadRequest)
		return
	}
	file, err := s.mediaService.SaveRemoteImage(strings.TrimSpace(payload.URL))
	if err != nil {
		help_writeJSONError(writer, err, http.StatusBadRequest)
		return
	}
	file.URL = "/media/" + file.Path
	help_writeJSON(writer, file)
}
