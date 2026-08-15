package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type App struct {
	ctx context.Context
	mu  sync.Mutex
}

type Settings struct {
	APIKey string `json:"apiKey"`
	Domain string `json:"domain"`
}

type Project struct {
	Name         string      `json:"name"`
	Format       string      `json:"format"`
	Duration     int         `json:"duration"`
	Story        string      `json:"story"`
	Characters   []Character `json:"characters"`
	Locations    []Location  `json:"locations"`
	Scenes       []Scene     `json:"scenes"`
	AudioPath    string      `json:"audioPath,omitempty"`
	SubtitlePath string      `json:"subtitlePath,omitempty"`
	FinalPath    string      `json:"finalPath,omitempty"`
	UpdatedAt    string      `json:"updatedAt"`
}

type Character struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Voice       string `json:"voice"`
}

type Location struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Scene struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Duration    int      `json:"duration"`
	Location    string   `json:"location"`
	Characters  []string `json:"characters"`
	Description string   `json:"description"`
	Dialogue    string   `json:"dialogue"`
	Prompt      string   `json:"prompt"`
	Status      string   `json:"status"`
	ImagePath   string   `json:"imagePath,omitempty"`
	VideoPath   string   `json:"videoPath,omitempty"`
}

type PlanRequest struct {
	Story      string      `json:"story"`
	Project    Project     `json:"project"`
	Characters []Character `json:"characters"`
	Locations  []Location  `json:"locations"`
}

type planEnvelope struct {
	Scenes []Scene `json:"scenes"`
}

type MediaResult struct {
	Project Project `json:"project"`
	Message string  `json:"message"`
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func defaultProject() Project {
	return Project{
		Name: "未命名项目", Format: "9:16", Duration: 30,
		Characters: []Character{}, Locations: []Location{}, Scenes: []Scene{},
	}
}

func dataDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ".hvv"
	}
	return filepath.Join(dir, "hvv")
}

func (a *App) GetSettings() Settings {
	data, err := os.ReadFile(filepath.Join(dataDir(), "config.json"))
	if err != nil {
		return Settings{Domain: "cn"}
	}
	var settings Settings
	if json.Unmarshal(data, &settings) != nil || settings.Domain == "" {
		settings.Domain = "cn"
	}
	return settings
}

func (a *App) SaveSettings(settings Settings) error {
	if settings.Domain != "cn" && settings.Domain != "com" {
		settings.Domain = "cn"
	}
	return writeJSON(filepath.Join(dataDir(), "config.json"), settings)
}

func (a *App) GetProject() Project {
	data, err := os.ReadFile(filepath.Join(dataDir(), "project.json"))
	if err != nil {
		return defaultProject()
	}
	var project Project
	if json.Unmarshal(data, &project) != nil {
		return defaultProject()
	}
	return project
}

func (a *App) SaveProject(project Project) error {
	project.UpdatedAt = time.Now().Format(time.RFC3339)
	return writeJSON(filepath.Join(dataDir(), "project.json"), project)
}

func projectDir(project Project) string {
	name := regexp.MustCompile(`[^a-zA-Z0-9\x{4e00}-\x{9fff}_-]+`).ReplaceAllString(project.Name, "-")
	if name == "" {
		name = "untitled"
	}
	return filepath.Join(dataDir(), "projects", name)
}

func (a *App) GenerateImage(project Project, sceneIndex int) (Project, error) {
	if sceneIndex < 0 || sceneIndex >= len(project.Scenes) {
		return project, errors.New("场景不存在")
	}
	settings := a.GetSettings()
	if settings.APIKey == "" {
		return project, errors.New("请先在设置中填写 Agnes API Key")
	}
	scene := &project.Scenes[sceneIndex]
	dir := filepath.Join(projectDir(project), scene.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return project, err
	}
	size := "480x854"
	if project.Format == "16:9" {
		size = "854x480"
	}
	payload := map[string]any{
		"model": "agnes-image-2.1-flash", "prompt": scene.Prompt,
		"size": size, "n": 1,
	}
	data, err := a.agnesJSON(settings, http.MethodPost, "/images/generations", payload, 180*time.Second)
	if err != nil {
		return project, err
	}
	mediaURL, mediaB64 := extractMedia(data)
	path := filepath.Join(dir, "first-frame.png")
	if err := saveRemoteMedia(path, mediaURL, mediaB64); err != nil {
		return project, err
	}
	scene.ImagePath = path
	scene.Status = "image-ready"
	return project, a.SaveProject(project)
}

