package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"hvv/config"
)

// configService 隔离配置模块，避免路由层直接暴露具体存储实现。
type configService struct {
	service *config.Service
}

// newConfigService 创建配置模块的 HTTP 适配器。
func newConfigService(service *config.Service) *configService {
	return &configService{service: service}
}

// Settings 是 HTTP 配置接口返回给前端的连接配置。
type Settings struct {
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
	APIKey           string `json:"apiKey"`
	BaseURL          string `json:"baseURL"`
	Model            string `json:"model"`
}

// SaveSettingsRequest 是前端保存 API Key 时提交的请求体。
type SaveSettingsRequest struct {
	APIKey string `json:"apiKey"`
}

// registerConfigRoutes 注册配置模块的 HTTP 路由。
func (s *Server) registerConfigRoutes(router chi.Router) {
	router.Get("/api/settings", s.handleGetSettings)
	router.Post("/api/settings", s.handleSaveSettings)
}

// handleGetSettings 读取前端所需的 LLM 配置。
func (s *Server) handleGetSettings(writer http.ResponseWriter, _ *http.Request) {
	settings, err := s.readSettings()
	if err != nil {
		help_writeJSONError(writer, err, http.StatusInternalServerError)
		return
	}
	help_writeJSON(writer, settings)
}

// handleSaveSettings 校验并保存前端提交的 API Key。
func (s *Server) handleSaveSettings(writer http.ResponseWriter, request *http.Request) {
	var payload SaveSettingsRequest
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		help_writeJSONError(writer, errors.New("请求体格式错误"), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(payload.APIKey) == "" {
		help_writeJSONError(writer, errors.New("API key cannot be empty"), http.StatusBadRequest)
		return
	}
	cfg, err := s.settings.service.Load()
	if err != nil {
		help_writeJSONError(writer, err, http.StatusInternalServerError)
		return
	}
	cfg.APIKey = strings.TrimSpace(payload.APIKey)
	if err := s.settings.service.Save(cfg); err != nil {
		help_writeJSONError(writer, err, http.StatusInternalServerError)
		return
	}
	s.handleGetSettings(writer, request)
}

// readSettings 读取本地配置并补齐 Agnes 默认连接参数。
func (s *Server) readSettings() (Settings, error) {
	cfg, err := s.settings.service.Load()
	if err != nil {
		return Settings{}, err
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = config.DefaultBaseURL
	}
	model := cfg.Model
	if model == "" {
		model = config.DefaultModel
	}
	return Settings{
		APIKeyConfigured: cfg.APIKey != "",
		APIKey:           cfg.APIKey,
		BaseURL:          baseURL,
		Model:            model,
	}, nil
}
