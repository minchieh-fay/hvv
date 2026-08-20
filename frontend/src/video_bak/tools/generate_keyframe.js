import { tool } from "@openai/agents";
import { z } from "zod";
import { help_toolError } from "./help";

// 创建关键帧图片生成工具，首帧建立状态，尾帧基于首帧生成结束状态。
export function createGenerateKeyframeTool(generateKeyframe) {
  return tool({
    name: "video_generate_keyframe",
    description: [
      "生成视频关键帧。首帧用于建立当前段的初始状态；",
      "尾帧必须以当前段首帧为底图，只描述动作结束时的状态变化，" +
        "不能重新设计独立画面。",
      "尾帧要保持首帧的人物、环境、构图和光线连续。",
    ].join(""),
    parameters: z
      .object({
        kind: z.enum(["first", "last"]),
        prompt: z.string().min(1),
        references: z.array(z.string()),
        outputPath: z.string().min(1),
      })
      .strict(),
    execute: async (input) => {
      try {
        return JSON.stringify({
          success: true,
          path: await generateKeyframe(input),
        });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "keyframe_generation_error"));
      }
    },
  });
}
