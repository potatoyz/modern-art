import { defineConfig } from 'vite';
import { gzipSync } from 'node:zlib';
const backend = `http://127.0.0.1:${process.env.PORT || 8787}`;
export default defineConfig({
  plugins: [{ name: 'compact-delivery', generateBundle(_, bundle) {
    const used = Object.values(bundle).filter(f=>f.type==='chunk').map(f=>f.code).join('\n');
    for (const [name,file] of Object.entries(bundle)) {
      if (file.type==='asset' && /(?:draco|basis_transcoder)/.test(name) && !used.includes(name)) delete bundle[name];
    }
    for (const [name,file] of Object.entries(bundle)) if (/\.(js|css|html)$/.test(name)) {
      this.emitFile({type:'asset',fileName:`${name}.gz`,source:gzipSync(file.type==='chunk'?file.code:file.source)});
    }
  } }],
  server: { host: process.env.A3GAME_DEV_HOST || '127.0.0.1', port: Number(process.env.A3GAME_DEV_PORT || 5173), strictPort: true,
    proxy: { '/ws': { target: backend, ws: true }, '/health': backend } },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: false, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  test: { include: ['packages/modern-art/tests/**/*.test.js'], testTimeout: 15000, fileParallelism: false },
});