func (a *App) GenerateVideo(project Project, sceneIndex int) (Project, error) {
	if sceneIndex < 0 || sceneIndex >= len(project.Scenes) {
		return project, errors.New("场景不存在")
	}
	settings := a.GetSettings()
	if settings.APIKey == "" {
		return project, errors.New("请先在设置中填写 Agnes API Key")
	}
	scene := &project.Scenes[sceneIndex]
	dir := filepath.Join(projectDir(project), scene.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return project, err
	}
	width, height := 480, 854
	if project.Format == "16:9" {
		width, height = 854, 480
	}
	frames := ((scene.Duration*24+7)/8)*8 + 1
	if frames < 121 {
		frames = 121
	}
	maxFrames := 961
	if width*height > 854*480 {
		maxFrames = 409
	}
	if frames > maxFrames {
		frames = maxFrames
	}
	prompt := scene.Prompt
	if scene.Description != "" {
		prompt += "\n动作和结束状态：" + scene.Description
	}
	payload := map[string]any{
		"model": "agnes-video-v2.0", "prompt": prompt,
		"width": width, "height": height, "num_frames": frames, "frame_rate": 24,
	}
	if scene.ImagePath != "" {
		if image, err := fileDataURL(scene.ImagePath); err == nil {
			payload["image"] = image
			payload["mode"] = "ti2vid"
		}
	}
	if sceneIndex > 0 && project.Scenes[sceneIndex-1].VideoPath != "" {
		previousFrame := filepath.Join(projectDir(project), project.Scenes[sceneIndex-1].ID, "last-frame.jpg")
		if err := extractLastFrame(project.Scenes[sceneIndex-1].VideoPath, previousFrame); err == nil {
			if image, err := fileDataURL(previousFrame); err == nil {
				payload["image"] = image
				payload["mode"] = "ti2vid"
			}
		}
	}
	created, err := a.agnesJSON(settings, http.MethodPost, "/videos", payload, 120*time.Second)
	if err != nil {
		return project, err
	}
	videoID := firstString(created, "video_id", "task_id", "id")
	if videoID == "" {
		return project, errors.New("Agnes 没有返回视频任务 ID")
	}
	final, err := a.pollVideo(settings, videoID)
	if err != nil {
		return project, err
	}
	videoURL, _ := extractMedia(final)
	if videoURL == "" {
		return project, errors.New("视频任务完成但没有返回下载地址")
	}
	videoPath := filepath.Join(dir, "video.mp4")
	if err := saveRemoteMedia(videoPath, videoURL, ""); err != nil {
		return project, err
	}
	scene.VideoPath = videoPath
	scene.Status = "video-ready"
	return project, a.SaveProject(project)
}

func (a *App) GenerateProject(project Project) (Project, error) {
	if len(project.Scenes) == 0 {
		return project, errors.New("请先分析故事并生成场景")
	}
	for i := range project.Scenes {
		var err error
		project, err = a.GenerateImage(project, i)
		if err != nil {
			return project, fmt.Errorf("场景 %d 图片生成失败: %w", i+1, err)
		}
		project, err = a.GenerateVideo(project, i)
		if err != nil {
			return project, fmt.Errorf("场景 %d 视频生成失败: %w", i+1, err)
		}
	}
	return a.ExportProject(project)
}

