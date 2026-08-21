<script setup>
import {computed, onMounted, onUnmounted, ref} from 'vue';
import {ElMessage} from 'element-plus';
import {ArrowLeft, ArrowRight, Delete, Download, FolderOpened, Picture, Upload, ZoomIn} from '@element-plus/icons-vue';
import {Agent, OpenAIProvider, Runner, setOpenAIAPI, tool} from '@openai/agents';
import OpenAI from 'openai';
import {z} from 'zod';
import {callAgnesImageTool, deleteReference, listReferences, loadImageToolContext, saveReference, saveImageResult} from './api';
import {llmStore} from '../store/llm';

const prompt = ref('');
const date = ref(new Date().toISOString().slice(0, 10).replaceAll('-', ''));
const references = ref([]);
const selected = ref([]);
const size = ref('1K');
const ratio = ref('3:4');
const loading = ref(false);
const elapsedSeconds = ref(0);
const fileInput = ref(null);
const previewFile = ref(null);
const previewVisible = ref(false);
const today = computed(() => date.value === new Date().toISOString().slice(0, 10).replaceAll('-', ''));
let timer = null;

// 创建图片制作 Agent，让模型根据用户描述驱动图片工具。
function createImageAgent(context, signal, generated, requestedSize, requestedRatio) {
    const imageTool = tool({
        name: 'generate_image',
        description: '调用 Agnes Image 2.1 Flash 生成图片。用户需要制作图片时必须调用此工具。',
        parameters: z.object({prompt: z.string(), references: z.array(z.string()).default([])}),
        execute: async input => {
            const imageURL = await callAgnesImageTool({...input, size: requestedSize, ratio: requestedRatio}, context, signal);
            generated.value = await saveImageResult(imageURL);
            return JSON.stringify({url: generated.value.url, path: generated.value.path});
        },
    });
    setOpenAIAPI('chat_completions');
    const openAIClient = new OpenAI({apiKey: context.settings.apiKey, baseURL: context.settings.baseURL, dangerouslyAllowBrowser: true});
    const client = new OpenAIProvider({openAIClient, useResponses: false});
    const agent = new Agent({name: 'hvv 图片制作 Agent', model: context.settings.model, instructions: '你是图片制作 Agent。每次收到图片制作请求都必须调用 generate_image 工具，不能只回复文字。工具返回后只需简短确认。', tools: [imageTool]});
    return {agent, runner: new Runner({modelProvider: client, tracingDisabled: true, workflowName: 'hvv 图片制作'})};
}

// 读取日期对应的历史参考图片。
async function loadReferences() {
    try { references.value = await listReferences(date.value); }
    catch (error) { ElMessage.error(error.message); }
}

// 将文件读取为 Data URI 并保存到媒体目录。
function readFile(file) {
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try { const saved = await saveReference(reader.result, file.name); references.value.unshift(saved); selected.value.push(saved.path); ElMessage.success('参考图已加入'); }
        catch (error) { ElMessage.error(error.message); }
    };
    reader.readAsDataURL(file);
}

// 响应粘贴事件，将剪贴板截图保存为参考图。
function handlePaste(event) {
    const image = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
    if (image) { event.preventDefault(); readFile(image.getAsFile()); }
}

// 切换一张参考图的选中状态。
function toggleReference(file) {
    selected.value = selected.value.includes(file.path) ? selected.value.filter(path => path !== file.path) : [...selected.value, file.path];
}

// 打开图片原始比例预览窗口。
function previewReference(file) {
    previewFile.value = file;
    previewVisible.value = true;
}

// 切换到图片库中的上一张图片。
function previewPrevious() {
    if (!references.value.length) return;
    const index = references.value.findIndex(file => file.path === previewFile.value?.path);
    previewFile.value = references.value[(index - 1 + references.value.length) % references.value.length];
}

// 切换到图片库中的下一张图片。
function previewNext() {
    if (!references.value.length) return;
    const index = references.value.findIndex(file => file.path === previewFile.value?.path);
    previewFile.value = references.value[(index + 1) % references.value.length];
}

// 下载当前预览图片到本地下载目录。
async function downloadPreview() {
    if (!previewFile.value) return;
    const response = await fetch(previewFile.value.url);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = previewFile.value.path.split('/').pop();
    anchor.click();
    URL.revokeObjectURL(url);
}

// 删除图片库图片并同步移除当前选择状态。
async function removeReference(file) {
    try {
        await deleteReference(file.path);
        references.value = references.value.filter(item => item.path !== file.path);
        selected.value = selected.value.filter(path => path !== file.path);
        if (previewFile.value?.path === file.path) { previewFile.value = null; previewVisible.value = false; }
        ElMessage.success('图片已删除');
    } catch (error) { ElMessage.error(error.message); }
}

