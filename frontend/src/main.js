import {createApp} from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import './style.css';
import './app.css';
import App from './App.vue';
import {llmStore} from './store/llm';

await llmStore.load();
createApp(App).use(ElementPlus).mount('#app');
