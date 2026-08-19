<script setup>
import {ref} from 'vue';
import {ChatDotRound, Picture, Setting, VideoCamera} from '@element-plus/icons-vue';
import ChatPanel from './chat/ChatPanel.vue';
import SettingsPanel from './config/SettingsPanel.vue';
import ImagePanel from './image/ImagePanel.vue';
import VideoPanel from './video/view/VideoPanel.vue';
import {llmStore} from './store/llm';

const activeView = ref('chat');
</script>

<template>
  <el-container class="shell" v-loading="llmStore.state.loading">
    <el-aside class="sidebar" width="220px">
      <div class="brand">hvv <span>agent workspace</span></div>
      <nav class="feature-nav" aria-label="功能导航">
        <button class="nav-item" :class="{active: activeView === 'chat'}" type="button" @click="activeView = 'chat'">
          <el-icon><ChatDotRound /></el-icon><span>聊天</span>
        </button>
        <button class="nav-item" :class="{active: activeView === 'image'}" type="button" @click="activeView = 'image'">
          <el-icon><Picture /></el-icon><span>图片</span>
        </button>
        <button class="nav-item" :class="{active: activeView === 'video'}" type="button" @click="activeView = 'video'">
          <el-icon><VideoCamera /></el-icon><span>视频</span>
        </button>
      </nav>
      <button class="settings-entry" :class="{active: activeView === 'settings'}" type="button" @click="activeView = 'settings'">
        <el-icon><Setting /></el-icon><span>设置</span>
      </button>
    </el-aside>
    <el-main class="workspace">
      <div v-if="activeView === 'chat'" class="content-area">
        <ChatPanel />
      </div>
      <div v-else-if="activeView === 'settings'" class="content-area settings-area">
        <SettingsPanel />
      </div>
      <div v-else-if="activeView === 'image'" class="content-area image-area">
        <ImagePanel />
      </div>
      <div v-else-if="activeView === 'video'" class="content-area video-area">
        <VideoPanel />
      </div>
      <div v-else class="content-area module-placeholder">
        <el-icon><Picture v-if="activeView === 'image'" /><VideoCamera v-else /></el-icon>
        <h2>{{ activeView === 'image' ? '图片' : '视频' }}</h2>
        <p>功能模块即将开放</p>
      </div>
    </el-main>
  </el-container>
</template>
