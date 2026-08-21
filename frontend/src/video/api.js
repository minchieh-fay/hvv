import {
  help_describeError,
  help_isVideoServiceBusy,
  help_mediaURL,
  help_videoSize,
  help_videoRetryDelay,
  help_wait,
  help_waitCountdown,
} from "./help";

// 创建视频制作 Session。
export async function createVideoSession(ratio) {
  return requestJSON("/api/videos/sessions", {
    method: "POST",
    body: JSON.stringify({
      ratio,
      orientation: ["16:9", "4:3"].includes(ratio) ? "横屏" : "竖屏",
    }),
  });
}

// 读取视频制作列表。
export async function listVideoSessions(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return requestJSON(`/api/videos/sessions${query}`);
}

// 读取单个视频 Session。
export async function loadVideoSession(session) {
  return requestJSON(
    `/api/videos/sessions/${encodeURIComponent(session.id)}?date=${session.date}`,
  );
}

// 保存视频 Session 的完整编辑状态。
export async function saveVideoSession(session) {
  return requestJSON(
    `/api/videos/sessions/${encodeURIComponent(session.id)}?date=${session.date}`,
    {
      method: "PUT",
      body: JSON.stringify(session),
    },
  );
}

// 请求系统打开视频 Session 所在目录。
export async function openVideoSessionDirectory(session) {
  return requestJSON(
    `/api/videos/sessions/${encodeURIComponent(session.id)}/open?date=` +
      `${encodeURIComponent(session.date)}`,
    { method: "POST" },
  );
}

// 删除视频制作 Session。
export async function deleteVideoSession(session) {
  return requestJSON(
    `/api/videos/sessions/${encodeURIComponent(session.id)}?date=${session.date}`,
    {
      method: "DELETE",
    },
  );
}

// 读取图片库中 Agnes 官方生成的图片。
export async function listGeneratedReferences(date = help_today()) {
  const result = await requestJSON(
    `/api/images/references?date=${encodeURIComponent(date)}`,
  );
  return result.filter(
    (item) => item.generated && /^https?:\/\//.test(item.url || ""),
  );
}

// 读取视频模块需要的 API 连接配置。
export async function loadVideoContext() {
  const [settings, status] = await Promise.all([
    requestJSON("/api/settings"),
    requestJSON("/api/images/status"),
  ]);
  return { settings, publicURL: status.publicURL };
}

// 保存 Agnes 返回的视频到 Session 媒体目录。
export async function saveVideoFile(session, path, data) {
  const body = data instanceof Blob ? await data.arrayBuffer() : data;
  return requestJSON(
    `/api/videos/sessions/${encodeURIComponent(session.id)}/files?date=${session.date}` +
      `&path=${encodeURIComponent(path)}`,
    { method: "POST", rawBody: body },
  );
}

// 让 Go 服务下载 Agnes 视频并保存到当前 Session，避免浏览器跨域下载失败。
export async function saveRemoteVideoFile(session, path, remoteURL) {
  return requestJSON(
    `/api/videos/sessions/${encodeURIComponent(session.id)}/files/remote?date=${session.date}` +
      `&path=${encodeURIComponent(path)}`,
    {
      method: "POST",
      body: JSON.stringify({ url: remoteURL }),
    },
  );
}

// 通过 Go HTTP 接口向当前视频 Session 追加一条诊断日志。
export async function appendVideoLog(session, event, payload = {}) {
  if (!session?.id || !session?.date) return;
  const record = {
    timestamp: new Date().toISOString(),
    sessionID: session.id,
    event,
    payload,
  };
  try {
    return await requestJSON(
      `/api/videos/sessions/${encodeURIComponent(session.id)}/logs?date=` +
        `${encodeURIComponent(session.date)}&path=logs/video.jsonl`,
      { method: "POST", body: JSON.stringify(record) },
    );
  } catch (error) {
    console.error("[hvv video] 写入 Session 日志失败", error);
  }
}

