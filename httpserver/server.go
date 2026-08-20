package httpserver

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"time"

	"hvv/config"
	"hvv/media"
	"hvv/tunnel"
)

const (
	startPort = 15351
	portTries = 20
)

// Server 提供本地页面、应用 API 和媒体静态文件服务。
type Server struct {
	settings      *configService
	assets        fs.FS
	mediaDir      string
	mediaService  *media.Service
	tunnelService *tunnel.Service
	server        *http.Server
	listener      net.Listener
	baseURL       string
}

// New 创建本地 HTTP 服务，并准备嵌入的前端资源和媒体目录。
func New(settings *config.Service, assets embed.FS) (*Server, error) {
	dist, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return nil, fmt.Errorf("读取前端资源失败: %w", err)
	}
	listener, err := help_listenLocalhost(startPort, portTries)
	if err != nil {
		return nil, err
	}
	mediaService, err := media.New()
	if err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("创建媒体服务失败: %w", err)
	}
	mediaDir := mediaService.Root()
	// 启动后台清理任务，程序启动时先执行一次。
	if err := mediaService.Cleanup(time.Now()); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("清理媒体目录失败: %w", err)
	}
	var publicTunnel *tunnel.Service
	// 暂时停用cf
	// publicTunnel, err = tunnel.Start("http://" + listener.Addr().String())
	// if err != nil {
	// 	_ = listener.Close()
	// 	return nil, err
	// }
	service := &Server{
		settings:      newConfigService(settings),
		assets:        dist,
		mediaDir:      mediaDir,
		mediaService:  mediaService,
		tunnelService: publicTunnel,
		listener:      listener,
		baseURL:       "http://" + listener.Addr().String(),
	}
	service.server = &http.Server{Handler: service.routes()}
	go service.cleanupLoop()
	return service, nil
}

// Start 在后台启动本地 HTTP 服务。
func (s *Server) Start() error {
	if err := s.server.Serve(s.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Close 停止本地 HTTP 服务并释放监听端口。
func (s *Server) Close() error {
	if s.tunnelService != nil {
		s.tunnelService.Close()
	}
	return s.server.Close()
}

// cleanupLoop 每小时清理一次超过保留期限的媒体日期目录。
func (s *Server) cleanupLoop() {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		if err := s.mediaService.Cleanup(time.Now()); err != nil {
			log.Printf("清理媒体目录失败: %v", err)
		}
	}
}

// PublicURL 返回 Cloudflare Quick Tunnel 公网地址，隧道停用时返回空字符串。
func (s *Server) PublicURL() string {
	if s.tunnelService == nil {
		return ""
	}
	return s.tunnelService.URL()
}

// URL 返回本地 HTTP 服务地址，供 Wails 初始页面跳转使用。
func (s *Server) URL() string {
	return s.baseURL
}

// AssetHandler 返回 Wails 初始资源页和 HTTP API 的统一处理器。
func (s *Server) RedirectHandler() http.Handler {
	return s.routes()
}
