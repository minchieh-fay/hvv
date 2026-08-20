import { Agent, OpenAIProvider, Runner, setOpenAIAPI } from "@openai/agents";
import OpenAI from "openai";
import {
  createBuildPreviewTool,
  createCheckFrameTool,
  createConcatSegmentsTool,
  createExtractFrameTool,
  createGenerateKeyframeTool,
  createGenerateSegmentTool,
  createGetMetadataTool,
  createPlanSegmentsTool,
  createSaveSessionTool,
} from "../tools/index";

// 创建负责自主规划和执行视频片段的生产 Agent。
export function createVideoProductionAgent(context, callbacks) {
  setOpenAIAPI("chat_completions");
  const openAIClient = new OpenAI({
    apiKey: context.settings.apiKey,
    baseURL: context.settings.baseURL,
    dangerouslyAllowBrowser: true,
  });
  const provider = new OpenAIProvider({ openAIClient, useResponses: false });
  const agent = new Agent({
    name: "hvv 视频生产 Agent",
    model: context.settings.model,
    modelSettings: { toolChoice: "required" },
    toolUseBehavior: { stopAtToolNames: ["video_concat_segments"] },
    instructions:
      "你是视频生产总导演，负责把结构化剧本变成可审核的视频片段。" +
      "必须把剧本中的 visualDirection 当作全片视觉圣经，" +
      "所有首帧、尾帧和视频提示词都要遵守 summary、visualIdentity、" +
      "mustKeep 的 3 条优先规则和 mustAvoid 的 3 条禁止规则。" +
      "必须根据 visualDirection 和当前用途执行风格，" +
      "不能套用通用的真实、卡通或魔幻模板。" +
      "只有当 mustAvoid 明确指出某类内容与本片冲突时，才禁止该类内容。" +
      "第一步必须调用 video_plan_segments，不能自己估算帧数。" +
      "计划中的 numFrames / 24 是该片段实际秒数，必须原样使用；每段不能超过 5 秒。" +
      "剧本场景是人类可读的完整章节，不等于模型片段；" +
      "必须以 video_plan_segments 返回的台词分段为准。" +
      "每个片段都只能使用该片段对应的台词，不能重复整个章节或重复开场白。" +
      "固定 24 fps，numFrames 必须 <=441 且满足 8n+1。" +
      "第一段首帧由图片模型生成，后续首帧使用上一段视频的真实尾帧。" +
      "尾帧不是重新设计一张独立画面，而是当前片段首帧经过本段动作后的目标状态。" +
      "生成尾帧时，必须把当前片段首帧作为图片模型的底图，" +
      "调用尾帧工具时，references 数组第一个元素必须是当前片段首帧路径。" +
      "只在提示词中描述本段结束时应发生的变化，例如人物全部躺倒在地。" +
      "尾帧必须延续首帧的人物身份、数量、服装、环境、构图和光线，" +
      "视频模型负责补足首帧到尾帧之间的连续运动。" +
      "每段尾帧生成后必须抽取真实尾帧并调用 video_check_frame。" +
      "每个片段必须依次完成：生成首帧、生成尾帧、生成视频、" +
      "抽取真实尾帧、画面验收、保存状态。" +
      "所有片段完成并调用 video_concat_segments 之前，禁止只回复文字或结束任务；" +
      "工具成功返回后必须继续调用下一个所需工具。" +
      "工具失败时先分析 error.type，不要假装成功；临时错误可重试，参数错误必须暂停。" +
      `所有片段验收后调用 video_concat_segments。当前 Session 比例：${callbacks.ratio}。`,
    tools: [
      createPlanSegmentsTool(callbacks.planSegments),
      createGenerateKeyframeTool(callbacks.generateKeyframe),
      createGenerateSegmentTool(callbacks.generateSegment),
      createExtractFrameTool(callbacks.extractFrame),
      createGetMetadataTool(),
      createCheckFrameTool(callbacks.checkFrame),
      createBuildPreviewTool(callbacks.updatePreview),
      createSaveSessionTool(callbacks.saveSession),
      createConcatSegmentsTool(callbacks.concat),
    ],
  });
  return {
    agent,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: false,
      workflowName: "hvv 视频生产",
    }),
  };
}
