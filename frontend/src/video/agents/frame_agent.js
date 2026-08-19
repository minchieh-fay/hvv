import { Agent, OpenAIProvider, Runner, setOpenAIAPI, tool } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { extractVideoFrame } from "../infra/frame";
import { help_toolError } from "../tools/help";

// 生成首帧或尾帧图片的工具。
function createGenerateKeyframeTool(generateKeyframe) {
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

// 从视频指定时间点提取 PNG 帧。
function createExtractFrameTool(onExtract) {
  return tool({
    name: "video_extract_frame",
    description: "从视频指定时间点提取 PNG 帧，不使用 ffmpeg。",
    parameters: z
      .object({
        videoURL: z.string(),
        time: z.number().nonnegative(),
        outputPath: z.string(),
      })
      .strict(),
    execute: async (input) => {
      try {
        const blob = await extractVideoFrame(input.videoURL, input.time);
        const saved = onExtract && input.outputPath ? await onExtract(blob, input.outputPath) : {};
        return JSON.stringify({ success: true, size: blob.size, ...saved });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "frame_extract_error"));
      }
    },
  });
}

// 把视频指定时间点的画面交给视觉模型检查。
function createCheckFrameTool(callVision) {
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

// 读取视频的真实时长、宽高、帧率等元数据。
function createGetMetadataTool() {
  return tool({
    name: "video_get_metadata",
    description: "读取视频的真实时长、宽高、帧率和轨道信息，" + "生成尾帧或规划时间前必须调用。",
    parameters: z.object({ videoURL: z.string().min(1) }).strict(),
    execute: async ({ videoURL }) => {
      try {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.src = videoURL;
        await new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("读取视频元数据超时")), 20000);
          video.onloadedmetadata = () => {
            window.clearTimeout(timer);
            resolve();
          };
          video.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error("视频元数据读取失败"));
          };
        });
        return JSON.stringify({
          success: true,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          frameRate: 24,
          hasVideo: video.videoWidth > 0,
          hasAudio: Boolean(video.audioTracks?.length),
        });
      } catch (error) {
        return JSON.stringify(help_toolError(error, "metadata_error"));
      }
    },
  });
}

// 创建负责首帧/尾帧生成和视觉检查的帧 Agent。
export function createVideoFrameAgent(context, callbacks) {
  setOpenAIAPI("chat_completions");
  const openAIClient = new OpenAI({
    apiKey: context.settings.apiKey,
    baseURL: context.settings.baseURL,
    dangerouslyAllowBrowser: true,
  });
  const provider = new OpenAIProvider({ openAIClient, useResponses: false });

  const agent = new Agent({
    name: "hvv 帧 Agent",
    model: context.settings.model,
    modelSettings: { toolChoice: "required" },
    instructions:
      "你是视频帧生成 Agent，负责为每个片段生成首帧和尾帧，" +
      "并在视频生成后抽取真实尾帧进行视觉检查。" +
      "必须把剧本中的 visualDirection 当作全片视觉圣经，" +
      "所有首帧、尾帧都要遵守 summary、visualIdentity、" +
      "mustKeep 的 3 条优先规则和 mustAvoid 的 3 条禁止规则。" +
      "第一段首帧调用 video_generate_keyframe，kind 设为 first，" +
      "references 填写用户提供的参考素材路径。" +
      "后续片段首帧直接使用上一片段返回的 lastFrame 路径，" +
      "不需要再次调用图片模型。" +
      "尾帧必须调用 video_generate_keyframe，kind 设为 last，" +
      "references 数组第一个元素必须是当前片段的首帧路径，" +
      "提示词只描述本段结束时应发生的变化，" +
      "例如人物从站立变为躺倒，不要重新设计独立画面。" +
      "尾帧必须延续首帧的人物身份、数量、服装、环境、构图和光线。" +
      "视频模型负责补足首帧到尾帧之间的连续运动。" +
      "每个片段完成后调用 video_check_frame 检查画面质量，" +
      "发现禁用内容、人物漂移或衔接异常时必须标记问题。" +
      "工具失败时先分析 error.type，临时错误可重试，参数错误必须停止。",
    tools: [
      createGenerateKeyframeTool(callbacks.generateKeyframe),
      createExtractFrameTool(callbacks.extractFrame),
      createCheckFrameTool(callbacks.checkFrame),
      createGetMetadataTool(),
    ],
  });

  return {
    agent,
    runner: new Runner({
      modelProvider: provider,
      tracingDisabled: false,
      workflowName: "hvv 帧生成",
    }),
  };
}
