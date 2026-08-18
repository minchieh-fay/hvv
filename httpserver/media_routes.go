package httpserver

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// registerMediaRoutes 注册媒体文件的 HTTP 静态访问路由。
func (s *Server) registerMediaRoutes(router chi.Router) {
	router.Get("/media/*", s.handleMedia)
}

// handleMedia 以只读方式提供图片、视频和音频文件。
func (s *Server) handleMedia(writer http.ResponseWriter, request *http.Request) {
	fileServer := http.StripPrefix("/media/", http.FileServer(http.Dir(s.mediaDir)))
	fileServer.ServeHTTP(writer, request)
}
