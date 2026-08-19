import { tool } from "@openai/agents";
import { z } from "zod";
import { extractVideoFrame } from "../infra/frame";
import { help_toolError } from "./help";

// 创建视频画面视觉检查工具。
export function createCheckFrameTool(callVision) {
  return tool({
    name: "video_check_frame",
    description: [
      "把视频指定时间点的画面交给视觉模型检查。",
      "生成后发现禁用内容、人物漂移或衔接异常时必须调用。",
    ].join(""),
    parameters: z
      .object({
        videoURL: z.string().min(1),
        time: z.number().nonnegative(),
        requirement: z.string().min(1),
      })
      .strict(),
    execute: async (input) => {
      try {
        const blob = await extractVideoFrame(input.videoURL, input.time);
        const dataURL = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const result = await callVision(dataURL, input.requirement);
        return JSON.stringify({ success: true, ...result });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "vision_check_error"));
      }
    },
  });
}
