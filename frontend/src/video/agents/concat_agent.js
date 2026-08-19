import { Agent, OpenAIProvider, Runner, setOpenAIAPI, tool } from "@openai/agents";
import { z } from "zod";
import { help_toolError } from "../tools/help";

// 创建 MP4 片段合成工具。
function createConcatSegmentsTool(onConcat) {
  return tool({
    name: "video_concat_segments",
    description: "在浏览器中使用 mp4box 合成已完成的视频片段，不调用 ffmpeg。",
    parameters: z.object({ urls: z.array(z.string()).min(1) }).strict(),
    execute: async (input) => {
      try {
        const { concatMp4Segments } = await import("../infra/concat");
        const blob = await concatMp4Segments(input.urls);
        const result = onConcat ? await onConcat(blob) : { size: blob.size };
        return JSON.stringify({ success: true, ...result });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "concat_error"));
      }
    },
  });
}

// 保存当前 Session 状态、片段状态、任务 ID 和错误信息。
function createSaveSessionTool(saveSession) {
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

// 创建负责最终合成的合成 Agent。
export function createVideoConcatAgent(context, callbacks) {
  setOpenAIAPI("chat_completions");
  const openAIClient = new OpenAI({
    apiKey: context.settings.apiKey,
    baseURL: context.settings.baseURL,
    dangerouslyAllowBrowser: true,
  });
  const provider = new OpenAIProvider({ openAIClient, useResponses: false });

  const agent = new Agent({
    name: "hvv 视频合成 Agent",
    model: context.settings.model,
    modelSettings: { toolChoice: "required" },
    toolUseBehavior: { stopAtToolNames: ["video_concat_segments"] },
    instructions:
      "你是视频合成 Agent。所有视频片段生成并验收完成后，" +
      "按片段 ID 顺序收集所有有效片段的 url，调用 video_concat_segments 合成最终 MP4。" +
      "合成完成后调用 video_save_session 保存最终状态。" +
      "如果片段不足 1 个，不要调用合成工具，直接保存错误状态并告知编排器。",
    tools: [createConcatSegmentsTool(callbacks.concat), createSaveSessionTool(callbacks.saveSession)],
  });

  return {
    agent,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: false,
      workflowName: "hvv 视频合成",
    }),
  };
}
