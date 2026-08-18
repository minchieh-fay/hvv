package tunnel

import (
	"bufio"
	"fmt"
	"io"
)

// help_relayLogs 转发 cloudflared 日志并提取 Quick Tunnel 公网地址。
func help_relayLogs(reader io.Reader, output io.Writer, urls chan<- string) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		_, _ = fmt.Fprintln(output, line)
		if url := publicURLPattern.FindString(line); url != "" {
			select {
			case urls <- url:
			default:
			}
		}
	}
}
