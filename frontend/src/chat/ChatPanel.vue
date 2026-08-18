<script setup>
import {nextTick, ref} from 'vue';
import {ElMessage} from 'element-plus';
import {ArrowUp, Plus, VideoPause} from '@element-plus/icons-vue';
import {completeChat} from './api';
import {llmStore} from '../store/llm';

const messages = ref([]);
const input = ref('');
const sending = ref(false);
const transcript = ref(null);
let activeController = null;

// 清空当前会话内容，开始一轮新的对话。
function createNewSession() {
    if (sending.value) return;
    messages.value = [];
    input.value = '';
}

// 将聊天记录滚动到最新消息位置。
async function scrollToBottom() {
    await nextTick();
    if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight;
}

// 处理输入框快捷键，普通回车换行，Ctrl/Command 加回车发送消息。
function handleInputKeydown(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    send();
}

// 停止当前正在执行的聊天请求。
function stop() {
    activeController?.abort();
}

// 校验并发送当前输入框中的消息。
async function send() {
    const content = input.value.trim();
    if (!content || sending.value) return;
    if (!llmStore.state.apiKeyConfigured) {
        ElMessage.warning('请先配置 API Key');
        return;
    }

    messages.value.push({role: 'user', content});
    input.value = '';
    sending.value = true;
    activeController = new AbortController();
    await scrollToBottom();
    try {
        const reply = await completeChat(messages.value, activeController.signal);
        messages.value.push({role: 'assistant', content: reply});
        await scrollToBottom();
    } catch (error) {
        if (error?.name === 'AbortError') return;
        ElMessage.error(error?.message || '聊天请求失败');
    } finally {
        sending.value = false;
        activeController = null;
    }
}
</script>

<template>
  <section class="chat-panel">
    <header class="chat-toolbar">
      <div>
        <h1>聊天</h1>
        <span>Agnes assistant</span>
      </div>
      <el-button class="new-session" text :disabled="sending" @click="createNewSession">
        <el-icon><Plus /></el-icon>
        <span>新建会话</span>
      </el-button>
    </header>
    <div ref="transcript" class="transcript">
      <div v-if="!messages.length" class="empty-state">
        <h2>开始聊天</h2>
        <p>向 Agnes 发送消息，回答会显示在这里。</p>
      </div>
      <article v-for="(message, index) in messages" :key="index" class="message" :class="message.role">
        <div class="message-role">{{ message.role === 'user' ? '你' : 'Agnes' }}</div>
        <div class="message-content">{{ message.content }}</div>
      </article>
      <div v-if="sending" class="message assistant pending">正在思考...</div>
    </div>
    <div class="composer">
      <el-input
        v-model="input"
        type="textarea"
        :autosize="{minRows: 1}"
        resize="none"
        :disabled="sending"
        placeholder="输入消息..."
        @keydown.enter="handleInputKeydown"
      />
      <el-button
        class="send-button"
        :class="{ 'stop-button': sending }"
        type="primary"
        :disabled="!sending && !input.trim()"
        :title="sending ? '停止生成' : '发送消息'"
        :aria-label="sending ? '停止生成' : '发送消息'"
        @click="sending ? stop() : send()"
      >
        <el-icon><VideoPause v-if="sending" /><ArrowUp v-else /></el-icon>
      </el-button>
    </div>
  </section>
</template>