func (a *App) GenerateAudio(project Project) (Project, error) {
	dir := projectDir(project)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return project, err
	}
	var parts []string
	for _, scene := range project.Scenes {
		text := strings.TrimSpace(scene.Dialogue)
		if text == "" {
			text = strings.TrimSpace(scene.Description)
		}
		if text != "" {
			parts = append(parts, text)
		}
	}
	if len(parts) == 0 {
		parts = []string{project.Story}
	}
	narration := strings.Join(parts, "\n")
	audioPath := filepath.Join(dir, "narration.mp3")
	if err := generateTTS(narration, audioPath, 0); err != nil {
		return project, err
	}
	if err := writeSRT(narration, filepath.Join(dir, "subtitles.srt")); err != nil {
		return project, err
	}
	project.AudioPath = audioPath
	project.SubtitlePath = filepath.Join(dir, "subtitles.srt")
	return project, a.SaveProject(project)
}

func (a *App) ExportProject(project Project) (Project, error) {
	dir := projectDir(project)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return project, err
	}
	var videos []string
	for _, scene := range project.Scenes {
		if scene.VideoPath != "" {
			videos = append(videos, scene.VideoPath)
		}
	}
	if len(videos) == 0 {
		return project, errors.New("没有可导出的视频片段")
	}
	listPath := filepath.Join(dir, "concat.txt")
	var list strings.Builder
	for _, video := range videos {
		list.WriteString("file '")
		list.WriteString(strings.ReplaceAll(video, "'", "'\\''"))
		list.WriteString("'\n")
	}
	if err := os.WriteFile(listPath, []byte(list.String()), 0o600); err != nil {
		return project, err
	}
	joined := filepath.Join(dir, "joined.mp4")
	if err := runCommand(180*time.Second, "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", joined); err != nil {
		return project, fmt.Errorf("拼接视频失败: %w", err)
	}
	audioPath := filepath.Join(dir, "narration.mp3")
	if _, err := os.Stat(audioPath); err != nil {
		if _, err := a.GenerateAudio(project); err != nil {
			return project, err
		}
	}
	srtPath := filepath.Join(dir, "subtitles.srt")
	finalPath := filepath.Join(dir, "final.mp4")
	args := []string{"-y", "-i", joined, "-i", audioPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-c:a", "aac", "-shortest"}
	if _, err := os.Stat(srtPath); err == nil {
		args = append(args, "-vf", "subtitles="+ffmpegFilterPath(srtPath))
	}
	args = append(args, finalPath)
	if err := runCommand(180*time.Second, "ffmpeg", args...); err != nil {
		return project, fmt.Errorf("最终合成失败: %w", err)
	}
	project.FinalPath = finalPath
	return project, a.SaveProject(project)
}

func (a *App) GetMediaData(path string) (string, error) { return fileDataURL(path) }

func (a *App) agnesJSON(settings Settings, method, endpoint string, payload any, timeout time.Duration) (map[string]any, error) {
	body, _ := json.Marshal(payload)
	base := "https://api.agnes-ai." + settings.Domain + "/v1" + endpoint
	req, err := http.NewRequest(method, base, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+settings.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接 Agnes 失败: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Agnes 返回 HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *App) pollVideo(settings Settings, id string) (map[string]any, error) {
	base := "https://api.agnes-ai." + settings.Domain + "/v1/agnesapi?video_id=" + id
	for attempt := 0; attempt < 180; attempt++ {
		req, _ := http.NewRequest(http.MethodGet, base, nil)
		req.Header.Set("Authorization", "Bearer "+settings.APIKey)
		resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
		if err != nil {
			return nil, err
		}
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("视频状态查询 HTTP %d: %s", resp.StatusCode, string(data))
		}
		var result map[string]any
		if err := json.Unmarshal(data, &result); err != nil {
			return nil, err
		}
		status := strings.ToLower(firstString(result, "status"))
		if status == "completed" || status == "success" || status == "succeeded" {
			return result, nil
		}
		if status == "failed" || status == "error" {
			return nil, fmt.Errorf("Agnes 视频任务失败: %s", firstString(result, "error", "message"))
		}
		time.Sleep(10 * time.Second)
	}
	return nil, errors.New("视频任务轮询超时")
}

func firstString(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := data[key].(string); ok {
			return value
		}
	}
	return ""
}

