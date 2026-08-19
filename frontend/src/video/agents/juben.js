import { Agent, OpenAIProvider, Runner, setOpenAIAPI, tool } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";

const SCRIPT_DESCRIPTION = [
  "保存给人类阅读和审核的结构化视频剧本。每个场景填写本章节预计持续秒数，",
  "不要填写绝对开始时间和结束时间。",
].join("");

const VISUAL_DIRECTION_SCHEMA = z
  .object({
    summary: z.string(),
    visualIdentity: z.string(),
    mustKeep: z.array(z.string()).length(3),
    mustAvoid: z.array(z.string()).length(3),
  })
  .strict();

// 找出多个章节中重复出现的完整长台词，避免重复开场白污染剧本。
function findRepeatedDialogue(scenes) {
  const seen = new Map();
  for (const scene of scenes) {
    const normalized = String(scene.dialogue || "")
      .replace(/[\s，。！？、,.!?；：;:]/g, "")
      .trim();
    if (normalized.length < 20) continue;
    if (seen.has(normalized)) {
      return `章节 ${seen.get(normalized)} 和 ${scene.id} 重复了长台词`;
    }
    seen.set(normalized, scene.id);
  }
  return "";
}

// 创建用于生成结构化视频剧本的剧本 Agent。
export function createVideoScriptAgent(context, capturedScript) {
  const scriptTool = tool({
    name: "save_video_script",
    description: SCRIPT_DESCRIPTION,
    parameters: z
      .object({
        estimatedDuration: z.number().nonnegative(),
        visualDirection: VISUAL_DIRECTION_SCHEMA,
        scenes: z.array(
          z
            .object({
              id: z.string(),
              duration: z.number().positive(),
              action: z.string(),
              dialogue: z.string(),
              characters: z.array(z.string()),
              objects: z.array(z.string()),
              location: z.string(),
              camera: z.string(),
              visual_style: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    execute: async (input) => {
      const repeatedDialogue = findRepeatedDialogue(input.scenes);
      if (repeatedDialogue) {
        return JSON.stringify({
          success: false,
          error: repeatedDialogue + "，请只在首次介绍时保留开场白。",
        });
      }
      capturedScript.value = input;
      return JSON.stringify({ success: true, scenes: input.scenes.length });
    },
  });
  setOpenAIAPI("chat_completions");
  const openAIClient = new OpenAI({
    apiKey: context.settings.apiKey,
    baseURL: context.settings.baseURL,
    dangerouslyAllowBrowser: true,
  });
  const provider = new OpenAIProvider({ openAIClient, useResponses: false });
  const agent = new Agent({
    name: "hvv 视频剧本 Agent",
    model: context.settings.model,
    instructions:
      "你是视频剧本规划 Agent。必须调用 save_video_script，不要只回复文字。" +
      "每个场景只输出 duration（本章节预计持续秒数），禁止输出 start 或 end 绝对时间。" +
      "必须先根据用户用途提炼 visualDirection 全局画面调性，" +
      "只输出四个关键结论，不要堆砌参数。" +
      "summary 写一句总纲，visualIdentity 写人物、产品、真实度和画面风格。" +
      "mustKeep 必须写当前视频最重要的 3 条视觉效果约束，并按优先级排列。" +
      "mustAvoid 必须写当前视频最重要的 3 条禁止视觉效果，并按优先级排列。" +
      "不要给所有视频套用固定总时长或固定风格。" +
      "总时长要根据正常口播时间、停顿、动作复杂度、镜头节奏" +
      "和用户时长范围共同估算。" +
      "短台词不能被扩写成无意义的长镜头，长台词也不能被强行压缩。" +
      "产品营销、动画、魔幻、科幻等用途都要根据用户内容选择合适的视觉方向。" +
      "mustAvoid 只能填写与当前用途冲突的具体内容，不能默认禁止卡通、魔幻或特效。" +
      "场景数量必须根据语义、台词和动作自然决定，" +
      "不要固定生成 3 段，也不要为了凑数拆分。" +
      "这里的场景是给人类看的完整章节，例如开场白、产品简介和产品优点，" +
      "同一段开场白、说话人身份和产品引入只出现一次，后续章节直接承接内容，" +
      "除非用户明确要求，否则不得重复相同或高度相似的长台词。" +
      "中文台词按正常清晰语速约 6 字每秒估算；慢速约 4.5 字每秒，快速约 7.5 字每秒，" +
      "根据内容语气选择合适速度，并计入自然停顿。" +
      "空字段返回空字符串，characters 和 objects 返回空数组。" +
      "estimatedDuration 必须等于所有场景 duration 之和。",
    tools: [scriptTool],
  });
  return {
    agent,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: false,
      workflowName: "hvv 视频剧本",
    }),
  };
}
