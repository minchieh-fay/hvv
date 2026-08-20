package media

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const retentionDays = 10

// File 描述一个可通过本地 HTTP 服务访问的媒体文件。
type File struct {
	Path      string `json:"path"`
	URL       string `json:"url"`
	Date      string `json:"date"`
	Generated bool   `json:"generated,omitempty"`
	Number    int    `json:"number,omitempty"`
}

// Service 负责管理 hvv 的本地媒体目录。
type Service struct {
	root string
}

// New 创建媒体服务并初始化媒体根目录。
func New() (*Service, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	root := filepath.Join(home, ".hvv", "media")
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	return &Service{root: root}, nil
}

// Root 返回媒体根目录，供 HTTP 静态服务使用。
func (s *Service) Root() string { return s.root }

// SaveDataURL 将前端传来的图片 Data URI 保存到当天的图片目录。
func (s *Service) SaveDataURL(dataURL, extension string) (File, error) {
	data, detectedExtension, err := help_decodeDataURL(dataURL)
	if err != nil {
		return File{}, err
	}
	if extension == "" {
		extension = detectedExtension
	}
	return s.saveBytes(data, extension)
}

// SaveReader 将上传的图片流保存到当天的图片目录。
func (s *Service) SaveReader(reader io.Reader, extension string) (File, error) {
	data, err := io.ReadAll(io.LimitReader(reader, 32<<20))
	if err != nil {
		return File{}, err
	}
	return s.saveBytes(data, extension)
}

// List 返回指定日期的图片文件，日期为空时使用今天。
func (s *Service) List(date string) ([]File, error) {
	if date == "" {
		date = time.Now().Format("20060102")
	}
	if !help_validDate(date) {
		return nil, fmt.Errorf("日期格式错误")
	}
	dir := filepath.Join(s.root, date, "img")
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []File{}, nil
	}
	if err != nil {
		return nil, err
	}
	files := make([]File, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(entry.Name(), ".image.json") {
			data, readErr := os.ReadFile(filepath.Join(dir, entry.Name()))
			if readErr != nil {
				continue
			}
			var file File
			if jsonErr := json.Unmarshal(data, &file); jsonErr != nil || !file.Generated {
				continue
			}
			file.Path = filepath.ToSlash(filepath.Join(date, "img", entry.Name()))
			file.Date = date
			files = append(files, file)
			continue
		}
		path := filepath.Join(date, "img", entry.Name())
		files = append(files, File{Path: path, Date: date})
	}
	help_sortFilesNewestFirst(files)
	help_numberGeneratedFiles(files)
	return files, nil
}

// SaveRemoteImage 保存 Agnes 官方图片地址，供图片库和后续图生图使用。
func (s *Service) SaveRemoteImage(remoteURL string) (File, error) {
	date := time.Now().Format("20060102")
	dir := filepath.Join(s.root, date, "img")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return File{}, err
	}
	name := fmt.Sprintf("generated-%s-%04d.image.json", time.Now().Format("150405.000"),
		time.Now().UnixNano()%10000)
	file := File{
		Path: filepath.Join(date, "img", name), URL: remoteURL, Date: date, Generated: true,
	}
	data, err := json.Marshal(file)
	if err != nil {
		return File{}, err
	}
	if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
		return File{}, err
	}
	return file, nil
}

// CreateVideoSession 创建视频 Session 目录并保存初始配置。
func (s *Service) CreateVideoSession(date, sessionID string, data []byte) (File, error) {
	if err := help_validateVideoLocation(date, sessionID, ""); err != nil {
		return File{}, err
	}
	return s.saveVideoBytes(date, sessionID, "session.json", data)
}

// ReadVideoSession 读取视频 Session 的配置文件。
func (s *Service) ReadVideoSession(date, sessionID string) ([]byte, error) {
	if err := help_validateVideoLocation(date, sessionID, ""); err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(s.root, date, "video", sessionID, "session.json"))
}

// ListVideoSessions 返回指定日期下的视频 Session 配置列表。
func (s *Service) ListVideoSessions(date string) ([]map[string]any, error) {
	if date == "" {
		date = time.Now().Format("20060102")
	}
	if !help_validDate(date) {
		return nil, fmt.Errorf("日期格式错误")
	}
	dir := filepath.Join(s.root, date, "video")
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	sessions := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !help_videoIDPattern.MatchString(entry.Name()) {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(dir, entry.Name(), "session.json"))
		if readErr != nil {
			continue
		}
		var session map[string]any
		if jsonErr := json.Unmarshal(data, &session); jsonErr != nil {
			continue
		}
		sessions = append(sessions, session)
	}
	return sessions, nil
}

