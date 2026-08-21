// 将错误对象转换成视频模块可以直接展示的文本。
export function help_describeError(error: unknown, fallback = "视频请求失败") {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    if (typeof value.message === "string" && value.message.trim())
      return value.message;
    if (typeof value.error === "string" && value.error.trim())
      return value.error;
    if (value.error && typeof value.error === "object") {
      const nested = value.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
  }
  return fallback;
}

// 判断 Agnes 视频创建接口是否返回了可以安全重试的服务繁忙错误。
export function help_isVideoServiceBusy(error: unknown, status?: number) {
  const message = help_describeError(error, "");
  return (
    status === 503 ||
    /service busy|inference slot is in use|服务繁忙/i.test(message)
  );
}

// 根据重试次数计算服务繁忙时的等待时间，避免连续请求继续占用服务槽位。
export function help_videoRetryDelay(retryCount: number) {
  return Math.min(60000, 15000 * 2 ** Math.max(0, retryCount - 1));
}

// 将视频片段的秒数转换成 Agnes 要求的帧数。
export function help_durationToFrames(seconds: number) {
  if (!seconds) return undefined;
  return seconds * 24 + 1;
}

// 返回视频比例对应的统一 1K 画布尺寸，与图片模块保持一致。
export function help_videoSize(ratio: string) {
  const sizes: Record<string, { width: number; height: number }> = {
    "16:9": { width: 1024, height: 576 },
    "9:16": { width: 576, height: 1024 },
    "3:4": { width: 768, height: 1024 },
    "4:3": { width: 1024, height: 768 },
  };
  return sizes[ratio] || sizes["3:4"];
}

// 把本地 Session 文件路径转换为浏览器可访问的地址。
export function help_mediaURL(path: string) {
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// 返回当前媒体目录使用的日期格式。
export function help_today() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

// 将 Session 创建时间格式化为列表中易于识别的本地时间。
export function help_formatSessionCreatedAt(value: unknown) {
  if (typeof value !== "string" || !value) return "创建时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "创建时间未知";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 等待视频事件并在媒体异常或超时时结束等待。
export function help_waitVideoEvent(
  video: HTMLVideoElement,
  eventName: string,
) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`等待视频${eventName}超时`));
    }, 20000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("视频媒体加载失败"));
    };
    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

// 等待指定时间并每秒通知剩余毫秒数，供视频服务繁忙提示显示倒计时。
export function help_waitCountdown(
  milliseconds: number,
  signal: AbortSignal | undefined,
  onTick: (remaining: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    let timer: number | undefined;
    const cleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
    };
    const tick = () => {
      const remaining = Math.max(0, milliseconds - (Date.now() - startedAt));
      onTick(remaining);
      if (!remaining) {
        cleanup();
        resolve();
        return;
      }
      timer = window.setTimeout(tick, Math.min(1000, remaining));
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException("已取消", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    tick();
  });
}

// 从视频指定时间点生成 PNG Blob，供预览和参考图使用。
export async function help_extractFrame(videoURL: string, targetTime?: number) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = videoURL;
  await help_waitVideoEvent(video, "loadedmetadata");
  const time =
    targetTime === undefined
      ? Math.max(0, video.duration - 0.001)
      : Math.max(0, Math.min(targetTime, Math.max(0, video.duration - 0.001)));
  video.currentTime = time;
  await help_waitVideoEvent(video, "seeked");
  if (video.requestVideoFrameCallback) {
    await new Promise<void>((resolve) =>
      video.requestVideoFrameCallback(() => resolve()),
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (!canvas.width || !canvas.height) throw new Error("视频没有有效画面尺寸");
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("视频帧导出失败"))),
      "image/png",
    );
  });
  video.removeAttribute("src");
  video.load();
  return blob;
}

// 从视频最后一帧生成 PNG Blob，供下一段的参考图使用。
export async function help_extractLastFrame(videoURL: string) {
  return help_extractFrame(videoURL);
}

// 将二进制图片转换为 Agnes 图片接口可以接受的 Data URL。
export function help_blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取尾帧图片失败"));
    reader.readAsDataURL(blob);
  });
}

// 按可取消的方式等待一段时间，避免轮询任务时阻塞页面。
export function help_wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
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
