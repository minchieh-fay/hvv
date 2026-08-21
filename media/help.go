package media

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var help_datePattern = regexp.MustCompile(`^\d{8}$`)
var help_videoIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// help_listVideoSessions 读取指定日期目录下的全部视频 Session。
func help_listVideoSessions(root, date string) ([]map[string]any, error) {
	dir := filepath.Join(root, date, "video")
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

// help_decodeDataURL 解码图片 Data URI 并推断文件扩展名。
func help_decodeDataURL(value string) ([]byte, string, error) {
	parts := strings.SplitN(value, ",", 2)
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "data:image/") {
		return nil, "", fmt.Errorf("参考图必须是图片 Data URI")
	}
	mime := strings.TrimPrefix(strings.Split(parts[0], ";")[0], "data:image/")
	ext := filepath.Ext("." + mime)
	data, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, "", fmt.Errorf("图片编码无效: %w", err)
	}
	return data, strings.TrimPrefix(ext, "."), nil
}

// help_validDate 校验媒体日期目录名称。
func help_validDate(value string) bool { return help_datePattern.MatchString(value) }

// help_sortFilesNewestFirst 按文件修改时间将图片按最新优先排序。
func help_sortFilesNewestFirst(files []File) {
	sort.SliceStable(files, func(left, right int) bool {
		return help_fileTime(files[left]).After(help_fileTime(files[right]))
	})
}

// help_fileTime 从图片路径中的时间部分提取创建时间，无法提取时返回零值。
func help_fileTime(file File) time.Time {
	name := filepath.Base(file.Path)
	name = strings.TrimPrefix(name, "generated-")
	name = strings.TrimSuffix(name, ".image.json")
	parts := strings.SplitN(name, "-", 2)
	if len(parts) == 0 {
		return time.Time{}
	}
	value, err := time.Parse("150405.000", parts[0])
	if err != nil {
		return time.Time{}
	}
	return value
}

// help_numberGeneratedFiles 按生成时间从早到晚给网络图片分配编号。
func help_numberGeneratedFiles(files []File) {
	number := 1
	for index := len(files) - 1; index >= 0; index-- {
		if files[index].Generated {
			files[index].Number = number
			number++
		}
	}
}

// help_isInside 判断目标路径是否位于媒体根目录内。
func help_isInside(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

// help_validateVideoLocation 校验视频 Session 和媒体文件的相对路径。
func help_validateVideoLocation(date, sessionID, relativePath string) error {
	if !help_validDate(date) || !help_videoIDPattern.MatchString(sessionID) {
		return fmt.Errorf("视频 Session 标识无效")
	}
	if relativePath == "" {
		return nil
	}
	clean := filepath.Clean(filepath.FromSlash(relativePath))
	outsideSession := strings.HasPrefix(clean, ".."+string(filepath.Separator))
	if clean == "." || filepath.IsAbs(clean) || outsideSession || clean == ".." {
		return fmt.Errorf("视频媒体路径无效")
	}
	return nil
}

// help_validateVideoLogLocation 限制日志只能写入 Session 的 logs 目录。
func help_validateVideoLogLocation(date, sessionID, relativePath string) error {
	if err := help_validateVideoLocation(date, sessionID, relativePath); err != nil {
		return err
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(relativePath)))
	if !strings.HasPrefix(clean, "logs/") || filepath.Ext(clean) != ".jsonl" {
		return fmt.Errorf("日志路径必须位于 logs 目录且使用 jsonl 文件")
	}
	return nil
}
