import { Agent, OpenAIProvider, Runner, setOpenAIAPI, tool } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { help_toolError } from "../tools/help";

// 校验并生成视频片段的工具。
function createGenerateSegmentTool(generateSegment) {
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

// 按片段实际时长更新渐进式预览时间轴。
function createBuildPreviewTool(onPreview) {
  return tool({
    name: "video_build_preview",
    description: "按片段实际时长更新渐进式预览时间轴；每个片段完成后立即调用。",
    parameters: z
      .object({
        segments: z.array(
          z
            .object({
              id: z.string(),
              status: z.string(),
              url: z.string(),
              actualDuration: z.number(),
              targetDuration: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
    execute: async ({ segments }) => {
      const { buildPreviewTimeline } = await import("../infra/preview");
      const timeline = buildPreviewTimeline(segments);
      onPreview(timeline);
      return JSON.stringify({
        success: true,
        totalDuration: timeline.at(-1)?.previewEnd || 0,
        segmentCount: timeline.length,
      });
    },
  });
}

// 创建视频片段生成 Agent，负责逐段调用视频模型。
export function createVideoClipAgent(context, callbacks) {
  setOpenAIAPI("chat_completions");
  const openAIClient = new OpenAI({
    apiKey: context.settings.apiKey,
    baseURL: context.settings.baseURL,
    dangerouslyAllowBrowser: true,
  });
  const provider = new OpenAIProvider({ openAIClient, useResponses: false });

  const agent = new Agent({
    name: "hvv 视频片段 Agent",
    model: context.settings.model,
    modelSettings: { toolChoice: "required" },
    toolUseBehavior: { stopAtToolNames: ["video_build_preview"] },
    instructions:
      "你是视频片段生成 Agent，负责根据分段计划和帧路径逐段生成视频。" +
      "每个片段必须依次完成：生成视频片段 → 抽取真实尾帧 → 更新预览时间轴。" +
      "调用 video_generate_segment 时，firstFrame 使用首帧路径，" +
      "lastFrame 使用尾帧路径，prompt 描述本段动作，numFrames 使用分段计划中的值。" +
      "固定 24 fps，numFrames 必须 <=441 且满足 8n+1。" +
      "生成视频后调用 video_extract_frame 抽取真实尾帧，" +
      "time 使用片段的实际时长（numFrames / 24）。" +
      "每完成一个片段立即调用 video_build_preview 更新进度。" +
      "progressText 会实时反映当前片段生成进度，请勿忽略。" +
      "工具失败时先分析 error.type，临时错误可重试一次，" +
      "参数错误必须报告并暂停，不要假装成功。" +
      "所有片段完成后不要自行结束，等待编排器下一步指令。" +
      `当前 Session 比例：${callbacks.ratio}。`,
    tools: [
      createGenerateSegmentTool(callbacks.generateSegment),
      createBuildPreviewTool(callbacks.updatePreview),
    ],
  });

  return {
    agent,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: false,
      workflowName: "hvv 视频片段",
    }),
  };
}