// 提交图片制作请求并展示本地结果。
async function generate() {
    if (!prompt.value.trim() || loading.value) return;
    if (!llmStore.state.apiKeyConfigured) { ElMessage.warning('请先配置 API Key'); return; }
    loading.value = true; elapsedSeconds.value = 0;
    const startedAt = Date.now();
    timer = window.setInterval(() => { elapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000); }, 1000);
    try {
        const context = {...await loadImageToolContext(), references: references.value};
        const generated = ref(null);
        const controller = new AbortController();
        const {agent, runner} = createImageAgent(context, controller.signal, generated, size.value, ratio.value);
        await runner.run(agent, `${prompt.value.trim()}\n参考图路径：${selected.value.join(', ') || '无'}`, {signal: controller.signal});
        date.value = new Date().toISOString().slice(0, 10).replaceAll('-', '');
        await loadReferences();
    }
    catch (error) { if (error.name !== 'AbortError') ElMessage.error(error.message); }
    finally { loading.value = false; if (timer) { window.clearInterval(timer); timer = null; } }
}

// 返回今天的参考图目录。
function useToday() { date.value = new Date().toISOString().slice(0, 10).replaceAll('-', ''); loadReferences(); }

onMounted(() => { loadReferences(); window.addEventListener('paste', handlePaste); });
onUnmounted(() => { window.removeEventListener('paste', handlePaste); if (timer) window.clearInterval(timer); });
</script>

<template>
  <section class="image-panel">
    <header class="image-toolbar"><div><h1>图片制作</h1><span>Agnes Image 2.1 Flash · 支持文生图与多图合成</span></div><el-button text @click="useToday">今天</el-button></header>
    <div class="image-layout">
      <main class="image-editor">
        <div class="field-label">描述</div>
        <el-input v-model="prompt" type="textarea" :rows="11" resize="none" placeholder="万里长城，天空下着雨，奥特曼和孙悟空在打架……" />
        <div class="image-options"><label>尺寸 <el-select v-model="size"><el-option v-for="item in ['1K', '2K', '3K', '4K']" :key="item" :label="item" :value="item" /></el-select></label><label>比例 <el-select v-model="ratio"><el-option v-for="item in ['3:4', '4:3', '16:9', '9:16', '1:1', '21:9']" :key="item" :label="item" :value="item" /></el-select></label></div>
        <div class="reference-heading"><span>参考图 <small>{{ selected.length }} 张已选</small></span><el-button text @click="fileInput.click()"><el-icon><Upload /></el-icon>导入图片</el-button><input ref="fileInput" hidden type="file" accept="image/*" @change="readFile($event.target.files[0])" /></div>
        <p class="paste-hint">可直接 Ctrl/Command + V 粘贴截图，参考图不是必填项。</p>
        <el-button class="generate-button" type="primary" :loading="loading" :disabled="!prompt.trim()" @click="generate"><el-icon><Picture /></el-icon>{{ loading ? `正在生成 (${elapsedSeconds}秒)` : '开始制作' }}</el-button>
      </main>
      <aside class="reference-panel"><div class="reference-date"><span>图片库</span><el-date-picker v-model="date" value-format="YYYYMMDD" type="date" :clearable="false" @change="loadReferences" /></div><div v-if="!references.length" class="reference-empty"><el-icon><FolderOpened /></el-icon><p>{{ today ? '今天还没有图片' : '这一天没有图片' }}</p></div><div v-else class="reference-grid"><button v-for="file in references" :key="file.path" class="reference-item" :class="{selected: selected.includes(file.path)}" type="button" @click="toggleReference(file)"><img :src="file.url" alt="图片库图片" /><span v-if="file.number" class="image-number">#{{ file.number }}</span><span v-if="selected.includes(file.path)" class="selection-mark">已选</span><i class="preview-button" title="查看原图" aria-label="查看原图" @click.stop="previewReference(file)"><el-icon><ZoomIn /></el-icon></i><i class="delete-button" title="删除图片" aria-label="删除图片" @click.stop="removeReference(file)"><el-icon><Delete /></el-icon></i></button></div></aside>
    </div>
    <el-dialog v-model="previewVisible" class="image-preview-dialog" width="96vw" top="2vh" :show-close="true"><div class="preview-stage"><button class="preview-nav preview-prev" type="button" title="上一张" aria-label="上一张" @click="previewPrevious"><el-icon><ArrowLeft /></el-icon></button><img v-if="previewFile" class="original-preview" :src="previewFile.url" alt="原图预览" /><div class="preview-actions"><button type="button" title="下载图片" aria-label="下载图片" @click="downloadPreview"><el-icon><Download /></el-icon></button><button type="button" title="删除图片" aria-label="删除图片" @click="removeReference(previewFile)"><el-icon><Delete /></el-icon></button></div><button class="preview-nav preview-next" type="button" title="下一张" aria-label="下一张" @click="previewNext"><el-icon><ArrowRight /></el-icon></button></div></el-dialog>
  </section>
</template>
