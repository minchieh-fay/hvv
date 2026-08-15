<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ExportProject, GenerateAudio, GenerateImage, GenerateProject, GenerateVideo, GetMediaData, GetProject, GetSettings, NewProject, PlanStory, SaveProject, SaveSettings } from '../wailsjs/go/main/App'

const project = ref({ name: '未命名项目', format: '9:16', duration: 30, story: '', characters: [], locations: [], scenes: [] })
const settings = ref({ apiKey: '', domain: 'cn' })
const activeScene = ref(0)
const panel = ref('story')
const planning = ref(false)
const saved = ref(false)
const message = ref('')
const showSettings = ref(false)
const generating = ref(false)
const previewData = ref('')
const newCharacter = ref({ name: '', description: '' })
const newLocation = ref({ name: '', description: '' })

const currentScene = computed(() => project.value.scenes?.[activeScene.value] || null)
const totalSceneDuration = computed(() => (project.value.scenes || []).reduce((sum, scene) => sum + Number(scene.duration || 0), 0))
const progress = computed(() => project.value.scenes?.length ? Math.round(((activeScene.value + 1) / project.value.scenes.length) * 100) : 0)

onMounted(async () => {
  try {
    const loaded = await GetProject()
    if (loaded) project.value = { ...project.value, ...loaded }
    const loadedSettings = await GetSettings()
    if (loadedSettings) settings.value = loadedSettings
  } catch (error) {
    message.value = '初始化失败：' + error
  }
})

watch(project, async () => {
  saved.value = false
}, { deep: true })

async function saveProject() {
  try {
    await SaveProject(project.value)
    saved.value = true
    message.value = '项目已保存'
    setTimeout(() => { message.value = '' }, 2200)
  } catch (error) { message.value = '保存失败：' + error }
}

async function newProject() {
  if (project.value.story || project.value.scenes?.length || project.value.characters?.length || project.value.locations?.length) {
    if (!window.confirm('确定新建会话吗？当前编辑内容会被清空，已生成的媒体文件仍会保留在本机。')) return
  }
  try {
    project.value = await NewProject()
    activeScene.value = 0
    panel.value = 'story'
    previewData.value = ''
    saved.value = true
    message.value = '已新建会话'
  } catch (error) { message.value = '新建失败：' + error }
}

async function planStory() {
  if (!project.value.story.trim()) {
    message.value = '请先写下一个故事或创意'
    return
  }
  planning.value = true
  message.value = ''
  try {
    project.value = await PlanStory({ story: project.value.story, project: project.value, characters: project.value.characters, locations: project.value.locations })
    activeScene.value = 0
    panel.value = 'scenes'
    await saveProject()
  } catch (error) {
    message.value = String(error).replace(/^Error:\s*/, '')
  } finally { planning.value = false }
}

async function saveSettings() {
  try {
    await SaveSettings(settings.value)
    showSettings.value = false
    message.value = '设置已保存'
  } catch (error) { message.value = '设置保存失败：' + error }
}

async function loadPreview(scene = currentScene.value) {
  previewData.value = ''
  if (!scene) return
  const path = scene.videoPath || scene.imagePath
  if (!path) return
  try { previewData.value = await GetMediaData(path) } catch (error) { message.value = '预览加载失败：' + error }
}

async function generateSceneMedia() {
  if (!currentScene.value) return
  generating.value = true
  try {
    project.value = await GenerateImage(project.value, activeScene.value)
    project.value = await GenerateVideo(project.value, activeScene.value)
    await loadPreview()
    message.value = '当前场景生成完成'
  } catch (error) { message.value = String(error).replace(/^Error:\s*/, '') }
  finally { generating.value = false }
}

async function generateProjectMedia() {
  if (!project.value.scenes?.length) { message.value = '请先分析故事并生成场景'; return }
  generating.value = true
  message.value = '正在生成图片、视频、配音和字幕，请耐心等待...'
  try {
    project.value = await GenerateProject(project.value)
    await loadPreview(project.value.scenes?.[activeScene.value])
    message.value = '完整视频已导出'
  } catch (error) { message.value = String(error).replace(/^Error:\s*/, '') }
  finally { generating.value = false }
}

async function generateAudioOnly() {
  generating.value = true
  try { project.value = await GenerateAudio(project.value); message.value = '配音和字幕已生成' }
  catch (error) { message.value = String(error).replace(/^Error:\s*/, '') }
  finally { generating.value = false }
}

async function exportProject() {
  generating.value = true
  try { project.value = await ExportProject(project.value); message.value = '最终视频已导出' }
  catch (error) { message.value = String(error).replace(/^Error:\s*/, '') }
  finally { generating.value = false }
}

function addCharacter() {
  if (!newCharacter.value.name.trim()) return
  project.value.characters.push({ id: crypto.randomUUID(), ...newCharacter.value, voice: '默认女声' })
  newCharacter.value = { name: '', description: '' }
}

