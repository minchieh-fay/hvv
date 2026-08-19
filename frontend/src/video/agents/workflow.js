import { createVideoSegmentAgent } from "./segment_agent";
import { createVideoFrameAgent } from "./frame_agent";
import { createVideoClipAgent } from "./video_agent";
import { createVideoConcatAgent } from "./concat_agent";
import { configureVideoTracing } from "./trace";
import { help_buildSegmentPlan } from "../infra/help";
import { appendVideoLog } from "../log";

// 记录日志但不阻断视频生成主流程。
async function recordEvent(session, event, payload) {
  try {
    await appendVideoLog(session, event, payload);
  } catch (error) {
    console.warn("视频日志写入失败", error);
  }
}

// 视频制作工作流：按阶段顺序编排各个子 Agent。
// 阶段 1: segment agent 规划分段
// 阶段 2: frame agent 生成首帧/尾帧
// 阶段 3: clip agent 逐段生成视频
// 阶段 4: concat agent 合成最终视频
// 每个阶段完成后更新 session 状态，支持中断恢复。
export async function runVideoWorkflow(context, scriptData, callbacks) {
  const session = callbacks.session;
  const traceConfig = configureVideoTracing(session);
  const allSegments = [];

  try {
    // ========== 阶段 1: 分段规划 ==========
    callbacks.onPhaseChange("plan", "正在规划分段...");
    await recordEvent(session, "workflow.phase.started", { phase: "plan" });

    const { agent: segmentAgent, runner: segmentRunner } = createVideoSegmentAgent(context);
    const scenes = scriptData.scenes || [];
    const planPrompt = `结构化剧本：${JSON.stringify({
      visualDirection: scriptData.visualDirection,
      scenes,
    })}`;
    await segmentRunner.run(segmentAgent, planPrompt, traceConfig);

    // plan_segments tool 已通过 help_buildSegmentPlan 执行，结果在 callbacks 中
    const plannedSegments = callbacks.segments || help_buildSegmentPlan(scenes);
    for (const seg of plannedSegments) {
      allSegments.push({
        id: seg.id,
        status: "planned",
        numFrames: seg.numFrames,
        targetDuration: seg.actualSeconds,
        action: seg.action,
        dialogue: seg.dialogue,
        characters: seg.characters || [],
        objects: seg.objects || [],
      });
    }
    await callbacks.saveSession({ status: "planning", segments: allSegments, message: "分段规划完成" });
    await recordEvent(session, "workflow.phase.completed", { phase: "plan", count: allSegments.length });

    // ========== 阶段 2: 帧生成 ==========
    callbacks.onPhaseChange("frame", "正在生成关键帧...");
    await recordEvent(session, "workflow.phase.started", { phase: "frame" });

    const { agent: frameAgent, runner: frameRunner } = createVideoFrameAgent(context, callbacks);
    const visualDirection = scriptData.visualDirection || {};
    const framePrompt =
      `全片视觉方向：${JSON.stringify(visualDirection)}\n` +
      `共有 ${allSegments.length} 个片段。\n` +
      `第一段首帧：调用 video_generate_keyframe，kind=first，` +
      `references 填写用户参考素材路径。\n` +
      `后续段首帧：直接使用上一段的 lastFrame，不需要调用图片模型。\n` +
      `每段的尾帧：调用 video_generate_keyframe，kind=last，` +
      `references 数组第一个元素必须是本段首帧路径。\n` +
      `提示词描述本段动作结束时的状态变化，不重新设计独立画面。`;
    await frameRunner.run(frameAgent, framePrompt, traceConfig);

    await callbacks.saveSession({ status: "frames_ready", segments: allSegments, message: "关键帧生成完成" });
    await recordEvent(session, "workflow.phase.completed", { phase: "frame", count: allSegments.length });

    // ========== 阶段 3: 视频片段生成 ==========
    callbacks.onPhaseChange("clip", "正在生成视频片段...");
    await recordEvent(session, "workflow.phase.started", { phase: "clip" });

    const { agent: clipAgent, runner: clipRunner } = createVideoClipAgent(context, callbacks);
    const clipsPrompt =
      `分段计划：${JSON.stringify(
        allSegments.map((s) => ({
          id: s.id,
          numFrames: s.numFrames,
          targetDuration: s.targetDuration,
          action: s.action,
          dialogue: s.dialogue,
        })),
      )}\n` +
      `请逐段生成视频片段。首帧和尾帧路径在上下文中提供。\n` +
      `每段完成后立即调用 video_build_preview 更新进度。`;
    await clipRunner.run(clipAgent, clipsPrompt, { ...traceConfig, maxTurns: 60 });

    await callbacks.saveSession({ status: "clips_done", segments: allSegments, message: "视频片段生成完成" });
    await recordEvent(session, "workflow.phase.completed", { phase: "clip", count: allSegments.length });

    // ========== 阶段 4: 最终合成 ==========
    callbacks.onPhaseChange("concat", "正在合成最终视频...");
    await recordEvent(session, "workflow.phase.started", { phase: "concat" });

    const { agent: concatAgent, runner: concatRunner } = createVideoConcatAgent(context, callbacks);
    const completedSegments = allSegments.filter((s) => s.status === "completed" && s.url);
    if (completedSegments.length > 0) {
      const urls = completedSegments.map((s) => s.url);
      const concatPrompt = `合成以下 ${urls.length} 个片段：${JSON.stringify(urls)}`;
      await concatRunner.run(concatAgent, concatPrompt, traceConfig);
    } else {
      await callbacks.saveSession({ status: "failed", segments: allSegments, message: "没有可合成的有效片段" });
      await recordEvent(session, "workflow.phase.failed", { phase: "concat", reason: "no_completed_segments" });
      return { success: false, segments: allSegments };
    }

    await callbacks.saveSession({ status: "completed", segments: allSegments, message: "视频制作完成" });
    await recordEvent(session, "workflow.completed", { count: completedSegments.length });

    return { success: true, segments: allSegments };
  } catch (error) {
    await callbacks.saveSession({ status: "failed", segments: allSegments, message: error.message });
    await recordEvent(session, "workflow.failed", { error: error.message, name: error.name });
    throw error;
  }
}
