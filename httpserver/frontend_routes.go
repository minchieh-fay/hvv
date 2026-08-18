package httpserver

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// frontendHandler 返回嵌入的前端静态资源，并为前端路由回退到 index.html。
func (s *Server) frontendHandler() http.Handler {
	fileServer := http.FileServer(http.FS(s.assets))
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestedPath := strings.TrimPrefix(path.Clean(request.URL.Path), "/")
		if requestedPath == "" {
			requestedPath = "index.html"
		}
		if _, err := fs.Stat(s.assets, requestedPath); err != nil {
			request.URL.Path = "/"
		}
		fileServer.ServeHTTP(writer, request)
	})
}
