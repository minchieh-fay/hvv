import { tool } from "@openai/agents";
import { z } from "zod";
import { concatMp4Segments } from "../infra/concat";
import { help_toolError } from "./help";

// 创建 MP4 片段合成工具。
export function createConcatSegmentsTool(onConcat = null) {
  return tool({
    name: "video_concat_segments",
    description: "在浏览器中使用 mp4box 合成已完成的视频片段，不调用 ffmpeg。",
    parameters: z.object({ urls: z.array(z.string()).min(1) }).strict(),
    execute: async (input) => {
      try {
        const blob = await concatMp4Segments(input.urls);
        const result = onConcat ? await onConcat(blob) : { size: blob.size };
        return JSON.stringify({ success: true, ...result });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "concat_error"));
      }
    },
  });
}
