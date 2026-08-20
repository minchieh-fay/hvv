// 将工具异常转换为 Agent 可以判断的结构化错误。
export function help_toolError(error, type = "tool_error") {
  return {
    success: false,
    error: { type, message: error?.message || String(error) },
  };
}
