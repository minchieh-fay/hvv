import { Agent, OpenAIProvider, Runner, setOpenAIAPI, tool } from "@openai/agents";
import { z } from "zod";
import { help_buildSegmentPlan } from "../infra/help";

// 创建视频分段规划 Agent，负责把结构化剧本拆成模型可执行的片段。
export function createVideoSegmentAgent(context) {
  setOpenAIAPI("chat_completions");
  const openAIClient = new OpenAI({
    apiKey: context.settings.apiKey,
    baseURL: context.settings.baseURL,
    dangerouslyAllowBrowser: true,
  });
  const provider = new OpenAIProvider({ openAIClient, useResponses: false });

  // 分段规划工具：根据剧本生成符合帧数约束的执行片段列表。
  const planTool = tool({
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

  const agent = new Agent({
    name: "hvv 视频分段 Agent",
    model: context.settings.model,
    modelSettings: { toolChoice: "required" },
    toolUseBehavior: { stopAtToolNames: ["video_plan_segments"] },
    instructions:
      "你是视频分段规划 Agent。必须调用 video_plan_segments 输出完整分段计划，" +
      "不能只回复文字。" +
      "把剧本中的每个章节按台词口播自然切分成不超过 5 秒的片段。" +
      "每个片段保留其来源章节的 action、characters 和 objects 信息。" +
      "禁止重复整章台词到每个片段中，每个片段只使用属于自己的台词段落。" +
      "如果某章节没有台词，按动作描述长度估算合理时长，不少于 2 秒。" +
      "片段 ID 格式使用 segment-001、segment-002 等顺序编号。" +
      "工具返回的 numFrames / 24 是该片段的实际秒数，必须原样使用。",
    tools: [planTool],
  });

  return {
    agent,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: false,
      workflowName: "hvv 视频分段",
    }),
  };
}
