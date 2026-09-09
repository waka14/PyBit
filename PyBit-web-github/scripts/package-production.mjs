import { existsSync, readFileSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const envPath = resolve(appDir, '.env.production.local');
const distDir = resolve(appDir, 'dist');
const outputZip = resolve(appDir, 'pybit-edgeone-production.zip');
const temporaryZip = `${outputZip}.tmp`;

function fail(message) { console.error(`生产打包已停止：${message}`); process.exit(1); }
function loadPublicEnv() {
  if (!existsSync(envPath)) fail('缺少 .env.production.local；请仅填写 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY。');
  const entries = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/); if (!match) fail(`环境变量格式无效：${trimmed}`);
    entries[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const permitted = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']);
  for (const key of Object.keys(entries)) {
    if (/SERVICE|SECRET|PASSWORD|JWT|DATABASE/i.test(key)) fail(`不允许在生产前端环境文件中出现敏感变量：${key}`);
    if (!permitted.has(key)) fail(`只允许两个公开变量，发现了不支持的变量：${key}`);
  }
  const url = entries.VITE_SUPABASE_URL; const key = entries.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) fail('VITE_SUPABASE_URL 必须是 https://项目引用.supabase.co。');
  if (!key || key.length < 20) fail('VITE_SUPABASE_PUBLISHABLE_KEY 缺失或长度异常。');
  return { ...entries, VITE_ALLOW_DEMO: 'false' };
}
function run(command, args, env, cwd = appDir) { execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } }); }
function runPackageScript(args, env) {
  if (process.env.npm_execpath) return execFileSync(process.execPath, [process.env.npm_execpath, 'run', ...args], { cwd: appDir, stdio: 'inherit', env: { ...process.env, ...env } });
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', ...args], env);
}
function verifyArtifact() {
  const files = readdirSync(distDir, { recursive: true }); const textFiles = files.filter((file) => /\.(?:html|js|css|json|webmanifest|txt)$/i.test(String(file)));
  const prohibited = [/pybit-demo-v2/i, /开发模拟身份/i, /重置演示数据/i, /VITE_SUPABASE_(?:SERVICE|SECRET|PASSWORD|JWT|DATABASE)/i, /service[_-]?role\s*[:=]/i, /postgres(?:ql)?:\/\/[^\s"']+@/i, /database password/i];
  for (const relative of textFiles) { const source = readFileSync(resolve(distDir, String(relative)), 'utf8'); if (prohibited.some((pattern) => pattern.test(source))) fail(`构建产物出现禁止内容：${relative}`); }
  if (!existsSync(resolve(distDir, 'index.html')) || !existsSync(resolve(distDir, 'edgeone.json'))) fail('dist 缺少 index.html 或 EdgeOne 配置。');
}

const publicEnv = loadPublicEnv();
runPackageScript(['test'], publicEnv);
runPackageScript(['build'], publicEnv);
verifyArtifact();
if (existsSync(temporaryZip)) rmSync(temporaryZip);
run('zip', ['-qr', temporaryZip, '.'], publicEnv, distDir);
// zip is executed in dist so index.html and edgeone.json are at the archive root, not inside dist/.
if (existsSync(outputZip)) rmSync(outputZip);
renameSync(temporaryZip, outputZip);
console.log(`生产 ZIP 已生成：${outputZip}`);
