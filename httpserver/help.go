package httpserver

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
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
