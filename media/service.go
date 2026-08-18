package media

import (
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
	Path string `json:"path"`
	URL  string `json:"url"`
	Date string `json:"date"`
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
		path := filepath.Join(date, "img", entry.Name())
		files = append(files, File{Path: path, Date: date})
	}
	return files, nil
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
	name := fmt.Sprintf("%s-%04d.%s", time.Now().Format("150405.000"), time.Now().UnixNano()%10000, strings.TrimPrefix(extension, "."))
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0600); err != nil {
		return File{}, err
	}
	return File{Path: filepath.Join(date, "img", name), Date: date}, nil
}
