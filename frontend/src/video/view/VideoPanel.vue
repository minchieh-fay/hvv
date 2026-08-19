<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Check, Close, Delete, DocumentAdd, Film, MagicStick, Plus, Upload, VideoPlay } from "@element-plus/icons-vue";
import {
  callAgnesImage,
  createAgnesVideo,
  createVideoSession,
  dataURLToBlob,
  deleteVideoSession,
  describeVideoError,
  getVideoDate,
  listVideoReferences,
  listVideoSessions,
  loadVideoContext,
  loadVideoSession,
  saveVideoFile,
  saveVideoReference,
  saveVideoSession,
  waitForAgnesVideo,
} from "../api";
import { createVideoProductionAgent, createVideoScriptAgent } from "../agents/index";
import { concatMp4Segments } from "../infra/concat";
import { appendVideoLog } from "../log";
import { extractVideoFrame } from "../infra/frame";
import { buildPreviewTimeline, locatePreviewTime } from "../infra/preview";
import { configureVideoTracing } from "../agents/trace";
import { llmStore } from "../../store/llm";

const viewMode = ref("list");
const step = ref("materials");
const session = ref(null);
const sessions = ref([]);
const ratio = ref("16:9");
const content = ref("");
const minDuration = ref(0);
const maxDuration = ref(0);
const references = ref([]);
const referenceDate = ref(getVideoDate());
const selectedReferences = ref([]);
const selectedReferenceItems = ref([]);
const pickerVisible = ref(false);
const scriptText = ref("");
const scriptData = ref(null);
const segments = ref([]);
const previewVideo = ref(null);
const previewIndex = ref(0);
const previewTime = ref(0);
const generating = ref(false);
const progressText = ref("");
const finalVideoURL = ref("");
const referenceFileInput = ref(null);
const timeline = computed(() => buildPreviewTimeline(segments.value));
const previewDuration = computed(() => timeline.value.at(-1)?.previewEnd || 0);
const currentSegment = computed(() => timeline.value[previewIndex.value]);

const VISUAL_DIRECTION_LABELS = {
  summary: "视觉总纲",
  visualIdentity: "人物与产品视觉身份",
  mustKeep: "必须保持",
  mustAvoid: "禁止改变",
};

// 记录日志但不阻断视频生成主流程。
async function recordEvent(event, payload = {}) {
  try {
    await appendVideoLog(session.value, event, payload);
  } catch (error) {
    console.warn("视频日志写入失败", error);
  }
}

// 读取视频制作列表中的 Session。
async function loadSessions() {
  sessions.value = await listVideoSessions();
}

// 读取今天的图片参考项，并恢复当前 Session 的图片描述。
async function loadReferences() {
  references.value = await listVideoReferences(referenceDate.value);
  const savedReferences = session.value?.references || [];
  selectedReferences.value = savedReferences.map((reference) => reference.path);
  for (const item of references.value) {
    const saved = savedReferences.find((reference) => reference.path === item.path);
    if (saved) {
      item.name = saved.name || "";
      item.description = saved.description || "";
    }
  }
}

// 打开参考图选择弹框。
function openReferencePicker() {
  pickerVisible.value = true;
}

// 选择或取消图片库中的一张参考图。
function togglePickerReference(item) {
  const exists = selectedReferenceItems.value.some((reference) => reference.path === item.path);
  if (exists)
    selectedReferenceItems.value = selectedReferenceItems.value.filter((reference) => reference.path !== item.path);
  else
    selectedReferenceItems.value = [
      ...selectedReferenceItems.value,
      { ...item, name: item.name || "", description: item.description || "" },
    ];
}

// 确认弹框中的图片选择并关闭弹框。
function confirmReferencePicker() {
  selectedReferences.value = selectedReferenceItems.value.map((item) => item.path);
  pickerVisible.value = false;
}

// 从当前视频参考图中移除图片，但不删除图片库原文件。
function removeSelectedReference(path) {
  selectedReferenceItems.value = selectedReferenceItems.value.filter((item) => item.path !== path);
  selectedReferences.value = selectedReferences.value.filter((item) => item !== path);
}

