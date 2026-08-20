<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Delete,
  Film,
  FolderOpened,
  Plus,
  VideoPlay,
} from "@element-plus/icons-vue";
import { concatMp4Segments } from "../concat";
import {
  createAgnesVideo,
  createVideoSession,
  deleteVideoSession,
  appendVideoLog,
  listGeneratedReferences,
  listVideoSessions,
  loadVideoContext,
  loadVideoSession,
  openVideoSessionDirectory,
  publishFrame,
  saveVideoFile,
  saveRemoteVideoFile,
  saveVideoSession,
  sessionMediaURL,
  waitForAgnesVideo,
} from "../api";
import {
  help_blobToDataURL,
  help_describeError,
  help_durationToFrames,
  help_extractFrame,
  help_extractLastFrame,
  help_formatSessionCreatedAt,
  help_today,
} from "../help";

const view = ref("list");
const tab = ref("edit");
const sessions = ref([]);
const session = ref(null);
const references = ref([]);
const referenceDate = ref(help_today());
const picker = ref({ open: false, target: "first" });
const newVideo = ref({ open: false, ratio: "16:9" });
const loading = ref(false);
const generating = ref(false);
const progress = ref(0);
const progressLabel = ref("");
const selectedSegment = ref(0);
const playbackIndex = ref(0);
const videoPlayer = ref(null);
const secondaryVideoPlayer = ref(null);
const playerSlots = ref(["", ""]);
const activePlayerSlot = ref(0);
const thumbnailURLs = ref([]);
const context = ref(null);
const abortController = ref(null);
const activeSegment = computed(
  () => session.value?.segments?.[selectedSegment.value],
);
const completedSegments = computed(() =>
  (session.value?.segments || []).filter((item) => item.videoPath),
);
const videoURLs = computed(() =>
  completedSegments.value.map((item) => sessionMediaURL(item.videoPath)),
);
const finalVideoURL = computed(() =>
  session.value?.finalVideoPath
    ? sessionMediaURL(session.value.finalVideoPath)
    : "",
);
const obeyPlaceholders = [
  "例如：固定镜头",
  "例如：保持中景",
  "例如：保持人物外貌",
  "例如：保持背景和光线",
  "例如：动作自然连贯",
];
const forbiddenPlaceholders = [
  "例如：移动镜头",
  "例如：变换背景",
  "例如：改变人物外貌",
  "例如：改变人物着装",
  "例如：增加夸张特效",
];

// 返回条款输入行的常用示例，避免每一行重复显示相同提示。
function getRulePlaceholder(field, index) {
  const values = field === "obey" ? obeyPlaceholders : forbiddenPlaceholders;
  return values[index % values.length];
}

// 释放缩略图 Blob 地址，避免频繁切换视频时占用浏览器内存。
function clearThumbnailURLs() {
  thumbnailURLs.value.forEach((url) => URL.revokeObjectURL(url));
  thumbnailURLs.value = [];
}

// 从每个片段的第一帧生成视频列表和播放器封面图。
async function loadThumbnailURLs() {
  clearThumbnailURLs();
  const urls = await Promise.all(
    videoURLs.value.map(async (videoURL) => {
      try {
        const frame = await help_extractFrame(videoURL, 0);
        return URL.createObjectURL(frame);
      } catch (error) {
        console.warn("[hvv video] 提取视频首帧失败", { videoURL, error });
        return "";
      }
    }),
  );
  thumbnailURLs.value = urls;
}

// 片段生成或 Session 恢复后重新生成封面图。
watch(videoURLs, loadThumbnailURLs, { immediate: true });

// 首次打开视频标签时准备第一个播放器，避免播放器没有视频地址。
watch(tab, (value) => {
  const shouldPrepare =
    value === "video" && completedSegments.value.length && !playerSlots.value[0];
  if (shouldPrepare)
    preparePreview(0);
});

// 页面销毁时释放所有首帧图片地址。
onBeforeUnmount(clearThumbnailURLs);

