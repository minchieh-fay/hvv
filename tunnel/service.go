package tunnel

import (
	"fmt"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/cloudflare/cloudflared/cmd/cloudflared/cliutil"
	"github.com/cloudflare/cloudflared/cmd/cloudflared/tunnel"
	"github.com/cloudflare/cloudflared/metrics"
	"github.com/urfave/cli/v2"
)

var publicURLPattern = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

// Service 负责维持本地 HTTP 服务到 Cloudflare Quick Tunnel 的映射。
type Service struct {
	shutdown  chan struct{}
	stopOnce  sync.Once
	publicURL string
}

// Start 创建 Quick Tunnel，并等待 Cloudflare 返回公网地址。
func Start(origin string) (*Service, error) {
	service := &Service{shutdown: make(chan struct{})}
	urlChannel := make(chan string, 1)
	errorChannel := make(chan error, 1)
	go service.run(origin, urlChannel, errorChannel)
	select {
	case service.publicURL = <-urlChannel:
		return service, nil
	case err := <-errorChannel:
		service.Close()
		return nil, err
	case <-time.After(30 * time.Second):
		service.Close()
		return nil, fmt.Errorf("等待 Cloudflare 公网地址超时")
	}
}

// URL 返回当前 Quick Tunnel 的公网地址。
func (s *Service) URL() string { return s.publicURL }

// Close 停止 Quick Tunnel。
func (s *Service) Close() {
	s.stopOnce.Do(func() { close(s.shutdown) })
}

// run 在独立 goroutine 中运行 cloudflared 内嵌命令。
func (s *Service) run(origin string, urls chan<- string, errors chan<- error) {
	_ = os.Setenv("QUIC_GO_DISABLE_ECN", "1")
	buildInfo := cliutil.GetBuildInfo("go-embedded", "embedded")
	tunnel.Init(buildInfo, s.shutdown)
	metrics.RegisterBuildInfo("go-embedded", time.Now().UTC().Format(time.RFC3339), "embedded")
	originalStderr := os.Stderr
	reader, writer, err := os.Pipe()
	if err != nil {
		errors <- err
		return
	}
	os.Stderr = writer
	defer func() { os.Stderr = originalStderr; _ = writer.Close(); _ = reader.Close() }()
	go help_relayLogs(reader, originalStderr, urls)
	app := cli.NewApp()
	app.Name = "hvv-quick-tunnel"
	app.Flags = tunnel.Flags()
	app.Commands = tunnel.Commands()
	if err := app.Run([]string{app.Name, "tunnel", "--protocol", "http2", "--url", origin}); err != nil {
		errors <- fmt.Errorf("Cloudflare 公网映射失败: %w", err)
	}
}
