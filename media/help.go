package media

import (
	"encoding/base64"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var help_datePattern = regexp.MustCompile(`^\d{8}$`)

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

// help_isInside 判断目标路径是否位于媒体根目录内。
func help_isInside(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
