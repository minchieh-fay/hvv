import { setTraceProcessors, setTracingDisabled } from "@openai/agents";
import { appendVideoLog } from "../log";

const SENSITIVE_KEYS = /api[-_]?key|authorization|password|secret|token/i;

// 读取本地调试开关，默认不记录模型输入输出和工具参数。
export function isAgentTraceSensitiveEnabled() {
  return localStorage.getItem("hvv.agentTraceSensitive") === "true";
}

// 设置是否允许 Agents SDK 把敏感输入输出放入 Trace span。
export function setAgentTraceSensitiveEnabled(enabled) {
  localStorage.setItem("hvv.agentTraceSensitive", String(Boolean(enabled)));
}

// 删除日志对象中的 API Key、Token 和 Base64 内容，避免调试日志泄露凭据。
function help_redact(value, key = "") {
  if (SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (value.startsWith("data:image/") || value.length > 20000) {
      return `[REDACTED_STRING length=${value.length}]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => help_redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, help_redact(entryValue, entryKey)]),
    );
  }
  return value;
}

// 将 SDK Trace 或 Span 转换为可持久化的 JSON 日志事件。
function help_tracePayload(item) {
  const data = item.spanData || item.metadata || {};
  return help_redact({
    traceId: item.traceId,
    spanId: item.spanId,
    parentId: item.parentId,
    type: item.type,
    name: item.name,
    data,
    error: item.error,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
  });
}

// 创建把 Agents SDK 生命周期事件写入当前视频 Session 的 Trace processor。
function createSessionTraceProcessor(session) {
  const write = (event, item) => appendVideoLog(session, event, help_tracePayload(item)).catch(() => {});
  return {
    onTraceStart: async (trace) => write("agent.trace.started", trace),
    onTraceEnd: async (trace) => write("agent.trace.completed", trace),
    onSpanStart: async (span) => write("agent.span.started", span),
    onSpanEnd: async (span) => write("agent.span.completed", span),
    shutdown: async () => {},
    forceFlush: async () => {},
  };
}

// 为一个 Session 打开本地 Trace，并注册完整的 Agent 生命周期记录器。
export function configureVideoTracing(session) {
  setTracingDisabled(false);
  setTraceProcessors([createSessionTraceProcessor(session)]);
  return { traceIncludeSensitiveData: isAgentTraceSensitiveEnabled() };
}
