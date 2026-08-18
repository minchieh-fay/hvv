package main

import (
	"context"
	"embed"
	"log"

	"hvv/config"
	"hvv/httpserver"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// main 创建并启动 Wails 应用。
func main() {
	settings, err := config.NewService()
	if err != nil {
		log.Fatal(err)
	}
	httpService, err := httpserver.New(settings, assets)
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		if err := httpService.Start(); err != nil {
			log.Printf("本地 HTTP 服务停止: %v", err)
		}
	}()

	// Create application with options
	err = wails.Run(&options.App{
		Title:  "hvv",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Handler: httpService.RedirectHandler(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnShutdown:       func(_ context.Context) { _ = httpService.Close() },
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
