package httpserver

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
)

// help_listenLocalhost 从起始端口开始尝试监听本机 HTTP 服务。
func help_listenLocalhost(start, tries int) (net.Listener, error) {
	for offset := 0; offset < tries; offset++ {
		port := start + offset
		listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			return listener, nil
		}
	}
	return nil, fmt.Errorf("无法监听本地 HTTP 端口 %d-%d", start, start+tries-1)
}

// help_validateAgnesVideoURL 只允许从 Agnes 官方视频域名下载生成结果。
func help_validateAgnesVideoURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
		return fmt.Errorf("视频地址必须是 HTTPS URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if !strings.HasSuffix(host, ".agnes-ai.cn") && !strings.HasSuffix(host, ".agnes-ai.space") {
		return fmt.Errorf("视频地址不是 Agnes 官方域名")
	}
	return nil
}

// help_openDirectory 使用当前操作系统的文件管理器打开指定目录。
func help_openDirectory(directory string) error {
	var command string
	switch runtime.GOOS {
	case "darwin":
		command = "open"
	case "windows":
		command = "explorer.exe"
	case "linux":
		command = "xdg-open"
	default:
		return fmt.Errorf("当前操作系统不支持打开文件夹")
	}
	return exec.Command(command, directory).Start()
}

// help_writeJSON 写入统一的 JSON 响应头和响应体。
func help_writeJSON(writer http.ResponseWriter, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(writer).Encode(value)
}

// help_writeJSONError 写入统一格式的 HTTP 错误响应。
func help_writeJSONError(writer http.ResponseWriter, err error, status int) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	help_writeJSON(writer, map[string]string{"error": err.Error()})
}
