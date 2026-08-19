import { tool } from "@openai/agents";
import { z } from "zod";
import { buildPreviewTimeline } from "../infra/preview";

// 创建渐进式视频预览工具。
export function createBuildPreviewTool(onPreview) {
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
