import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildVersion = process.env.PYBIT_BUILD_VERSION ?? new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const projectDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  define: { __PYBIT_BUILD_VERSION__: JSON.stringify(buildVersion) },
  plugins: [react(), {
    name: 'pybit-versioned-service-worker',
    writeBundle() {
      const template = readFileSync(resolve(projectDir, 'public/sw.js'), 'utf8');
      writeFileSync(resolve(projectDir, 'dist/sw.js'), template.replaceAll('__PYBIT_BUILD_VERSION__', buildVersion));
      copyFileSync(resolve(projectDir, 'edgeone.json'), resolve(projectDir, 'dist/edgeone.json'));
    }
  }]
});
