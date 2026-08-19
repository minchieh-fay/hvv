import { tool } from "@openai/agents";
import { z } from "zod";
import { help_buildSegmentPlan } from "../infra/help";

// 创建视频生产阶段的分段规划工具，将人类剧本章节转换为模型可执行片段。
export function createPlanSegmentsTool() {
  return tool({
    name: "video_plan_segments",
    description:
      "根据给人类阅读的结构化剧本生成视频生产分段计划。必须首先调用。" +
      "按台词实际口播速度、标点停顿和动作需要切分章节；每个模型片段不超过 5 秒，" +
      "不得把整章台词复制到每个片段。工具会返回合法 numFrames 和实际秒数。",
    parameters: z
      .object({
        scenes: z
          .array(
            z
              .object({
                id: z.string(),
                duration: z.number().positive(),
                action: z.string(),
                dialogue: z.string(),
                characters: z.array(z.string()),
                objects: z.array(z.string()),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    execute: async ({ scenes }) =>
      JSON.stringify({
        success: true,
        frameRate: 24,
        maxSeconds: 5,
        segments: help_buildSegmentPlan(scenes),
      }),
  });
}
