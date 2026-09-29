import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/target/**'] },
  },
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), pluginEditor: resolve(__dirname, 'plugin-editor.html') } },
  },
});
