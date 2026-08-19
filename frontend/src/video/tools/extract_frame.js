import { tool } from "@openai/agents";
import { z } from "zod";
import { extractVideoFrame } from "../infra/frame";
import { help_toolError } from "./help";

// 创建视频抽帧工具。
export function createExtractFrameTool(onExtract = null) {
  return tool({
    name: "video_extract_frame",
    description: "从视频指定时间点提取 PNG 帧，不使用 ffmpeg。",
    parameters: z
      .object({
        videoURL: z.string(),
        time: z.number().nonnegative(),
        outputPath: z.string(),
      })
      .strict(),
    execute: async (input) => {
      try {
        const blob = await extractVideoFrame(input.videoURL, input.time);
        const saved = onExtract && input.outputPath ? await onExtract(blob, input.outputPath) : {};
        return JSON.stringify({ success: true, size: blob.size, ...saved });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "frame_extract_error"));
      }
    },
  });
}
