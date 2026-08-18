import {reactive} from 'vue';

const state = reactive({
    apiKey: '',
    apiKeyConfigured: false,
    baseURL: '',
    model: '',
    loading: true,
});

// 从后端配置服务加载全局 LLM 配置。
async function load() {
    state.loading = true;
    try {
        const response = await fetch('/api/settings');
        if (!response.ok) throw new Error('读取 LLM 配置失败');
        Object.assign(state, await response.json());
    } finally {
        state.loading = false;
    }
}

// 保存 API Key，并立即更新全局 LLM 配置。
async function saveAPIKey(apiKey) {
    const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({apiKey}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '保存 API Key 失败');
    Object.assign(state, result);
}

export const llmStore = {state, load, saveAPIKey};