// DeleteVideoSession 删除指定视频 Session 及其所有片段、日志和生成媒体。
func (s *Service) DeleteVideoSession(date, sessionID string) error {
	if err := help_validateVideoLocation(date, sessionID, ""); err != nil {
		return err
	}
	path := filepath.Join(s.root, date, "video", sessionID)
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("删除视频 Session 失败: %w", err)
	}
	return nil
}

// SaveVideoFile 保存视频模块的 JSON、图片或视频文件。
func (s *Service) SaveVideoFile(date, sessionID, relativePath string, data []byte) (File, error) {
	if err := help_validateVideoLocation(date, sessionID, relativePath); err != nil {
		return File{}, err
	}
	return s.saveVideoBytes(date, sessionID, relativePath, data)
}

// AppendVideoFile 向视频 Session 的日志文件追加一行内容。
func (s *Service) AppendVideoFile(date, sessionID, relativePath string, data []byte) (File, error) {
	if err := help_validateVideoLogLocation(date, sessionID, relativePath); err != nil {
		return File{}, err
	}
	dir := filepath.Join(s.root, date, "video", sessionID, filepath.Dir(filepath.FromSlash(relativePath)))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return File{}, err
	}
	absolutePath := filepath.Join(dir, filepath.Base(filepath.FromSlash(relativePath)))
	file, err := os.OpenFile(absolutePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return File{}, err
	}
	defer file.Close()
	if _, err := file.Write(data); err != nil {
		return File{}, err
	}
	path := filepath.Join(date, "video", sessionID, filepath.FromSlash(relativePath))
	return File{Path: filepath.ToSlash(path), Date: date}, nil
}

// ReadVideoFile 读取视频 Session 下的指定文件内容。
func (s *Service) ReadVideoFile(date, sessionID, relativePath string) ([]byte, error) {
	if err := help_validateVideoLocation(date, sessionID, relativePath); err != nil {
		return nil, err
	}
	return os.ReadFile(filepath.Join(s.root, date, "video", sessionID, filepath.FromSlash(relativePath)))
}

// Delete 删除媒体根目录内指定的图片文件。
func (s *Service) Delete(relativePath string) error {
	absolutePath, err := filepath.Abs(filepath.Join(s.root, filepath.FromSlash(relativePath)))
	if err != nil {
		return err
	}
	root, err := filepath.Abs(s.root)
	if err != nil || !help_isInside(root, absolutePath) {
		return fmt.Errorf("图片路径无效")
	}
	if filepath.Base(filepath.Dir(absolutePath)) != "img" {
		return fmt.Errorf("只能删除图片文件")
	}
	return os.Remove(absolutePath)
}

// Cleanup 删除超过保留天数的日期目录。
func (s *Service) Cleanup(now time.Time) error {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return err
	}
	limit := now.AddDate(0, 0, -retentionDays)
	for _, entry := range entries {
		if !entry.IsDir() || !help_validDate(entry.Name()) {
			continue
		}
		date, _ := time.Parse("20060102", entry.Name())
		if date.Before(limit) {
			if err := os.RemoveAll(filepath.Join(s.root, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// saveBytes 生成唯一文件名并写入媒体文件。
func (s *Service) saveBytes(data []byte, extension string) (File, error) {
	date := time.Now().Format("20060102")
	dir := filepath.Join(s.root, date, "img")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return File{}, err
	}
	name := fmt.Sprintf(
		"%s-%04d.%s",
		time.Now().Format("150405.000"),
		time.Now().UnixNano()%10000,
		strings.TrimPrefix(extension, "."),
	)
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0600); err != nil {
		return File{}, err
	}
	return File{Path: filepath.Join(date, "img", name), Date: date}, nil
}

// saveVideoBytes 将视频模块文件写入指定 Session 目录。
func (s *Service) saveVideoBytes(date, sessionID, relativePath string, data []byte) (File, error) {
	dir := filepath.Join(s.root, date, "video", sessionID, filepath.Dir(filepath.FromSlash(relativePath)))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return File{}, err
	}
	absPath := filepath.Join(dir, filepath.Base(filepath.FromSlash(relativePath)))
	if err := os.WriteFile(absPath, data, 0600); err != nil {
		return File{}, err
	}
	path := filepath.Join(date, "video", sessionID, filepath.FromSlash(relativePath))
	return File{Path: filepath.ToSlash(path), Date: date}, nil
}
