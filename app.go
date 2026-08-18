package main

import (
	"context"
	"fmt"

	"hvv/config"
)

// App 是 Wails 暴露给前端的应用入口。
type App struct {
	ctx      context.Context
	settings *config.Service
}

// NewApp 创建应用入口，并初始化配置模块。
func NewApp() *App {
	settings, err := config.NewService()
	if err != nil {
		panic(err)
	}
	return &App{settings: settings}
}

// startup 保存 Wails 上下文，供后端请求继承取消信号。
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Settings 是前端全局 LLM store 初始化所需的配置。
type Settings struct {
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
	APIKey           string `json:"apiKey"`
	BaseURL          string `json:"baseURL"`
	Model            string `json:"model"`
}

// GetSettings 返回前端 Agents SDK 所需的模型连接配置。
func (a *App) GetSettings() (Settings, error) {
	cfg, err := a.settings.Load()
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

// SaveAPIKey 保存用户提供的 Agnes API Key。
func (a *App) SaveAPIKey(apiKey string) error {
	if apiKey == "" {
		return fmt.Errorf("API key cannot be empty")
	}
	cfg, err := a.settings.Load()
	if err != nil {
		return err
	}
	cfg.APIKey = apiKey
	return a.settings.Save(cfg)
}
