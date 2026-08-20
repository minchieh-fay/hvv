// 从视频地址提取指定时间点的 PNG 图片。
export async function extractVideoFrame(videoURL, targetTime = 0) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = videoURL;
  await waitForVideoEvent(video, "loadedmetadata");
  const safeTime = Math.max(0, Math.min(targetTime, Math.max(0, video.duration - 0.001)));
  video.currentTime = safeTime;
  await waitForVideoEvent(video, "seeked");
  if (video.requestVideoFrameCallback) await new Promise((resolve) => video.requestVideoFrameCallback(() => resolve()));
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (!canvas.width || !canvas.height) throw new Error("视频没有有效画面尺寸");
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("视频帧导出失败"))), "image/png"),
  );
  video.removeAttribute("src");
  video.load();
  return blob;
}

// 等待视频事件或超时，避免媒体加载一直阻塞 Agent。
function waitForVideoEvent(video, eventName) {
  return new Promise((resolve, reject) => {
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