func extractMedia(data map[string]any) (string, string) {
	if value := firstString(data, "url", "video_url", "b64_json"); value != "" {
		if strings.HasPrefix(value, "data:") {
			return "", value
		}
		return value, ""
	}
	if nested, ok := data["data"].([]any); ok && len(nested) > 0 {
		if item, ok := nested[0].(map[string]any); ok {
			return extractMedia(item)
		}
	}
	if nested, ok := data["data"].(map[string]any); ok {
		return extractMedia(nested)
	}
	for _, key := range []string{"video_url", "url"} {
		if value, ok := data[key].(string); ok {
			return value, ""
		}
	}
	return "", ""
}

func saveRemoteMedia(path, mediaURL, mediaB64 string) error {
	var data []byte
	var err error
	if mediaB64 != "" {
		data, err = base64.StdEncoding.DecodeString(mediaB64)
	} else if strings.HasPrefix(mediaURL, "data:") {
		data, err = decodeDataURL(mediaURL)
	} else {
		resp, requestErr := (&http.Client{Timeout: 180 * time.Second}).Get(mediaURL)
		if requestErr != nil {
			return requestErr
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("下载媒体 HTTP %d", resp.StatusCode)
		}
		data, err = io.ReadAll(resp.Body)
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return errors.New("媒体内容为空")
	}
	return os.WriteFile(path, data, 0o600)
}

func decodeDataURL(value string) ([]byte, error) {
	parts := strings.SplitN(value, ",", 2)
	if len(parts) != 2 {
		return nil, errors.New("无效的 data URL")
	}
	return base64.StdEncoding.DecodeString(parts[1])
}

