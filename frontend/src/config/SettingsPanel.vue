<script setup>
import {ref} from 'vue';
import {ElMessage} from 'element-plus';
import {llmStore} from '../store/llm';

const apiKey = ref(llmStore.state.apiKey);
const saving = ref(false);

async function save() {
    if (!apiKey.value.trim()) {
        ElMessage.warning('请输入 API Key');
        return;
    }
    saving.value = true;
    try {
        const savedKey = apiKey.value.trim();
        await llmStore.saveAPIKey(savedKey);
        ElMessage.success('API Key 已保存');
    } catch (error) {
        ElMessage.error(error?.message || '保存失败');
    } finally {
        saving.value = false;
    }
}
</script>

<template>
  <el-card class="settings-card" shadow="never">
    <template #header>
      <div class="panel-title">连接设置</div>
    </template>
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item label="API Key">
        <el-input v-model="apiKey" type="password" show-password placeholder="输入 Agnes API Key" />
      </el-form-item>
      <div class="readonly-field">
        <span>服务地址</span>
        <code>{{ llmStore.state.baseURL }}</code>
      </div>
      <div class="readonly-field">
        <span>聊天模型</span>
        <code>{{ llmStore.state.model }}</code>
      </div>
      <el-button type="primary" :loading="saving" @click="save">保存 API Key</el-button>
      <span v-if="llmStore.state.apiKeyConfigured" class="configured">已配置</span>
    </el-form>
  </el-card>
</template>
