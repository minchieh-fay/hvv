import { tool } from "@openai/agents";
import { z } from "zod";
import { help_toolError } from "./help";

// 创建视频片段生成工具，并校验 Agnes 帧数约束。
export function createGenerateSegmentTool(generateSegment) {
  return tool({
    name: "video_generate_segment",
    description: ["使用两个关键帧生成一个视频片段。", "必须使用 24 fps、keyframes 模式和合法的 8n+1 帧数。"].join(""),
    parameters: z
      .object({
        segmentID: z.string(),
        firstFrame: z.string().min(1),
        lastFrame: z.string().min(1),
        prompt: z.string().min(1),
        numFrames: z.number().int().min(49).max(121),
      })
      .strict(),
    execute: async (input) => {
      try {
        if (input.numFrames % 8 !== 1) {
          return JSON.stringify(help_toolError(new Error("numFrames 必须满足 8n+1"), "invalid_frame_count"));
        }
        return JSON.stringify({ success: true, ...(await generateSegment(input)) });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "segment_generation_error"));
      }
    },
  });
}