func fileDataURL(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	ext := "application/octet-stream"
	if strings.HasSuffix(path, ".png") {
		ext = "image/png"
	} else if strings.HasSuffix(path, ".jpg") || strings.HasSuffix(path, ".jpeg") {
		ext = "image/jpeg"
	} else if strings.HasSuffix(path, ".mp4") {
		ext = "video/mp4"
	}
	return "data:" + ext + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func extractLastFrame(video, output string) error {
	return runCommand(30*time.Second, "ffmpeg", "-y", "-sseof", "-1", "-i", video, "-frames:v", "1", "-update", "1", output)
}

func generateTTS(text, output string, _ int) error {
	if path, err := exec.LookPath("edge-tts"); err == nil {
		return runCommand(120*time.Second, path, "--voice", "zh-CN-XiaoxiaoNeural", "--text", text, "--write-media", output)
	}
	if python, err := exec.LookPath("python3"); err == nil {
		if err := runCommand(120*time.Second, python, "-m", "edge_tts", "--voice", "zh-CN-XiaoxiaoNeural", "--text", text, "--write-media", output); err == nil {
			return nil
		}
	}
	duration := float64(len([]rune(text))) / 4
	if duration < 1 {
		duration = 1
	}
	return runCommand(30*time.Second, "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", strconv.FormatFloat(duration, 'f', 2, 64), "-c:a", "libmp3lame", "-q:a", "4", output)
}

func writeSRT(text, path string) error {
	var out strings.Builder
	start := 0.0
	index := 1
	for _, sentence := range splitSentences(text) {
		duration := float64(len([]rune(sentence))) / 4
		if duration < 1 {
			duration = 1
		}
		out.WriteString(fmt.Sprintf("%d\n%s --> %s\n%s\n\n", index, srtTime(start), srtTime(start+duration), sentence))
		start += duration
		index++
	}
	return os.WriteFile(path, []byte(out.String()), 0o600)
}

func splitSentences(text string) []string {
	var result []string
	var current strings.Builder
	for _, char := range text {
		current.WriteRune(char)
		if strings.ContainsRune("。！？.!?\n", char) {
			result = append(result, strings.TrimSpace(current.String()))
			current.Reset()
		}
	}
	if strings.TrimSpace(current.String()) != "" {
		result = append(result, strings.TrimSpace(current.String()))
	}
	return result
}

func srtTime(seconds float64) string {
	total := int(seconds * 1000)
	h := total / 3600000
	total %= 3600000
	m := total / 60000
	total %= 60000
	s := total / 1000
	ms := total % 1000
	return fmt.Sprintf("%02d:%02d:%02d,%03d", h, m, s, ms)
}

func ffmpegFilterPath(path string) string {
	return strings.ReplaceAll(strings.ReplaceAll(path, "\\", "/"), ":", "\\:")
}

func runCommand(timeout time.Duration, name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (a *App) PlanStory(request PlanRequest) (Project, error) {
	if strings.TrimSpace(request.Story) == "" {
		return request.Project, errors.New("请先输入故事或创意")
	}
	settings := a.GetSettings()
	if strings.TrimSpace(settings.APIKey) == "" {
		project := request.Project
		project.Scenes = demoScenes(request.Story)
		return project, nil
	}

	system := `你是视频分镜规划器。把用户故事拆成适合 AI 短视频生成的场景。
只输出 JSON，不要 Markdown。格式必须是 {"scenes":[{"id":"scene-001","title":"","duration":8,"location":"","characters":[],"description":"","dialogue":"","prompt":"","status":"draft"}]}。
每个场景 5 到 15 秒；动作要简单、可视化；明确场景结束状态；不要承诺复杂连续动作。`
	user, _ := json.Marshal(map[string]any{
		"story": request.Story, "characters": request.Characters, "locations": request.Locations,
		"format": request.Project.Format, "target_duration": request.Project.Duration,
	})
	result, err := a.chat(settings, system, string(user))
	if err != nil {
		return request.Project, err
	}
	result = cleanJSON(result)
	var envelope planEnvelope
	if err := json.Unmarshal([]byte(result), &envelope); err != nil {
		return request.Project, fmt.Errorf("模型返回的分镜不是有效 JSON: %w", err)
	}
	for i := range envelope.Scenes {
		if envelope.Scenes[i].ID == "" {
			envelope.Scenes[i].ID = fmt.Sprintf("scene-%03d", i+1)
		}
		if envelope.Scenes[i].Status == "" {
			envelope.Scenes[i].Status = "draft"
		}
	}
	request.Project.Scenes = envelope.Scenes
	return request.Project, nil
}

func demoScenes(story string) []Scene {
	short := strings.TrimSpace(story)
	if len([]rune(short)) > 70 {
		short = string([]rune(short)[:70]) + "..."
	}
	return []Scene{
		{ID: "scene-001", Title: "开场建立镜头", Duration: 8, Description: "建立故事发生的地点和氛围，主体进入画面。", Prompt: "电影感建立镜头，交代环境和主体，动作自然，画面稳定。", Status: "draft"},
		{ID: "scene-002", Title: "冲突出现", Duration: 10, Description: "故事中的主要问题出现，角色做出明确反应。", Prompt: "中景和近景切换，角色发现问题并做出清晰、简单的动作，保持角色外观一致。", Status: "draft"},
		{ID: "scene-003", Title: "情节推进", Duration: 10, Description: short, Prompt: "连续动作短片段，从上一场景的结束状态继续，避免高速复杂动作。", Status: "draft"},
		{ID: "scene-004", Title: "结尾画面", Duration: 8, Description: "故事收束，停留在一个稳定、适合衔接和配音的结束画面。", Prompt: "温暖的结尾镜头，人物和环境保持稳定，最后停留在清晰构图。", Status: "draft"},
	}
}

func (a *App) chat(settings Settings, system, user string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":       "agnes-2.5-flash",
		"messages":    []map[string]string{{"role": "system", "content": system}, {"role": "user", "content": user}},
		"temperature": 0.4,
	})
	base := "https://api.agnes-ai." + settings.Domain + "/v1/chat/completions"
	req, err := http.NewRequest(http.MethodPost, base, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+settings.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("连接 Agnes 失败: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Agnes 返回 HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &result); err != nil || len(result.Choices) == 0 {
		return "", errors.New("Agnes 返回内容为空")
	}
	return result.Choices[0].Message.Content, nil
}

func cleanJSON(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "```json")
	value = strings.TrimPrefix(value, "```")
	value = strings.TrimSuffix(value, "```")
	return strings.TrimSpace(value)
}