// 调用 Agnes 图片模型，按视频比例把上一段尾帧转换成公网图片 URL。
export async function publishFrame(dataURL, ratio, context, signal) {
  const response = await fetch(
    `${context.settings.baseURL}/images/generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${context.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: "agnes-image-2.1-flash",
        prompt:
          "Keep the image exactly as it is. Do not crop, stretch, reframe, " +
          "or change the subject, background, clothing, or composition.",
        size: "1K",
        ratio,
        extra_body: { response_format: "url", image: [dataURL] },
      }),
      signal,
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(help_describeError(result, "尾帧公网化失败"));
  const url = result.data?.[0]?.url;
  if (!url) throw new Error("图片模型没有返回公网地址");
  return url;
}

// 创建一个 Agnes 视频任务，只有存在首帧时才填写视频生成模式。
export async function createAgnesVideo(payload, context, signal, onRetry) {
  const hasFirstFrame = Boolean(payload.firstFrame);
  const hasLastFrame = hasFirstFrame && Boolean(payload.lastFrame);
  const body = {
    model: "agnes-video-v2.0",
    prompt: payload.prompt,
    negative_prompt: payload.negativePrompt,
    ...help_videoSize(payload.ratio),
    frame_rate: 24,
    ...(payload.numFrames ? { num_frames: payload.numFrames } : {}),
  };
  if (hasFirstFrame) {
    const mode = hasLastFrame ? "keyframes" : "ti2vid";
    body.mode = mode;
    body.extra_body = {
      mode,
      image: hasLastFrame
        ? [payload.firstFrame, payload.lastFrame]
        : [payload.firstFrame],
    };
  }
  for (let retryCount = 0; ; retryCount += 1) {
    const response = await fetch(`${context.settings.baseURL}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${context.settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    const result = await response.json();
    if (response.ok) return result;

    // 仅重试服务端明确表示推理槽位繁忙的创建请求。
    const busy = help_isVideoServiceBusy(result, response.status);
    const canRetry = busy && retryCount < 3;
    if (!canRetry) {
      const message = busy
        ? "视频服务当前繁忙，已重试 3 次，请稍后再试"
        : help_describeError(result, "视频任务创建失败");
      throw new Error(message);
    }
    const nextRetry = retryCount + 1;
    const delay = help_videoRetryDelay(nextRetry);
    // 等待服务槽位释放并持续更新倒计时，期间支持用户取消本次生成。
    await help_waitCountdown(delay, signal, (remaining) => {
      onRetry?.(nextRetry, remaining);
    });
  }
}

// 轮询视频任务进度并返回最终生成结果。
export async function waitForAgnesVideo(
  task,
  context,
  signal,
  onProgress,
  onLog,
) {
  const videoID = task.video_id || task.id || task.task_id;
  if (!videoID) throw new Error("视频任务没有返回 video_id");
  const rootURL = context.settings.baseURL.replace(/\/v1\/?$/, "");
  let retryCount = 0;
  for (;;) {
    const queryStartedAt = Date.now();
    await help_emitLog(onLog, "video.status.request", {
      videoID,
      retryCount,
    });
    let response;
    let result;
    try {
      response = await fetch(
        `${rootURL}/agnesapi?video_id=${encodeURIComponent(videoID)}`,
        {
          headers: { Authorization: `Bearer ${context.settings.apiKey}` },
          signal,
        },
      );
      const rawBody = await response.text();
      try {
        result = JSON.parse(rawBody);
      } catch (_) {
        result = { error: rawBody || response.statusText };
      }
    } catch (error) {
      console.error("[hvv video] status query network error", {
        videoID,
        elapsedMs: Date.now() - queryStartedAt,
        error,
      });
      await help_emitLog(onLog, "video.status.network_error", {
        videoID,
        elapsedMs: Date.now() - queryStartedAt,
        error: help_describeError(error, "状态查询网络错误"),
        stack: error?.stack || "",
      });
      throw error;
    }
    console.log("[hvv video] status query response", {
      videoID,
      httpStatus: response.status,
      elapsedMs: Date.now() - queryStartedAt,
      result,
    });
    await help_emitLog(onLog, "video.status.response", {
      videoID,
      httpStatus: response.status,
      elapsedMs: Date.now() - queryStartedAt,
      result,
    });
    const errorMessage = help_describeError(result, "查询视频任务失败");
    const rateLimited =
      response.status === 429 || /rate limit|限流/i.test(errorMessage);
    if (!response.ok && !rateLimited) throw new Error(errorMessage);
    if (rateLimited) {
      retryCount += 1;
      const delay = Math.min(120000, 60000 * Math.max(1, retryCount));
      await help_emitLog(onLog, "video.status.rate_limited", {
        videoID,
        retryCount,
        delayMs: delay,
        error: errorMessage,
      });
      onProgress?.(0, `状态查询限流，${Math.ceil(delay / 1000)} 秒后重试`);
      await help_wait(delay, signal);
      continue;
    }
    retryCount = 0;
    onProgress?.(Number(result.progress || 0), result.status);
    if (result.status === "completed") return result;
    if (result.status === "failed")
      throw new Error(help_describeError(result, "视频生成失败"));
    await help_wait(5000, signal);
  }
}

// 安全调用视频日志回调，避免日志接口异常影响视频任务本身。
async function help_emitLog(onLog, event, payload) {
  try {
    await onLog?.(event, payload);
  } catch (error) {
    console.error("[hvv video] 日志回调失败", { event, error });
  }
}

// 发送 JSON 请求并统一处理后端错误。
async function requestJSON(url, options = {}) {
  const headers = options.rawBody
    ? { "Content-Type": "application/octet-stream" }
    : {
        "Content-Type": "application/json",
      };
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    body: options.rawBody || options.body,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "视频请求失败");
  return result;
}

// 返回视频 Session 文件在本地 HTTP 服务中的地址。
export function sessionMediaURL(path) {
  return help_mediaURL(path);
}
