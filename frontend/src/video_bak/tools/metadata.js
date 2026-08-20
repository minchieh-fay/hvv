import { tool } from "@openai/agents";
import { z } from "zod";
import { help_toolError } from "./help";

// 创建视频元数据读取工具。
export function createGetMetadataTool() {
  return tool({
    name: "video_get_metadata",
    description: "读取视频的真实时长、宽高、帧率和轨道信息，" + "生成尾帧或规划时间前必须调用。",
    parameters: z.object({ videoURL: z.string().min(1) }).strict(),
    execute: async ({ videoURL }) => {
      try {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = videoURL;
        await new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("读取视频元数据超时")), 20000);
          video.onloadedmetadata = () => {
            window.clearTimeout(timer);
            resolve();
          };
          video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error("视频元数据读取失败"));
          };
        });
        return JSON.stringify({
          success: true,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          frameRate: 24,
          hasVideo: video.videoWidth > 0,
          hasAudio: Boolean(video.audioTracks?.length),
        });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "metadata_error"));
      }
    },
  });
}
