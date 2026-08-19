// 记录视频 Session 的 Agent 事件、提示词和工具调用信息。
export async function appendVideoLog(session, event, payload = {}) {
  if (!session?.id || !session?.date) return;
  const record = {
    timestamp: new Date().toISOString(),
    sessionID: session.id,
    event,
    payload,
  };
  const response = await fetch(
    `/api/videos/sessions/${encodeURIComponent(session.id)}/logs?date=` +
      `${encodeURIComponent(session.date)}&path=logs/agent.jsonl`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "写入视频日志失败");
  return result;
}
