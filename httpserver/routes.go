package httpserver

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// routes 注册应用全部 HTTP 路由，并保持模块边界清晰。
func (s *Server) routes() http.Handler {
	router := chi.NewRouter()
	s.registerConfigRoutes(router)
	s.registerMediaRoutes(router)
	s.registerImageRoutes(router)
	router.Handle("/*", s.frontendHandler())
	return router
}