function addLocation() {
  if (!newLocation.value.name.trim()) return
  project.value.locations.push({ id: crypto.randomUUID(), ...newLocation.value })
  newLocation.value = { name: '', description: '' }
}

function removeItem(list, index) { list.splice(index, 1) }
function setScene(index) { activeScene.value = index; panel.value = 'scenes'; loadPreview(project.value.scenes[index]) }
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">hv</div><div><strong>HVV</strong><span>AI video workshop</span></div></div>
      <div class="top-actions">
        <span v-if="message" class="toast">{{ message }}</span>
        <button class="button ghost" @click="newProject">＋ 新建会话</button>
        <button class="button ghost" @click="showSettings = true">设置</button>
        <button class="button primary" @click="saveProject">{{ saved ? '已保存' : '保存项目' }}</button>
      </div>
    </header>

    <section class="workspace">
      <aside class="sidebar left-panel">
        <div class="eyebrow">PROJECT</div>
        <input v-model="project.name" class="project-name" aria-label="项目名称" />
        <div class="format-row">
          <button :class="['format-option', { selected: project.format === '16:9' }]" @click="project.format = '16:9'"><b>16:9</b><span>横屏</span></button>
          <button :class="['format-option', { selected: project.format === '9:16' }]" @click="project.format = '9:16'"><b>9:16</b><span>竖屏</span></button>
        </div>
        <label class="field-label">目标时长 <span>秒</span></label>
        <input v-model.number="project.duration" class="text-input" type="number" min="5" max="500" />

        <div class="side-tabs">
          <button :class="{ active: panel === 'story' }" @click="panel = 'story'">创意</button>
          <button :class="{ active: panel === 'scenes' }" @click="panel = 'scenes'">场景 <i>{{ project.scenes?.length || 0 }}</i></button>
        </div>

        <div class="scene-mini-list">
          <button v-for="(scene, index) in project.scenes" :key="scene.id" :class="['scene-mini', { active: index === activeScene }]" @click="setScene(index)">
            <span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ scene.title || '未命名场景' }}</strong><em>{{ scene.duration }}s</em>
          </button>
          <div v-if="!project.scenes?.length" class="empty-small">故事分析后，场景会出现在这里</div>
        </div>
      </aside>

      <section class="main-panel">
        <div v-if="panel === 'story'" class="story-view">
          <div class="section-heading"><div><div class="eyebrow">01 / IDEA</div><h1>把一个想法，变成一组可编辑的镜头。</h1><p>先写故事，HVV 会把它拆成适合 Agnes 生成的短场景。</p></div><div class="status-chip"><span class="status-dot"></span>本地工作区</div></div>
          <textarea v-model="project.story" class="story-input" placeholder="例如：一个女孩在暴雨夜寻找走失的小狗，最后在车站找到了它。故事温暖，适合竖屏短视频。"></textarea>
          <div class="prompt-hints"><span>建议写清楚</span><button @click="project.story = '一个在暴雨夜寻找走失小狗的女孩，途中遇到一位撑红伞的老人，最后在车站找到了小狗。故事温暖，适合竖屏短视频。'">人物与目标</button><button @click="project.story += ' 画面风格：电影感，暖色，节奏舒缓。'">画面风格</button><button @click="project.story += ' 结尾停留在一个稳定、温暖的画面。'">结尾状态</button></div>
          <div class="action-row"><button class="button primary large" :disabled="planning || generating" @click="planStory"><span v-if="planning" class="spinner"></span>{{ planning ? '正在分析故事...' : '分析故事并生成场景' }}</button><button v-if="project.scenes?.length" class="button ghost large" :disabled="generating" @click="generateProjectMedia"><span v-if="generating" class="spinner"></span>生成完整视频</button><span class="action-note">无 API Key 时使用演示分镜，可先体验界面</span></div>

          <div class="lower-grid"><div class="info-block"><div class="eyebrow">HOW IT WORKS</div><h3>先确认，再生成</h3><p>HVV 不会直接把一整段文字丢给视频模型。它会先生成场景卡片，你可以逐个修改、预览和重做。</p></div><div class="info-block"><div class="eyebrow">CURRENT PLAN</div><h3>{{ project.scenes?.length || 0 }} 个场景 · {{ totalSceneDuration }} 秒</h3><p>目标格式 {{ project.format }}。每个场景会独立生成，最后再合成配音和字幕。</p></div></div>
        </div>

        <div v-else class="scenes-view">
          <div class="section-heading compact"><div><div class="eyebrow">02 / SCENES</div><h2>场景工作台</h2><p>每一张卡片都是一个可以单独重做的短视频片段。</p></div><div class="progress-ring"><strong>{{ progress }}%</strong><span>检查进度</span></div></div>
          <div v-if="currentScene" class="scene-editor">
            <div class="scene-title-row"><div><span class="scene-index">SCENE {{ String(activeScene + 1).padStart(2, '0') }}</span><input v-model="currentScene.title" class="scene-title-input" /></div><span class="draft-badge">草稿</span></div>
            <div class="scene-fields"><label>场景时长<input v-model.number="currentScene.duration" type="number" min="5" max="20" /> 秒</label><label>发生地点<input v-model="currentScene.location" placeholder="例如：学校广场" /></label></div>
            <label class="field-label">动作和画面</label><textarea v-model="currentScene.description" class="scene-textarea" placeholder="写清楚这一段发生什么，以及结束时人物是什么状态"></textarea>
            <label class="field-label">视频提示词 <small>可以直接修改</small></label><textarea v-model="currentScene.prompt" class="scene-textarea prompt-area"></textarea>
            <div class="scene-footer"><button class="button ghost" :disabled="generating" @click="generateSceneMedia"><span v-if="generating" class="spinner"></span>生成本场景</button><button class="button ghost" :disabled="generating" @click="generateAudioOnly">配音和字幕</button><button class="button primary" :disabled="generating" @click="exportProject">导出 MP4</button></div>
          </div>
          <div v-else class="empty-state"><div class="empty-icon">✦</div><h3>还没有场景</h3><p>先回到“创意”，输入故事并分析。</p><button class="button primary" @click="panel = 'story'">返回创意</button></div>
        </div>
      </section>

      <aside class="sidebar right-panel">
        <div class="preview-header"><div><div class="eyebrow">PREVIEW</div><h3>项目预览</h3></div><span class="format-tag">{{ project.format }}</span></div>
        <div :class="['preview-frame', project.format === '16:9' ? 'landscape' : 'portrait']"><img v-if="previewData && currentScene?.imagePath && !currentScene?.videoPath" :src="previewData" class="media-preview" /><video v-else-if="previewData && currentScene?.videoPath" :src="previewData" class="media-preview" controls></video><div v-else class="preview-grid"></div><div v-if="!previewData" class="preview-copy"><span>{{ currentScene ? 'SCENE ' + String(activeScene + 1).padStart(2, '0') : 'HVV WORKSPACE' }}</span><strong>{{ currentScene ? currentScene.title : '你的故事\n从这里开始' }}</strong><small>{{ currentScene ? '视频片段尚未生成' : '先输入一个创意' }}</small></div><button v-if="!previewData" class="play-button" title="预览">▶</button></div>
        <div class="preview-meta"><div><span>状态</span><strong>{{ project.finalPath ? '已导出' : project.scenes?.length ? '待生成' : '等待故事' }}</strong></div><div><span>场景</span><strong>{{ project.scenes?.length || 0 }}</strong></div><div><span>时长</span><strong>{{ totalSceneDuration }}s</strong></div></div>

        <div class="asset-section"><div class="asset-heading"><div><div class="eyebrow">CAST</div><h3>角色</h3></div><button class="icon-button" @click="newCharacter = { name: newCharacter.name, description: newCharacter.description }">+</button></div><div v-for="(character, index) in project.characters" :key="character.id" class="asset-item"><div class="avatar">{{ character.name?.slice(0, 1) }}</div><div><strong>{{ character.name }}</strong><small>{{ character.description || '还没有外观描述' }}</small></div><button class="remove-button" @click="removeItem(project.characters, index)">×</button></div><div class="add-asset"><input v-model="newCharacter.name" placeholder="角色名称" @keyup.enter="addCharacter" /><input v-model="newCharacter.description" placeholder="外观描述" @keyup.enter="addCharacter" /><button @click="addCharacter">添加角色</button></div></div>
        <div class="asset-section"><div class="asset-heading"><div><div class="eyebrow">LOCATIONS</div><h3>地点</h3></div></div><div v-for="(location, index) in project.locations" :key="location.id" class="asset-item"><div class="location-dot"></div><div><strong>{{ location.name }}</strong><small>{{ location.description || '还没有环境描述' }}</small></div><button class="remove-button" @click="removeItem(project.locations, index)">×</button></div><div class="add-asset"><input v-model="newLocation.name" placeholder="地点名称" @keyup.enter="addLocation" /><input v-model="newLocation.description" placeholder="环境描述" @keyup.enter="addLocation" /><button @click="addLocation">添加地点</button></div></div>
      </aside>
    </section>

    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false"><div class="modal"><div class="modal-heading"><div><div class="eyebrow">SETTINGS</div><h2>模型连接</h2></div><button class="close-button" @click="showSettings = false">×</button></div><p class="modal-desc">API Key 只保存在本机配置目录，用于调用 Agnes 的文本、图片和视频模型。</p><label class="field-label">API Key<input v-model="settings.apiKey" class="text-input" type="password" placeholder="sk-..." /></label><label class="field-label">站点<select v-model="settings.domain" class="text-input"><option value="cn">api.agnes-ai.cn</option><option value="com">api.agnes-ai.com</option></select></label><div class="modal-footer"><button class="button ghost" @click="showSettings = false">取消</button><button class="button primary" @click="saveSettings">保存设置</button></div></div></div>
  </main>
</template>