// 切换图片库日期并刷新可选参考图。
async function changeReferenceDate(date) {
  referenceDate.value = date;
  try {
    await loadReferences();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

// 读取本地图片文件并保存到共享图片库。
function importReferenceFile(file) {
  if (!file?.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await saveVideoReference(reader.result, file.name);
      referenceDate.value = getVideoDate();
      await loadReferences();
      ElMessage.success("参考图已加入图片库");
    } catch (error) {
      ElMessage.error(error.message);
    }
  };
  reader.readAsDataURL(file);
}

// 响应 Ctrl/Command+V，将剪贴板图片保存到共享图片库。
function handlePaste(event) {
  const item = [...(event.clipboardData?.items || [])].find((value) => value.type.startsWith("image/"));
  if (!item) return;
  event.preventDefault();
  importReferenceFile(item.getAsFile());
}

// 创建空白视频 Session 并首先进入参考图步骤。
async function startNewVideo() {
  try {
    const result = await createVideoSession({
      orientation: ratio.value === "16:9" ? "landscape" : "portrait",
      ratio: ratio.value,
      content: "",
      minDuration: 0,
      maxDuration: 0,
    });
    session.value = result.session;
    await recordEvent("session.created", { ratio: session.value.ratio });
    await loadReferences();
    viewMode.value = "editor";
    step.value = "materials";
  } catch (error) {
    await recordEvent("session.failed", { message: error.message, name: error.name });
    ElMessage.error(error.message);
  }
}

// 打开列表中的已有视频 Session。
async function openVideoSession(item) {
  try {
    const result = await loadVideoSession(item);
    session.value = result;
    ratio.value = result.ratio || "16:9";
    content.value = result.content || "";
    minDuration.value = result.minDuration || 0;
    maxDuration.value = result.maxDuration || 0;
    scriptData.value = normalizeScript(result.script);
    scriptText.value = scriptData.value ? formatScriptForHuman(scriptData.value) : "";
    segments.value = result.segments || [];
    finalVideoURL.value = result.finalVideo ? `/media/${result.finalVideo}` : "";
    referenceDate.value = result.references?.[0]?.path?.split("/")[0] || getVideoDate();
    await loadReferences();
    selectedReferenceItems.value =
      result.references
        ?.map((saved) => ({ ...references.value.find((item) => item.path === saved.path), ...saved }))
        .filter((item) => item.path) || [];
    selectedReferences.value = selectedReferenceItems.value.map((item) => item.path);
    viewMode.value = "editor";
    step.value = result.script ? "script" : "materials";
  } catch (error) {
    ElMessage.error(error.message);
  }
}

// 返回视频制作列表。
async function backToVideoList() {
  viewMode.value = "list";
  session.value = null;
  await loadSessions();
}

// 保存参考图的名称和描述，并进入内容与剧本页面。
async function continueFromMaterials() {
  if (!selectedReferences.value.length) {
    ElMessage.warning("请至少选择一张参考图");
    return;
  }
  session.value.ratio = ratio.value;
  session.value.orientation = ratio.value === "16:9" ? "landscape" : "portrait";
  session.value.references = selectedReferenceItems.value.map((item) => ({
    path: item.path,
    name: item.name || item.path.split("/").pop(),
    description: item.description || "",
  }));
  await saveVideoSession(session.value);
  await recordEvent("references.confirmed", { references: session.value.references });
  step.value = "script";
}

// 切换一张用户参考图的选中状态。
function toggleReference(item) {
  selectedReferences.value = selectedReferences.value.includes(item.path)
    ? selectedReferences.value.filter((path) => path !== item.path)
    : [...selectedReferences.value, item.path];
}

// 将结构化剧本转换为适合人类阅读的章节式剧本文本。
function formatScriptForHuman(script) {
  const direction = Object.entries(VISUAL_DIRECTION_LABELS)
    .map(([key, label]) => {
      const value = script.visualDirection?.[key] || "未指定";
      const text = Array.isArray(value) ? value.join("；") : value;
      return `${label}：${text}`;
    })
    .join("\n");
  const scenes = script.scenes
    .map(
      (scene, index) =>
        `${index + 1}: [预计${scene.duration}秒] ${scene.action}\n` + `   台词：${scene.dialogue || "无"}`,
    )
    .join("\n");
  return `【全局画面调性】\n${direction}\n\n【分镜剧本】\n${scenes}`;
}

// 将 Session 状态转换为列表中的中文显示文本。
function formatSessionStatus(status) {
  if (status === "completed") return "已完成";
  if (status === "script-ready") return "剧本已生成";
  return "草稿";
}

// 格式化视频 Session 创建时间，显示在列表状态信息的最前面。
function formatSessionCreatedAt(value) {
  if (!value) return "创建时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

// 删除列表中的视频 Session，并刷新当前列表。
async function removeVideoSession(item) {
  try {
    await ElMessageBox.confirm(
      "删除后会同时移除剧本、日志、片段和生成的视频，是否继续？",
      "删除视频项目",
      {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
    await deleteVideoSession(item);
    if (session.value?.id === item.id) {
      session.value = null;
      viewMode.value = "list";
    }
    await loadSessions();
    ElMessage.success("视频项目已删除");
  } catch (error) {
    if (error !== "cancel" && error !== "close") ElMessage.error(error.message);
  }
}

// 从人类可读剧本中读取可编辑的全局画面调性。
function parseVisualDirection(text) {
  const direction = { ...(scriptData.value?.visualDirection || {}) };
  for (const [key, label] of Object.entries(VISUAL_DIRECTION_LABELS)) {
    const line = text.match(new RegExp(`^${label}：(.+)$`, "m"));
    if (line) {
      const value = line[1].trim();
      direction[key] = ["mustKeep", "mustAvoid"].includes(key)
        ? value
            .split(/[；;]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 3)
        : value;
    }
  }
  return direction;
}

// 将用户编辑后的章节式剧本文本解析回结构化场景。
function parseHumanScript(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const header = line.match(/^\s*\d+\s*[:：]\s*\[(?:约|预计)?(\d+(?:\.\d+)?)秒?\]\s*(.*)$/);
    if (header) {
      if (current) blocks.push(current);
      current = { duration: Number(header[1]), action: header[2].trim(), dialogue: "" };
      continue;
    }
    const dialogue = line.match(/^\s*台词\s*[:：]\s*(.*)$/);
    if (dialogue && current) current.dialogue = dialogue[1].trim() === "无" ? "" : dialogue[1].trim();
  }
  if (current) blocks.push(current);
  if (!blocks.length) throw new Error("剧本格式无效，请使用“1: [预计20秒] 章节内容”格式");
  return blocks.map((block, index) => {
    const original = scriptData.value?.scenes?.[index] || {};
    if (block.duration <= 0) throw new Error(`第 ${index + 1} 段时长必须大于 0`);
    return {
      ...original,
      id: original.id || `scene-${index + 1}`,
      duration: block.duration,
      action: block.action,
      dialogue: block.dialogue,
      characters: original.characters || [],
      objects: original.objects || [],
    };
  });
}

// 计算所有场景时长之和，作为剧本预估总时长。
function calculateScriptDuration(scenes) {
  return scenes.reduce((total, scene) => total + Number(scene.duration || 0), 0);
}

// 根据正常中文口播速度估算章节时长，保留标点停顿和动作缓冲。
function estimateSceneDuration(scene) {
  const dialogue = String(scene.dialogue || "");
  const spokenLength = dialogue.replace(/[\s，。！？、,.!?；：;:]/g, "").length;
  const pauseCount = (dialogue.match(/[，、；：,;:]/g) || []).length;
  const sentenceCount = (dialogue.match(/[。！？.!?]/g) || []).length;
  const speechSeconds = spokenLength ? spokenLength / 6 : 0;
  const pauseSeconds = pauseCount * 0.25 + sentenceCount * 0.5;
  const actionLength = String(scene.action || "").replace(/\s/g, "").length;
  const actionSeconds = actionLength ? Math.min(3, 1 + actionLength / 20) : 1;
  return Math.max(2, Math.ceil(Math.max(speechSeconds + pauseSeconds, actionSeconds) * 10) / 10);
}

// 根据用户内容和台词估算章节时长，不设置固定的全片时长上限。
function normalizeGeneratedScenes(scenes) {
  return scenes.map((scene) => ({ ...scene, duration: estimateSceneDuration(scene) }));
}

// 兼容旧版使用 start/end 保存的剧本，并统一转换为 duration。
function normalizeScript(script) {
  if (!script?.scenes) return null;
  let previousEnd = 0;
  const scenes = script.scenes.map((scene) => {
    const duration = scene.dialogue
      ? estimateSceneDuration(scene)
      : Number(scene.duration || Number(scene.end) - Number(scene.start || previousEnd) || 5);
    previousEnd = Number(scene.end || previousEnd + duration);
    return { ...scene, duration };
  });
  const visualDirection = script.visualDirection || {
    summary: "",
    visualIdentity: "",
    mustKeep: ["", "", ""],
    mustAvoid: ["", "", ""],
  };
  return {
    ...script,
    visualDirection,
    scenes,
    estimatedDuration: calculateScriptDuration(scenes),
  };
}

// 生成结构化剧本并保存预估时长。
async function generateScript() {
  if (!session.value || !llmStore.state.apiKeyConfigured || generating.value) return;
  generating.value = true;
  progressText.value = "正在生成剧本";
  try {
    const context = await loadVideoContext();
    const captured = ref(null);
    const { agent, runner } = createVideoScriptAgent(context, captured);
    const traceConfig = configureVideoTracing(session.value);
    const referenceText = selectedReferences.value
      .map((path) => {
        const item = selectedReferenceItems.value.find((reference) => reference.path === path);
        return `${item?.path || path}: ${item?.description || "用户参考图"}`;
      })
      .join("\n");
    const scriptPrompt =
      `视频内容：${content.value}\n` +
      `目标时长：${minDuration.value || 0}-${maxDuration.value || 0}秒\n` +
      `参考素材：${referenceText || "无"}\n` +
      "请先判断视频用途和专业领域，生成全局画面调性，再生成连续剧本。" +
      "产品营销要真实可信，魔幻、科幻、动画等题材要明确视觉规则。" +
      "请把完整台词合理分配到对应章节，不要为了生成接口而把章节拆成短片段。";
    await recordEvent("script.requested", { prompt: scriptPrompt, model: context.settings.model });
    await runner.run(agent, scriptPrompt, traceConfig);
    if (!captured.value?.scenes?.length) throw new Error("剧本 Agent 没有返回场景");
    const normalizedScenes = normalizeGeneratedScenes(captured.value.scenes);
    scriptData.value = {
      ...captured.value,
      scenes: normalizedScenes,
      estimatedDuration: calculateScriptDuration(normalizedScenes),
    };
    scriptText.value = formatScriptForHuman(scriptData.value);
    session.value.script = scriptData.value;
    session.value.scriptText = scriptText.value;
    session.value.content = content.value.trim();
    session.value.minDuration = Number(minDuration.value) || 0;
    session.value.maxDuration = Number(maxDuration.value) || 0;
    session.value.references = selectedReferenceItems.value.map((item) => ({
      path: item.path,
      name: item.name || item.path.split("/").pop(),
      description: item.description || "",
    }));
    session.value.estimatedDuration = scriptData.value.estimatedDuration;
    session.value.status = "script-ready";
    await saveVideoSession(session.value);
    await recordEvent("script.completed", { script: captured.value });
    step.value = "script";
  } catch (error) {
    const message = describeVideoError(error, "剧本生成失败");
    await recordEvent("script.failed", { message, name: error.name });
    ElMessage.error(message);
  } finally {
    generating.value = false;
    progressText.value = "";
  }
}

// 校验并保存剧本页修改后的结构化 JSON。
async function saveScript() {
  try {
    const scenes = parseHumanScript(scriptText.value);
    scriptData.value = {
      ...scriptData.value,
      visualDirection: parseVisualDirection(scriptText.value),
      estimatedDuration: calculateScriptDuration(scenes),
      scenes,
    };
    session.value.script = scriptData.value;
    session.value.scriptText = scriptText.value;
    session.value.content = content.value.trim();
    session.value.minDuration = Number(minDuration.value) || 0;
    session.value.maxDuration = Number(maxDuration.value) || 0;
    await saveVideoSession(session.value);
    ElMessage.success("剧本已保存");
  } catch (error) {
    ElMessage.error(`剧本格式错误：${error.message}`);
  }
}

// 根据目标秒数选择满足 8n+1 规则的帧数。
function chooseFrameCount(duration) {
  const target = Math.max(2, Math.min(5.04, Number(duration) || 5));
  const n = Math.max(1, Math.round((target * 24 - 1) / 8));
  return Math.min(441, 8 * n + 1);
}

// 调用图片模型生成关键帧并保存到当前 Session。
async function agentGenerateKeyframe(input) {
  const references = input.references.map(extractReferencePath);
  const outputPath = normalizeGeneratedFramePath(input);
  return generateKeyframe(input.prompt, references, outputPath);
}

// 从带有名称和描述的参考图文本中提取真正的媒体路径。
function extractReferencePath(value) {
  const text = String(value || "").trim();
  const matched = text.match(/\(([^()]+\/[^()]+)\)$/);
  return matched?.[1] || text;
}

// 将 Agent 生成的临时帧路径转换为当前 Session 下的安全相对路径。
function normalizeGeneratedFramePath(input) {
  const rawPath = String(input.outputPath || "").replace(/^\/tmp\/frames\//, "");
  if (rawPath.startsWith("segments/")) return rawPath;
  const segmentID = rawPath.match(/segment-\d+/)?.[0] || "segment-unknown";
  const suffix = input.kind === "last" ? "last.png" : "first.png";
  return `segments/${segmentID}/${suffix}`;
}

// 调用视频模型生成片段、下载结果并提取真实尾帧。
async function agentGenerateSegment(input) {
  const context = await loadVideoContext();
  const result = await createAgnesVideo(
    {
      prompt: input.prompt,
      frames: [input.firstFrame, input.lastFrame],
      numFrames: input.numFrames,
      ratio: ratio.value,
    },
    context,
  );
  const taskID = result.video_id || result.task_id || result.id;
  await recordEvent("video.requested", {
    segmentID: input.segmentID,
    prompt: input.prompt,
    frames: [input.firstFrame, input.lastFrame],
    numFrames: input.numFrames,
    taskID,
    model: "agnes-video-v2.0",
  });
  const completed = await waitForAgnesVideo(result, context, new AbortController().signal, (progress) => {
    progressText.value = `${input.segmentID} 生成 ${progress}%`;
  });
  const videoResponse = await fetch(completed.metadata?.url || completed.url);
  if (!videoResponse.ok) throw new Error("下载视频结果失败");
  const videoPath = await saveVideoFile(
    session.value,
    `segments/${input.segmentID}/source.mp4`,
    await videoResponse.blob(),
  );
  const videoURL = `/media/${videoPath.path}`;
  const actualDuration = Number(completed.seconds || input.numFrames / 24);
  const extractedBlob = await extractVideoFrame(videoURL, actualDuration);
  const extracted = await saveVideoFile(
    session.value,
    `segments/${input.segmentID}/extracted-last-frame.png`,
    extractedBlob,
  );
  const segment = {
    id: input.segmentID,
    status: "completed",
    url: videoURL,
    video: videoPath.path,
    firstFrame: input.firstFrame,
    lastFrame: extracted.path,
    actualDuration,
    targetDuration: input.numFrames / 24,
    numFrames: input.numFrames,
    frameRate: 24,
    taskID,
    prompt: input.prompt,
  };
  segments.value = [...segments.value.filter((item) => item.id !== input.segmentID), segment].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  await saveVideoSession({ ...session.value, status: "generating", segments: segments.value });
  await recordEvent("video.completed", {
    segmentID: input.segmentID,
    taskID,
    video: videoPath.path,
    extractedLastFrame: extracted.path,
    actualDuration,
  });
  return { segment, lastFrame: extracted.path };
}

// 保存 Agent 为边界检查或后续片段提取出的 PNG 帧。
async function agentExtractFrame(blob, outputPath) {
  const saved = await saveVideoFile(session.value, outputPath, blob);
  return { path: saved.path, url: `/media/${saved.path}` };
}

// 使用 Agnes 视觉能力检查视频帧是否满足 Agent 的要求。
async function agentCheckFrame(dataURL, requirement) {
  const context = await loadVideoContext();
  const response = await fetch(`${context.settings.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${context.settings.apiKey}` },
    body: JSON.stringify({
      model: context.settings.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `检查图片是否满足要求：${requirement}。`,
                '只返回 JSON：{"passed":true或false,"explanation":"原因"}',
              ].join(""),
            },
            { type: "image_url", image_url: { url: dataURL } },
          ],
        },
      ],
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(describeVideoError(result.error, "视觉检查失败"));
  try {
    return JSON.parse(result.choices?.[0]?.message?.content || "{}");
  } catch (_) {
    return { passed: true, explanation: "视觉模型未返回可解析结果" };
  }
}

// 将 Agent 的片段结果同步到播放器预览时间轴。
function agentUpdatePreview(nextTimeline) {
  segments.value = segments.value.map((segment) => nextTimeline.find((item) => item.id === segment.id) || segment);
  if (nextTimeline.length) step.value = "preview";
}

// 保存 Agent 当前状态，确保中断或重启后可以恢复。
async function agentSaveSession(input) {
  session.value.status = input.status;
  session.value.segments = segments.value;
  session.value.agentMessage = input.message || "";
  await saveVideoSession({ ...session.value });
}

// 保存 Agent 合成出的最终视频。
async function agentConcat(blob) {
  const saved = await saveVideoFile(session.value, "final.mp4", blob);
  finalVideoURL.value = `/media/${saved.path}`;
  session.value.finalVideo = saved.path;
  await saveVideoSession({ ...session.value, status: "completed" });
  return { path: saved.path, size: blob.size };
}

// 调用图片模型生成关键帧并保存到当前 Session。
async function generateKeyframe(prompt, referencePaths, path) {
  try {
    const context = await loadVideoContext();
    await recordEvent("keyframe.requested", {
      prompt,
      references: referencePaths,
      output: path,
      model: "agnes-image-2.1-flash",
    });
    const dataURL = await callAgnesImage({ prompt, references: referencePaths, ratio: ratio.value }, context);
    const blob = dataURLToBlob(dataURL);
    if (!blob.size) throw new Error("图片模型返回了空图片");
    const saved = await saveVideoFile(session.value, path, blob);
    await recordEvent("keyframe.completed", { path: saved.path });
    return saved.path;
  } catch (error) {
    await recordEvent("keyframe.failed", { output: path, message: error.message, name: error.name });
    throw error;
  }
}

// 按剧本生成片段，并用浏览器提取真实尾帧作为后续参考。
async function generateVideo() {
  if (!scriptData.value || generating.value) return;
  generating.value = true;
  segments.value = [];
  session.value.status = "generating";
  try {
    const context = await loadVideoContext();
    const traceConfig = configureVideoTracing(session.value);
    const { agent, runner } = createVideoProductionAgent(context, {
      ratio: ratio.value,
      generateKeyframe: agentGenerateKeyframe,
      generateSegment: agentGenerateSegment,
      extractFrame: agentExtractFrame,
      checkFrame: agentCheckFrame,
      updatePreview: agentUpdatePreview,
      saveSession: agentSaveSession,
      concat: agentConcat,
    });
    const referenceText = selectedReferenceItems.value
      .map((item) => `${item.path} | 名称：${item.name} | 描述：${item.description || "无描述"}`)
      .join("\n");
    const prompt =
      `Session=${session.value.id}\n` +
      `完整结构化剧本：${JSON.stringify(scriptData.value)}\n` +
      `参考素材：${referenceText}\n` +
      "调用 video_generate_keyframe 时，references 数组只能填写参考素材中的路径，" +
      "不能填写名称或描述。" +
      "请逐段自主制作。每段 ID 使用 segment-001 形式。" +
      "后续段首帧使用上一段工具返回的 lastFrame。最后完成后合成最终视频。";
    await recordEvent("video.requested", { prompt, model: "agnes-video-v2.0" });
    await runner.run(agent, prompt, { ...traceConfig, maxTurns: 60 });
    if (!segments.value.some((segment) => segment.url && Number(segment.actualDuration) > 0)) {
      throw new Error("视频生成未产生可播放片段，请检查 Agent 日志中的首帧或视频接口错误");
    }
    session.value.status = "completed";
    await saveVideoSession({ ...session.value, segments: segments.value });
    step.value = "preview";
  } catch (error) {
    const message = describeVideoError(error, "视频生成失败");
    session.value.status = "failed";
    session.value.agentMessage = message;
    try {
      await saveVideoSession({ ...session.value, segments: segments.value });
    } catch (_) {
      // 失败状态保存不能覆盖原始视频错误。
    }
    await recordEvent("video.failed", { message, name: error.name });
    ElMessage.error(message);
  } finally {
    generating.value = false;
    progressText.value = "";
  }
}

// 切换单播放器当前片段和片段内时间。
function showSegment(index, localTime = 0, autoplay = false) {
  if (!timeline.value[index]) return;
  previewIndex.value = index;
  window.requestAnimationFrame(() => {
    if (!previewVideo.value) return;
    previewVideo.value.src = timeline.value[index].url;
    previewVideo.value.currentTime = localTime;
    if (autoplay) previewVideo.value.play().catch(() => {});
  });
}

// 响应当前片段播放结束并继续播放下一段。
function handlePreviewEnded() {
  if (previewIndex.value < timeline.value.length - 1) showSegment(previewIndex.value + 1, 0, true);
}

// 拖动总时间轴并定位到具体片段。
function seekPreview(event) {
  const found = locatePreviewTime(timeline.value, Number(event.target.value));
  if (found) showSegment(timeline.value.indexOf(found.segment), found.localTime);
}

// 将当前片段播放时间同步到总时间轴。
function updatePreviewTime() {
  if (currentSegment.value && previewVideo.value)
    previewTime.value = currentSegment.value.previewStart + previewVideo.value.currentTime;
}

// 在浏览器中合成所有有效片段并保存最终 MP4。
async function finalizeVideo() {
  if (!timeline.value.length || generating.value) return;
  generating.value = true;
  progressText.value = "正在合成最终视频";
  try {
    const blob = await concatMp4Segments(timeline.value.map((item) => item.url));
    const saved = await saveVideoFile(session.value, "final.mp4", blob);
    finalVideoURL.value = `/media/${saved.path}`;
    session.value.finalVideo = saved.path;
    await saveVideoSession(session.value);
    await recordEvent("video.finalized", { path: saved.path, segments: timeline.value.map((item) => item.id) });
    ElMessage.success("最终视频已合成");
  } catch (error) {
    ElMessage.error(`视频合成失败：${describeVideoError(error)}`);
  } finally {
    generating.value = false;
    progressText.value = "";
  }
}

// 初始化视频制作列表。
onMounted(() => {
  loadSessions().catch((error) => ElMessage.error(error.message));
});

// 注册视频模块的剪贴板图片监听。
onMounted(() => {
  window.addEventListener("paste", handlePaste);
});

// 移除视频模块注册的剪贴板图片监听。
onUnmounted(() => {
  window.removeEventListener("paste", handlePaste);
});
</script>

<template>
  <section class="video-panel">
    <header class="video-toolbar">
      <div>
        <h1>视频制作</h1>
        <span>Agnes Video 2.0 · 关键帧分段生成</span>
      </div>
      <div class="video-toolbar-actions">
        <el-button v-if="viewMode === 'editor'" text @click="backToVideoList">视频列表</el-button
        ><el-button type="primary" @click="startNewVideo"
          ><el-icon><DocumentAdd /></el-icon>新建视频</el-button
        >
      </div>
    </header>
    <div v-if="viewMode === 'list'" class="video-section video-list-section">
      <div v-if="!sessions.length" class="video-list-empty">
        <el-icon><Film /></el-icon>
        <h2>还没有视频项目</h2>
        <p>新建视频后，项目会保存在这里。</p>
        <el-button type="primary" @click="startNewVideo"
          ><el-icon><DocumentAdd /></el-icon>新建视频</el-button
        >
      </div>
      <div v-else class="video-list">
        <div v-for="item in sessions" :key="item.id" class="video-list-item" @click="openVideoSession(item)">
          <span class="video-list-icon"
            ><el-icon><Film /></el-icon></span
          ><span class="video-list-copy"
            ><strong>{{ item.content || "未命名视频" }}</strong
            ><small
              >{{ formatSessionCreatedAt(item.createdAt) }} · {{ item.ratio }} ·
              {{ formatSessionStatus(item.status) }}</small
            ></span
          ><el-button
            class="video-list-delete"
            text
            type="danger"
            title="删除视频项目"
            aria-label="删除视频项目"
            @click.stop="removeVideoSession(item)"
            ><el-icon><Delete /></el-icon
          ></el-button>
        </div>
      </div>
    </div>
    <template v-else>
      <el-tabs v-model="step" class="video-tabs"
        ><el-tab-pane label="添加参考图" name="materials" :disabled="generating" /><el-tab-pane
          label="内容与剧本"
          name="script"
          :disabled="generating" /><el-tab-pane label="视频预览" name="preview" :disabled="!segments.length"
      /></el-tabs>
      <div v-if="step === 'materials'" class="video-section materials-layout">
        <div class="video-form">
          <h2>添加参考图</h2>
          <p class="video-muted">
            <span>先为视频选择人物、产品和物品。</span>
            <span>原始图片只作为图片模型参考，不会直接传给视频模型。</span>
          </p>
          <div class="video-material-toolbar">
            <span>{{ selectedReferenceItems.length }} 张参考图已选</span
            ><el-button type="primary" @click="openReferencePicker"
              ><el-icon><Plus /></el-icon>选择参考图</el-button
            >
          </div>
          <div class="video-form-row">
            <label
              >画面
              <el-radio-group v-model="ratio"
                ><el-radio-button label="16:9">横屏</el-radio-button
                ><el-radio-button label="9:16">竖屏</el-radio-button></el-radio-group
              ></label
            >
          </div>
          <div v-for="item in selectedReferenceItems" :key="item.path" class="video-selected-reference">
            <img :src="item.url" alt="已选参考图" />
            <div class="video-selected-fields">
              <el-input v-model="item.name" placeholder="名称，例如 TS5100" /><el-input
                v-model="item.description"
                placeholder="描述人物、产品或物品外观"
              />
            </div>
            <el-button
              text
              type="danger"
              title="从当前视频移除"
              aria-label="从当前视频移除"
              @click="removeSelectedReference(item.path)"
              ><el-icon><Delete /></el-icon
            ></el-button>
          </div>
          <el-empty v-if="!selectedReferenceItems.length" description="还没有选择参考图" /><el-button
            type="primary"
            :disabled="!selectedReferenceItems.length"
            @click="continueFromMaterials"
            ><el-icon><MagicStick /></el-icon>确定参考图，填写视频内容</el-button
          >
        </div>
      </div>
      <div v-else-if="step === 'script'" class="video-section script-layout">
        <div class="video-form">
          <h2>内容与剧本</h2>
          <el-input
            v-model="content"
            type="textarea"
            :rows="3"
            :disabled="generating"
            placeholder="例如：小明拿起 TS5100，介绍它的功能……"
          />
          <div class="video-form-row duration-row">
            <el-input-number v-model="minDuration" :min="0" :max="9999" /><span>至</span
            ><el-input-number
              v-model="maxDuration"
              :min="0"
              :max="9999"
            /><small> 秒，均为 0 时由 AI 估算 </small>
          </div>
          <el-button
            type="primary"
            :disabled="!content.trim()"
            :loading="generating && !scriptData"
            @click="generateScript"
            ><el-icon><MagicStick /></el-icon>生成剧本</el-button
          ><el-input
            v-model="scriptText"
            class="script-input"
            type="textarea"
            :rows="18"
            placeholder="生成后的结构化剧本会显示在这里"
          />
          <div class="script-actions">
            <span v-if="scriptData"
              >预估总时长：{{ scriptData.estimatedDuration }} 秒 · {{ scriptData.scenes.length }} 段</span
            ><el-button @click="saveScript">保存剧本</el-button
            ><el-button type="primary" :disabled="!scriptData" :loading="generating" @click="generateVideo"
              ><el-icon><Film /></el-icon>生成视频</el-button
            >
          </div>
        </div>
      </div>
      <div v-else class="video-section preview-layout">
        <div class="preview-video-wrap">
          <video ref="previewVideo" controls playsinline @ended="handlePreviewEnded" @timeupdate="updatePreviewTime" />
          <div v-if="!timeline.length" class="preview-empty">
            <el-icon><VideoPlay /></el-icon><span>{{ progressText || "生成视频后将在这里播放" }}</span>
          </div>
        </div>
        <input
          class="preview-range"
          type="range"
          min="0"
          :max="previewDuration"
          step="0.01"
          :value="previewTime"
          @input="seekPreview"
        />
        <div class="segment-list">
          <button
            v-for="(segment, index) in timeline"
            :key="segment.id"
            type="button"
            :class="{ active: index === previewIndex }"
            @click="showSegment(index)"
          >
            {{ segment.id }} · {{ segment.actualDuration.toFixed(2) }} 秒
          </button>
        </div>
        <div class="final-video-actions">
          <el-button type="primary" :loading="generating" @click="finalizeVideo"
            ><el-icon><Film /></el-icon>合成最终视频</el-button
          ><a v-if="finalVideoURL" :href="finalVideoURL" target="_blank">打开最终视频</a>
        </div>
      </div>
    </template>
    <div v-if="generating" class="video-progress">{{ progressText }}</div>
    <el-dialog v-model="pickerVisible" title="选择参考图" width="760px" class="reference-picker-dialog"
      ><div class="picker-toolbar">
        <el-date-picker
          v-model="referenceDate"
          value-format="YYYYMMDD"
          type="date"
          :clearable="false"
          @change="changeReferenceDate"
        /><el-button text @click="referenceFileInput.click()"
          ><el-icon><Upload /></el-icon>导入图片</el-button
        ><input
          ref="referenceFileInput"
          hidden
          type="file"
          accept="image/*"
          @change="importReferenceFile($event.target.files[0])"
        />
      </div>
      <div v-if="references.length" class="picker-grid">
        <button
          v-for="item in references"
          :key="item.path"
          type="button"
          class="picker-item"
          :class="{ selected: selectedReferenceItems.some((reference) => reference.path === item.path) }"
          @click="togglePickerReference(item)"
        >
          <img :src="item.url" alt="图片库参考图" /><span>{{ item.name || item.path.split("/").pop() }}</span
          ><i v-if="selectedReferenceItems.some((reference) => reference.path === item.path)"
            ><el-icon><Check /></el-icon
          ></i>
        </button>
      </div>
      <el-empty v-else description="该日期没有图片，可直接粘贴或导入图片" /><template #footer
        ><el-button @click="pickerVisible = false"
          ><el-icon><Close /></el-icon>取消</el-button
        ><el-button type="primary" @click="confirmReferencePicker"
          ><el-icon><Check /></el-icon>确定选择</el-button
        ></template
      ></el-dialog
    >
  </section>
</template>
