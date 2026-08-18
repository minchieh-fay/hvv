import {Agent, OpenAIProvider, Runner, setOpenAIAPI} from '@openai/agents';
import OpenAI from 'openai';
import {llmStore} from '../store/llm';

let agent;
let runner;
let configuredKey = '';

// 初始化 Agnes Agents SDK，并创建当前聊天 Agent。
function configureChat() {
    const settings = llmStore.state;
    if (!settings.apiKey) throw new Error('聊天模型尚未配置');
    setOpenAIAPI('chat_completions');
    // 在 Wails 浏览器环境中显式创建认证 client，再交给 Agents SDK 使用。
    const openAIClient = new OpenAI({
        apiKey: settings.apiKey,
        baseURL: settings.baseURL,
        dangerouslyAllowBrowser: true,
    });
    const modelProvider = new OpenAIProvider({openAIClient, useResponses: false});
    agent = new Agent({name: 'Agnes assistant', model: settings.model});
    // modelProvider 必须交给 Runner，不能放在 Agent 配置中。
    runner = new Runner({modelProvider, tracingDisabled: true, workflowName: 'hvv 聊天'});
    configuredKey = settings.apiKey;
}

// 使用前端 Agents SDK 执行一轮带上下文的对话，并返回文本结果。
export async function completeChat(messages, signal) {
    if (!agent || !runner || configuredKey !== llmStore.state.apiKey) configureChat();
    // 将 Vue 响应式消息转换为普通对象，避免 Agents SDK 的 structuredClone 无法克隆代理对象。
    const plainMessages = messages.map(({role, content}) => ({role, content}));
    const result = await runner.run(agent, plainMessages, {signal});
    return result.finalOutput || '模型没有返回文本内容';
}
