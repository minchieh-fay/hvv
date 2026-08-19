import { tool } from "@openai/agents";
import { z } from "zod";
import { help_toolError } from "./help";

// 创建视频 Session 保存工具。
export function createSaveSessionTool(saveSession) {
  return tool({
    name: "video_save_session",
    description: "保存当前 Session 状态、片段状态、任务 ID 和错误信息，" + "任何状态变化后调用。",
    parameters: z
      .object({
        status: z.string(),
        segments: z.array(
          z
            .object({
              id: z.string(),
              status: z.string(),
              url: z.string(),
              video: z.string(),
              firstFrame: z.string(),
              lastFrame: z.string(),
              actualDuration: z.number(),
              targetDuration: z.number(),
              numFrames: z.number(),
              frameRate: z.number(),
              taskID: z.string(),
              prompt: z.string(),
            })
            .strict(),
        ),
        message: z.string(),
      })
      .strict(),
    execute: async (input) => {
      try {
        await saveSession(input);
        return JSON.stringify({ success: true, status: input.status });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "session_save_error"));
      }
    },
  });
}