// 页面初始化时读取视频列表和 Agnes 连接配置。
onMounted(async () => {
  try {
    context.value = await loadVideoContext();
    await refreshSessions();
  } catch (error) {
    ElMessage.error(help_describeError(error, "读取视频模块失败"));
  }
});

// 读取当前日期的视频制作列表。
async function refreshSessions() {
  sessions.value = await listVideoSessions();
}

// 将视频制作过程写入 Go 管理的 Session 日志，同时保留浏览器控制台输出。
async function writeVideoLog(event, payload = {}) {
  console.log(`[hvv video] ${event}`, payload);
  await appendVideoLog(session.value, event, payload);
}

// 打开一次性的视频比例配置页面。
function openNewVideo() {
  newVideo.value = { open: true, ratio: "16:9" };
}

// 创建 Session 并进入第一段视频编辑页面。
async function createNewVideo() {
  loading.value = true;
  try {
    const result = await createVideoSession(newVideo.value.ratio);
    session.value = result.session;
    session.value.segments = [];
    addSegment();
    newVideo.value.open = false;
    view.value = "editor";
    await persistSession();
    await refreshSessions();
  } catch (error) {
    ElMessage.error(help_describeError(error, "创建视频失败"));
  } finally {
    loading.value = false;
  }
}

// 打开已有 Session，并恢复上次编辑的片段。
async function openSession(item) {
  loading.value = true;
  try {
    session.value = await loadVideoSession(item);
    session.value.segments ||= [];
    selectedSegment.value = Math.max(0, session.value.segments.length - 1);
    view.value = "editor";
    tab.value = "edit";
  } catch (error) {
    ElMessage.error(help_describeError(error, "打开视频失败"));
    return;
  } finally {
    loading.value = false;
  }
  const pendingIndex = session.value.segments.findIndex(
    (item) => item.status === "generating" && item.taskID,
  );
  if (pendingIndex >= 0) {
    selectedSegment.value = pendingIndex;
    window.setTimeout(() => generateSegment(), 0);
  }
}

// 删除视频 Session 及其本地媒体文件。
async function removeSession(item) {
  try {
    await ElMessageBox.confirm(
      "删除后将同时移除全部视频片段，是否继续？",
      "删除视频",
      { type: "warning" },
    );
    await deleteVideoSession(item);
    if (session.value?.id === item.id) {
      session.value = null;
      view.value = "list";
    }
    await refreshSessions();
  } catch (error) {
    if (error !== "cancel" && error !== "close")
      ElMessage.error(help_describeError(error, "删除视频失败"));
  }
}

// 初始化一个新的空视频片段，并继承上一段的条款和公网尾帧。
function addSegment() {
  const previous = session.value?.segments?.at(-1);
  session.value.segments.push({
    id: `segment-${Date.now()}`,
    duration: 5,
    obey: previous ? [...previous.obey] : [""],
    forbidden: previous ? [...previous.forbidden] : [""],
    plot: "",
    firstFrame: previous?.extractedFrame || "",
    lastFrame: "",
    extractedFrame: "",
    status: "draft",
    progress: 0,
  });
  selectedSegment.value = session.value.segments.length - 1;
  tab.value = "edit";
}

// 删除当前选中的视频片段。
async function removeSegment(index) {
  if (session.value.segments.length === 1) {
    ElMessage.warning("至少保留一个视频片段");
    return;
  }
  session.value.segments.splice(index, 1);
  selectedSegment.value = Math.min(
    selectedSegment.value,
    session.value.segments.length - 1,
  );
  await persistSession();
}

// 为条款输入增加一行。
function addRule(field) {
  activeSegment.value[field].push("");
}

// 删除准守条款或禁止条款的一行，最后一行只清空内容。
function removeRule(field, index) {
  const rules = activeSegment.value[field];
  if (rules.length === 1) {
    rules[0] = "";
    return;
  }
  rules.splice(index, 1);
}

