package config

import (
	"os"
	"path/filepath"
)

const (
	DefaultBaseURL = "https://api.agnes-ai.cn/v1"
	DefaultModel   = "agnes-2.5-flash"
)

// Config 保存应用的本地配置。
type Config struct {
	APIKey  string `yaml:"api_key"`
	BaseURL string `yaml:"base_url,omitempty"`
	Model   string `yaml:"model,omitempty"`
}

// Service 负责配置文件的路径管理和读写。
type Service struct {
	path string
}

// NewService 创建配置服务，并定位到用户的 hvv 数据目录。
func NewService() (*Service, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return &Service{path: filepath.Join(home, ".hvv", "config.yaml")}, nil
}

// Load 读取本地配置；配置文件不存在时返回空配置。
func (s *Service) Load() (Config, error) {
	// 从配置文件读取并解析本地设置。
	return help_readConfig(s.path)
}

// Save 以受限权限安全保存本地配置。
func (s *Service) Save(cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	// 将配置对象编码为 YAML 内容。
	data, err := help_encodeConfig(cfg)
	if err != nil {
		return err
	}
	// 使用临时文件替换目标文件，完成安全写入。
	return help_writeConfig(s.path, data)
}
