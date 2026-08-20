// 读取视频模块使用的公共日期字符串。
export function getVideoDate() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

// 将 Agnes 返回的字符串、对象或数组错误转换为可读文本。
export function describeVideoError(error, fallback = "视频请求失败") {
  if (typeof error === "string" && error.trim()) return error;
  if (error?.message && typeof error.message === "string") return error.message;
  if (error && typeof error === "object") {
    const detail = error.message || error.detail || error.code || error.type;
    if (typeof detail === "string" && detail.trim()) return detail;
    try {
      return JSON.stringify(error, null, 2);
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

// 将图片模型返回的 Data URL 直接解码为二进制 Blob，避免依赖浏览器 fetch Data URL。
export function dataURLToBlob(dataURL) {
  const match = String(dataURL || "").match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error("图片模型返回的数据格式无效");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

// 创建视频 Session 并返回初始化配置。
export async function createVideoSession(payload) {
  const response = await fetch("/api/videos/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "创建视频 Session 失败");
  return result;
}

// 读取视频制作列表中的 Session。
export async function listVideoSessions(date = getVideoDate()) {
  const response = await fetch(`/api/videos/sessions?date=${encodeURIComponent(date)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "读取视频列表失败");
  return result;
}

// 删除视频 Session 及其生成的全部媒体文件。
export async function deleteVideoSession(session) {
  const response = await fetch(
    `/api/videos/sessions/${encodeURIComponent(session.id)}?date=${encodeURIComponent(session.date)}`,
    { method: "DELETE" },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "删除视频 Session 失败");
  return result;
}

// 读取视频 Session 的持久化配置。
export async function loadVideoSession(session) {
  const response = await fetch(
    `/api/videos/sessions/${encodeURIComponent(session.id)}?date=${encodeURIComponent(session.date)}`,
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "读取视频 Session 失败");
  return result;
}

// 保存完整的视频 Session 配置。
export async function saveVideoSession(session) {
  const response = await fetch(
    `/api/videos/sessions/${encodeURIComponent(session.id)}?date=${encodeURIComponent(session.date)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存视频 Session 失败");
  return result;
}

// 保存视频 Session 下的任意媒体文件或 manifest。
export async function saveVideoFile(session, path, data) {
  const body = data instanceof Blob ? await data.arrayBuffer() : data;
  const size = body?.byteLength ?? body?.size ?? 0;
  if (!size) throw new Error(`保存视频媒体失败：${path} 内容为 0 字节`);
  const response = await fetch(
    `/api/videos/sessions/${encodeURIComponent(session.id)}/files?date=` +
      `${encodeURIComponent(session.date)}&path=${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body,
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存视频媒体失败");
  return result;
}

// 读取图片库和图片模块共享的公网媒体地址。
export async function loadVideoContext() {
  const [settingsResponse, statusResponse] = await Promise.all([fetch("/api/settings"), fetch("/api/images/status")]);
  const settings = await settingsResponse.json();
  const status = await statusResponse.json();
  if (!settingsResponse.ok || !statusResponse.ok) throw new Error("读取视频工具配置失败");
  return { settings, publicURL: status.publicURL };
}

// 读取指定日期的图片参考项。
export async function listVideoReferences(date) {
  const response = await fetch(`/api/images/references?date=${encodeURIComponent(date)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "读取视频参考图失败");
  return result;
}

// 保存视频模块中粘贴或导入的图片到共享图片库。
export async function saveVideoReference(dataURL, name = "") {
  const response = await fetch("/api/images/references", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataURL, name }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "保存参考图失败");
  return result;
}

// 将本地媒体相对路径转换为 Agnes 可访问的公网 URL。
export function buildPublicMediaURL(publicURL, path) {
  return `${publicURL.replace(/\/$/, "")}/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// 调用 Agnes Image 2.1 Flash 生成视频关键帧图片。
export async function callAgnesImage(payload, context, signal, onResponse = async () => {}) {
  const references = payload.references || [];
  const requestBody = {
    model: "agnes-image-2.1-flash",
    prompt: payload.prompt,
    size: payload.size || "1K",
    ratio: payload.ratio,
    extra_body: {
      response_format: "b64_json",
      ...(references.length
        ? { image: references.map((path) => buildPublicMediaURL(context.publicURL, path)) }
        : {}),
    },
  };
  const response = await fetch(`${context.settings.baseURL}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.settings.apiKey}` },
    body: JSON.stringify(requestBody),
    signal,
  });
  const result = await response.json();
  await onResponse(result, response.status);
  if (!response.ok) throw new Error(describeVideoError(result.error, "关键帧图片生成失败"));
  const item = result.data?.[0];
  if (!item?.b64_json) throw new Error("Agnes 没有返回关键帧图片");
  return `data:image/png;base64,${item.b64_json}`;
}

// 创建 Agnes Video 2.0 异步任务。
export async function createAgnesVideo(payload, context, signal) {
  const response = await fetch(`${context.settings.baseURL}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.settings.apiKey}` },
    body: JSON.stringify({
      model: "agnes-video-v2.0",
      prompt: payload.prompt,
      mode: "keyframes",
      width: payload.ratio === "16:9" ? 1152 : 768,
      height: payload.ratio === "16:9" ? 768 : 1152,
      num_frames: payload.numFrames,
      frame_rate: 24,
      extra_body: {
        mode: "keyframes",
        image: payload.frames.map((path) => buildPublicMediaURL(context.publicURL, path)),
      },
    }),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(describeVideoError(result.error, "视频任务创建失败"));
  return result;
}

// 查询 Agnes 视频任务直到完成或失败。
export async function waitForAgnesVideo(
  task,
  context,
  signal,
  onProgress = () => {},
  onResponse = async () => {},
) {
  const videoID = task.video_id || task.id || task.task_id;
  if (!videoID) throw new Error("视频任务没有返回 video_id");
  const rootURL = context.settings.baseURL.replace(/\/v1\/?$/, "");
  for (;;) {
    const response = await fetch(`${rootURL}/agnesapi?video_id=${encodeURIComponent(videoID)}`, {
      headers: { Authorization: `Bearer ${context.settings.apiKey}` },
      signal,
    });
    const result = await response.json();
    await onResponse(result, response.status);
    if (!response.ok) {
      const message = describeVideoError(result.error, "查询视频任务失败");
      if (/rate limit|限流/i.test(message)) {
        await waitForVideoRetry(60000, signal);
        continue;
      }
      throw new Error(message);
    }
    onProgress(result.progress || 0, result.status);
    if (result.status === "completed") return result;
    if (result.status === "failed") throw new Error(describeVideoError(result.error, "视频生成失败"));
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, 1800);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          reject(new DOMException("已取消", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

// 等待视频接口限流窗口结束，避免重新创建相同的视频任务。
function waitForVideoRetry(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("已取消", "AbortError"));
      },
      { once: true },
    );
  });
}
