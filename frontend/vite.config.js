import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';

// 配置 Vite 的 Vue 单文件组件编译插件。
export default defineConfig({
    plugins: [vue()],
    server: {
        proxy: {
            '/api': 'http://127.0.0.1:15351',
            '/media': 'http://127.0.0.1:15351',
        },
    },
});