// 从图片库中打开指定用途的公网参考图选择器。
async function openPicker(target) {
  picker.value = { open: true, target };
  await refreshReferences();
}

// 按日期刷新只包含官方网络图的图片库。
async function refreshReferences() {
  try {
    references.value = await listGeneratedReferences(referenceDate.value);
  } catch (error) {
    ElMessage.error(help_describeError(error, "读取图片库失败"));
  }
}

// 将选中的官方图片写入当前片段的首帧或尾帧。
function selectReference(reference) {
  activeSegment.value[
    picker.value.target === "first" ? "firstFrame" : "lastFrame"
  ] = reference.url;
  picker.value.open = false;
}

// 清除当前片段的可选尾帧。
function clearLastFrame() {
  activeSegment.value.lastFrame = "";
}

// 拼接准守条款和剧情描述，生成视频接口的 prompt。
function buildPrompt(segment) {
  const rules = segment.obey.map((item) => item.trim()).filter(Boolean);
  const ruleText = rules
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
  return `必须准守:\n${ruleText}\n剧情:\n${segment.plot.trim()}`;
}

// 拼接禁止条款，生成视频接口的 negative_prompt。
function buildNegativePrompt(segment) {
  return segment.forbidden
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

// 校验当前片段并直接创建 Agnes 视频任务。
async function generateSegment() {
  const segment = activeSegment.value;
  if (selectedSegment.value > 0 && !segment.firstFrame)
    return ElMessage.warning("请先完成上一段视频以自动衔接首帧");
  if (!segment.plot.trim()) return ElMessage.warning("剧情描述不能为空");
  if (segment.duration < 0 || segment.duration > 18)
    return ElMessage.warning("片段时长必须是 0 到 18 秒");
  generating.value = true;
  progress.value = 0;
  progressLabel.value = `第 ${selectedSegment.value + 1} 段准备中`;
  abortController.value = new AbortController();
  const shouldResume =
    segment.status === "generating" && Boolean(segment.taskID);
  segment.status = "generating";
  session.value.status = "in_progress";
  try {
    // 在创建远程任务前保存制作中状态，列表和重启后都能恢复现场。
    await persistSession();
    await writeVideoLog("video.generation.started", {
      segmentID: segment.id,
      segmentIndex: selectedSegment.value,
      ratio: session.value.ratio,
      duration: Number(segment.duration),
      numFrames: help_durationToFrames(Number(segment.duration)),
      ...(segment.firstFrame
        ? { mode: segment.lastFrame ? "keyframes" : "ti2vid" }
        : {}),
      hasFirstFrame: Boolean(segment.firstFrame),
      hasLastFrame: Boolean(segment.lastFrame),
      prompt: buildPrompt(segment),
      negativePrompt: buildNegativePrompt(segment),
    });
    let task;
    if (shouldResume) {
      task = { video_id: segment.taskID };
      await writeVideoLog("video.task.resumed", {
        segmentID: segment.id,
        taskID: segment.taskID,
      });
    } else {
      task = await createAgnesVideo(
        {
          ratio: session.value.ratio,
          prompt: buildPrompt(segment),
          negativePrompt: buildNegativePrompt(segment),
          firstFrame: segment.firstFrame,
          lastFrame: segment.lastFrame,
          numFrames: help_durationToFrames(Number(segment.duration)),
        },
        context.value,
        abortController.value.signal,
        (retryCount, delay) => {
          progressLabel.value =
            `视频服务繁忙，第 ${retryCount} 次重试，` +
            `${Math.ceil(delay / 1000)} 秒后继续`;
        },
      );
      segment.taskID = task.video_id || task.id || task.task_id;
      await writeVideoLog("video.task.created", {
        segmentID: segment.id,
        taskID: segment.taskID,
        response: task,
      });
      // 任务 ID 保存成功后，即使窗口关闭也能继续查询同一个任务。
      await persistSession();
    }
    const result = await waitForAgnesVideo(
      task,
      context.value,
      abortController.value.signal,
      (value, status) => {
        progress.value = value;
        segment.progress = value;
        progressLabel.value = `第 ${selectedSegment.value + 1} 段 ${status} ${value}%`;
      },
      (event, payload) =>
        writeVideoLog(event, {
          ...payload,
          segmentID: segment.id,
          taskID: segment.taskID,
        }),
    );
    await writeVideoLog("video.task.completed", {
      segmentID: segment.id,
      taskID: segment.taskID,
      response: result,
    });
    const remoteURL = result.metadata?.url || result.url;
    await writeVideoLog("video.result.url.resolved", {
      segmentID: segment.id,
      taskID: segment.taskID,
      source: result.metadata?.url ? "metadata.url" : "url",
      remoteURL: remoteURL || "",
    });
    if (!remoteURL) throw new Error("视频任务完成但没有返回视频地址");
    const saved = await saveRemoteVideoFile(
      session.value,
      `segments/${segment.id}.mp4`,
      remoteURL,
    );
    await writeVideoLog("video.file.downloaded", {
      segmentID: segment.id,
      taskID: segment.taskID,
      via: "go-http-api",
      size: saved.size || 0,
      remoteURL,
    });
    segment.videoPath = saved.path;
    segment.status = "completed";
    segment.progress = 100;
    progress.value = 100;
    progressLabel.value = `第 ${selectedSegment.value + 1} 段已完成`;
    await publishContinuityFrame(segment);
    await writeVideoLog("video.segment.completed", {
      segmentID: segment.id,
      videoPath: segment.videoPath,
      extractedFrame: Boolean(segment.extractedFrame),
    });
    await persistSession();
    await refreshSessions();
    ElMessage.success("视频片段制作完成");
  } catch (error) {
    segment.status = "failed";
    progressLabel.value = help_describeError(error, "视频生成失败");
    ElMessage.error(progressLabel.value);
    await writeVideoLog("video.generation.failed", {
      segmentID: segment.id,
      taskID: segment.taskID || "",
      error: help_describeError(error, "视频生成失败"),
      stack: error?.stack || "",
    });
    await persistSession();
  } finally {
    generating.value = false;
    abortController.value = null;
  }
}

// 提取当前片段尾帧并通过图片模型生成下一段公网参考图。
async function publishContinuityFrame(segment) {
  await writeVideoLog("video.last_frame.extract.started", {
    segmentID: segment.id,
    videoPath: segment.videoPath,
  });
  const frame = await help_extractLastFrame(sessionMediaURL(segment.videoPath));
  await writeVideoLog("video.last_frame.extract.completed", {
    segmentID: segment.id,
    mimeType: frame.type,
    size: frame.size,
  });
  segment.extractedFrame = await publishFrame(
    await help_blobToDataURL(frame),
    context.value,
    abortController.value.signal,
  );
  await writeVideoLog("video.last_frame.publish.completed", {
    segmentID: segment.id,
    publicURL: segment.extractedFrame,
  });
}

// 取消正在轮询的视频任务。
function cancelGeneration() {
  abortController.value?.abort();
}

// 保存当前 Session，支持应用重启后继续制作。
async function persistSession() {
  if (!session.value) return;
  session.value.updatedAt = new Date().toISOString();
  await saveVideoSession(session.value);
}

// 准备指定片段的视频地址，让用户通过播放器按钮主动开始播放。
function preparePreview(index) {
  tab.value = "video";
  videoPlayer.value?.pause();
  secondaryVideoPlayer.value?.pause();
  playbackIndex.value = index;
  activePlayerSlot.value = 0;
  playerSlots.value = [
    videoURLs.value[index] || "",
    videoURLs.value[index + 1] || "",
  ];
  nextTick(() => {
    videoPlayer.value?.load();
  });
}

// 请求系统打开当前视频 Session 所在目录。
async function openVideoDirectory() {
  try {
    await openVideoSessionDirectory(session.value);
    ElMessage.success("已打开视频所在位置");
  } catch (error) {
    if (error?.name !== "AbortError")
      ElMessage.error(help_describeError(error, "打开视频所在位置失败"));
  }
}

// 选择指定片段并准备播放器。
function playFrom(index) {
  preparePreview(index);
}

// 等待播放器完成下一段视频的预加载。
function help_waitPlayerReady(player) {
  if (!player || player.readyState >= 3) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 10000);
    player.addEventListener(
      "canplay",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// 当前片段播放结束后使用已预加载的播放器切换到下一段。
async function playNext() {
  const nextIndex = playbackIndex.value + 1;
  if (nextIndex >= completedSegments.value.length) return;
  const nextSlot = activePlayerSlot.value === 0 ? 1 : 0;
  const nextPlayer =
    nextSlot === 0 ? videoPlayer.value : secondaryVideoPlayer.value;
  if (playerSlots.value[nextSlot] !== videoURLs.value[nextIndex]) {
    playerSlots.value[nextSlot] = videoURLs.value[nextIndex] || "";
    await nextTick();
    nextPlayer?.load();
  }
  await help_waitPlayerReady(nextPlayer);
  nextPlayer?.play().catch(() => {});
  const oldPlayer =
    activePlayerSlot.value === 0
      ? videoPlayer.value
      : secondaryVideoPlayer.value;
  oldPlayer?.pause();
  activePlayerSlot.value = nextSlot;
  playbackIndex.value = nextIndex;
  const afterNextIndex = nextIndex + 1;
  const oldSlot = nextSlot === 0 ? 1 : 0;
  playerSlots.value[oldSlot] = videoURLs.value[afterNextIndex] || "";
  await nextTick();
  const preloadPlayer =
    oldSlot === 0 ? videoPlayer.value : secondaryVideoPlayer.value;
  preloadPlayer?.load();
}

// 在浏览器中用 mp4box 合成全部已完成片段。
async function mergeVideos() {
  if (!videoURLs.value.length) return;
  loading.value = true;
  try {
    await writeVideoLog("video.concat.started", {
      segmentCount: videoURLs.value.length,
      videoPaths: completedSegments.value.map((item) => item.videoPath),
    });
    const blob = await concatMp4Segments(videoURLs.value);
    await writeVideoLog("video.concat.completed", {
      segmentCount: videoURLs.value.length,
      size: blob.size,
      type: blob.type,
    });
    const saved = await saveVideoFile(session.value, "final.mp4", blob);
    session.value.finalVideoPath = saved.path;
    session.value.status = "completed";
    await persistSession();
    ElMessage.success("完整视频已合成");
  } catch (error) {
    await writeVideoLog("video.concat.failed", {
      segmentCount: videoURLs.value.length,
      error: help_describeError(error, "合成完整视频失败"),
      stack: error?.stack || "",
    });
    ElMessage.error(help_describeError(error, "合成完整视频失败"));
  } finally {
    loading.value = false;
  }
}

// 返回列表页并刷新 Session 状态。
async function backToList() {
  await persistSession();
  session.value = null;
  view.value = "list";
  await refreshSessions();
}
</script>

<template>
  <section class="video-panel" v-loading="loading">
    <header class="video-toolbar">
      <div>
        <h1>视频制作</h1>
        <span v-if="view === 'list'">分段制作 · 24 fps</span
        ><span v-else
          >{{ session.orientation }} · {{ session.ratio }} · 24 fps</span
        >
      </div>
      <div class="video-toolbar-actions">
        <el-button v-if="view === 'editor'" text @click="backToList"
          >返回列表</el-button
        ><el-button v-if="view === 'list'" type="primary" @click="openNewVideo"
          ><el-icon><Plus /></el-icon>制作新视频</el-button
        >
      </div>
    </header>
    <div v-if="view === 'list'" class="video-section video-list-section">
      <div v-if="!sessions.length" class="video-list-empty">
        <el-icon><Film /></el-icon>
        <h2>还没有视频</h2>
        <p>创建一个视频，从第一段开始制作。</p>
        <el-button type="primary" @click="openNewVideo"
          ><el-icon><Plus /></el-icon>制作新视频</el-button
        >
      </div>
      <div v-else class="video-list">
        <div
          v-for="item in sessions"
          :key="item.id"
          class="video-list-item"
          @click="openSession(item)"
        >
          <div class="video-list-icon">
            <el-icon><Film /></el-icon>
          </div>
          <div class="video-list-copy">
            <strong
              >{{
                item.orientation || (item.ratio === "16:9" ? "横屏" : "竖屏")
              }}
              视频</strong
            ><small
              >{{ item.ratio }} · {{ item.segments?.length || 0 }} 段 ·
              {{ item.status === "completed" ? "已完成" : "制作中" }} ·
              {{ help_formatSessionCreatedAt(item.createdAt) }}</small
            >
          </div>
          <el-button
            class="video-list-delete"
            text
            type="danger"
            title="删除视频"
            @click.stop="removeSession(item)"
            ><el-icon><Delete /></el-icon
          ></el-button>
        </div>
      </div>
    </div>
    <div v-else class="video-section editor-section">
      <el-tabs v-model="tab" class="video-tabs"
        ><el-tab-pane label="制作" name="edit"
          ><div class="segment-strip">
            <button
              v-for="(item, index) in session.segments"
              :key="item.id"
              type="button"
              :class="{ active: index === selectedSegment }"
              @click="selectedSegment = index"
            >
              第 {{ index + 1 }} 段
              <span>{{
                item.status === "completed" ? "已完成" : ""
              }}</span></button
            ><el-button text :disabled="generating" @click="addSegment"
              ><el-icon><Plus /></el-icon>添加下一段</el-button
            ><el-button
              v-if="session.segments.length > 1"
              text
              type="danger"
              :disabled="generating"
              @click="removeSegment(selectedSegment)"
              ><el-icon><Delete /></el-icon>删除当前段</el-button
            >
          </div>
          <div class="video-editor-grid">
            <main class="video-form segment-editor">
              <div class="segment-heading">
                <div>
                  <h2>第 {{ selectedSegment + 1 }} 段</h2>
                  <span>视频模型单次生成 · 最多 18 秒</span>
                </div>
                <el-tag
                  v-if="activeSegment.status === 'completed'"
                  type="success"
                  >已完成</el-tag
                >
              </div>
              <div class="video-form-row duration-row">
                <label
                  >片段时长
                  <el-input-number
                    v-model="activeSegment.duration"
                    :min="0"
                    :max="18"
                    :step="1"
                  /><span>秒</span></label
                ><small>填 0 时由视频模型决定时长</small>
              </div>
              <div class="rule-block">
                <div class="rule-title">
                  准守条款
                  <el-button text @click="addRule('obey')"
                    ><el-icon><Plus /></el-icon
                  ></el-button>
                </div>
                <div
                  v-for="(_, index) in activeSegment.obey"
                  :key="`obey-${index}`"
                  class="rule-row"
                >
                  <span>{{ index + 1 }}</span
                  ><el-input
                    v-model="activeSegment.obey[index]"
                    :placeholder="getRulePlaceholder('obey', index)"
                  /><el-button
                    class="rule-delete"
                    text
                    title="删除准守条款"
                    aria-label="删除准守条款"
                    @click="removeRule('obey', index)"
                    ><el-icon><Delete /></el-icon
                  ></el-button>
                </div>
              </div>
              <div class="rule-block">
                <div class="rule-title">
                  禁止条款
                  <el-button text @click="addRule('forbidden')"
                    ><el-icon><Plus /></el-icon
                  ></el-button>
                </div>
                <div
                  v-for="(_, index) in activeSegment.forbidden"
                  :key="`forbid-${index}`"
                  class="rule-row"
                >
                  <span>{{ index + 1 }}</span
                  ><el-input
                    v-model="activeSegment.forbidden[index]"
                    :placeholder="getRulePlaceholder('forbidden', index)"
                  /><el-button
                    class="rule-delete"
                    text
                    title="删除禁止条款"
                    aria-label="删除禁止条款"
                    @click="removeRule('forbidden', index)"
                    ><el-icon><Delete /></el-icon
                  ></el-button>
                </div>
              </div>
              <label class="plot-label">剧情描述 <span>必填</span></label
              ><el-input
                v-model="activeSegment.plot"
                type="textarea"
                :rows="7"
                placeholder="描述这一段发生的事情、动作、镜头和氛围"
              />
              <div class="frame-actions">
                <div>
                  <strong>首帧参考图</strong
                  ><small>{{
                    selectedSegment === 0
                      ? "可选，不选择则使用文生视频"
                      : "自动使用上一段尾帧"
                  }}</small>
                </div>
                <el-button
                  v-if="selectedSegment === 0"
                  @click="openPicker('first')"
                  >{{
                    activeSegment.firstFrame ? "更换图片" : "选择图片"
                  }}</el-button
                ><el-tag v-else type="success">已自动衔接</el-tag>
              </div>
              <div v-if="activeSegment.firstFrame" class="frame-preview">
                <img :src="activeSegment.firstFrame" alt="首帧参考图" /><span>{{
                  selectedSegment === 0 ? "官方网络图" : "上一段尾帧"
                }}</span>
              </div>
              <div class="frame-actions">
                <div>
                  <strong>尾帧参考图</strong
                  ><small>选择后使用 keyframes 模式，不选择则使用 ti2vid</small>
                </div>
                <el-button @click="openPicker('last')">{{
                  activeSegment.lastFrame ? "更换图片" : "选择图片"
                }}</el-button
                ><el-button
                  v-if="activeSegment.lastFrame"
                  text
                  @click="clearLastFrame"
                  >清除</el-button
                >
              </div>
              <div v-if="activeSegment.lastFrame" class="frame-preview">
                <img :src="activeSegment.lastFrame" alt="尾帧参考图" /><span
                  >官方网络图 · keyframes</span
                >
              </div>
              <div class="generate-row">
                <el-button v-if="generating" @click="cancelGeneration"
                  >取消生成</el-button
                ><el-button
                  type="primary"
                  :loading="generating"
                  :disabled="generating"
                  @click="generateSegment"
                  ><el-icon><VideoPlay /></el-icon
                  >{{
                    generating ? `生成中 ${progress}%` : "制作本段视频"
                  }}</el-button
                >
              </div>
            </main>
            <aside class="segment-status">
              <div class="status-label">制作进度</div>
              <el-progress
                type="circle"
                :percentage="
                  generating ? progress : activeSegment.progress || 0
                "
                :status="
                  activeSegment.status === 'failed' ? 'exception' : undefined
                "
              />
              <p>
                {{
                  progressLabel ||
                  (activeSegment.status === "completed"
                    ? "本段已完成"
                    : "等待开始")
                }}
              </p>
              <div v-if="activeSegment.extractedFrame" class="continuity-note">
                尾帧已准备好<br />添加下一段时自动使用
              </div>
            </aside>
          </div></el-tab-pane
        ><el-tab-pane label="视频" name="video"
          ><div class="preview-layout">
            <div v-if="!completedSegments.length" class="preview-empty-block">
              <el-icon><FolderOpened /></el-icon>
              <h2>还没有完成的视频片段</h2>
              <p>完成至少一段视频后，可以在这里连续播放。</p>
            </div>
            <template v-else
              ><div class="video-thumbnails">
                <button
                  v-for="(item, index) in completedSegments"
                  :key="item.id"
                  type="button"
                  class="video-thumbnail"
                  :class="{ active: playbackIndex === index }"
                  @click="playFrom(index)"
                >
                  <img
                    v-if="thumbnailURLs[index]"
                    :src="thumbnailURLs[index]"
                    alt="视频首帧"
                  />
                  <video
                    v-else
                    muted
                    preload="metadata"
                    :src="sessionMediaURL(item.videoPath)"
                  />
                  <span>第 {{ index + 1 }} 段</span>
                  <el-icon><VideoPlay /></el-icon>
                </button>
              </div>
              <div class="single-video-player">
                <div class="single-video-title">
                  <strong>第 {{ playbackIndex + 1 }} 段</strong>
                  <span>播放结束后自动切换下一段</span>
                </div>
                <div class="single-video-stage">
                  <video
                    ref="videoPlayer"
                    :class="{ active: activePlayerSlot === 0 }"
                    :controls="activePlayerSlot === 0"
                    :muted="activePlayerSlot !== 0"
                    preload="auto"
                    :poster="thumbnailURLs[playbackIndex] || undefined"
                    :src="playerSlots[0]"
                    playsinline
                    @ended="playNext"
                  />
                  <video
                    ref="secondaryVideoPlayer"
                    :class="{ active: activePlayerSlot === 1 }"
                    :controls="activePlayerSlot === 1"
                    :muted="activePlayerSlot !== 1"
                    preload="auto"
                    :poster="thumbnailURLs[playbackIndex] || undefined"
                    :src="playerSlots[1]"
                    playsinline
                    @ended="playNext"
                  />
                </div>
              </div>
              <div class="final-video-actions">
                <el-button
                  type="primary"
                  :loading="loading"
                  @click="mergeVideos"
                  >合成完整视频</el-button
                ><a
                  v-if="session.finalVideoPath"
                  :href="sessionMediaURL(session.finalVideoPath)"
                  target="_blank"
                  >打开完整视频</a
                >
              </div>
              <div class="video-export-panel">
                <div class="single-video-title">
                  <strong>视频文件</strong>
                  <span>打开当前 Session 的本地文件夹</span>
                </div>
                <el-button
                  type="primary"
                  @click="openVideoDirectory"
                >
                  <el-icon><FolderOpened /></el-icon>打开视频所在位置
                </el-button>
              </div>
              <div v-if="finalVideoURL" class="final-video-player">
                <div class="single-video-title">
                  <strong>完整视频</strong><span>已在浏览器中合成</span>
                </div>
                <video
                  controls
                  preload="metadata"
                  playsinline
                  :src="finalVideoURL"
                />
              </div>
            </template></div></el-tab-pane
      ></el-tabs>
    </div>
    <el-dialog v-model="newVideo.open" title="制作新视频" width="420px"
      ><p class="dialog-hint">该配置只在新建时设置，之后不能修改。</p>
      <el-radio-group v-model="newVideo.ratio"
        ><el-radio-button label="16:9">横屏 16:9</el-radio-button
        ><el-radio-button label="9:16"
          >竖屏 9:16</el-radio-button
        ></el-radio-group
      ><template #footer
        ><el-button @click="newVideo.open = false">取消</el-button
        ><el-button type="primary" :loading="loading" @click="createNewVideo"
          >开始制作</el-button
        ></template
      ></el-dialog
    >
    <el-dialog v-model="picker.open" title="选择官方网络图" width="760px"
      ><div class="picker-toolbar">
        <span>仅显示 Agnes 生成的公网图片，本地图片不会用于视频参考帧。</span
        ><el-date-picker
          v-model="referenceDate"
          type="date"
          value-format="YYYYMMDD"
          :clearable="false"
          @change="refreshReferences"
        />
      </div>
      <div v-if="!references.length" class="reference-empty">
        <el-icon><FolderOpened /></el-icon>
        <p>这一天没有官方网络图</p>
      </div>
      <div v-else class="picker-grid">
        <button
          v-for="item in references"
          :key="item.path"
          type="button"
          class="picker-item"
          @click="selectReference(item)"
        >
          <img :src="item.url" alt="官方生成图片" /><span
            >图片 #{{ item.number || "-" }}</span
          >
        </button>
      </div></el-dialog
    >
  </section>
</template>
