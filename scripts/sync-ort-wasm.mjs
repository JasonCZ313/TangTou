/**
 * 同步 onnxruntime-web 的 WASM 运行时到 public/ort（仅 wasm EP，不含 JSEP/WebGPU）。
 * 商店包体积策略：去掉约 23MB 的 jsep.wasm，保留约 12MB simd-threaded.wasm。
 * 用法：node scripts/sync-ort-wasm.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDirectory, '..');
const sourceDirectory = join(repoRoot, 'node_modules', 'onnxruntime-web', 'dist');
const targetDirectory = join(repoRoot, 'public', 'ort');

/** 本扩展 Offscreen 只用 wasm EP，只同步这两份 */
const REQUIRED_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
];

/**
 * 主流程：清空多余文件后拷贝必需资产。
 */
function main() {
  if (!existsSync(sourceDirectory)) {
    console.error(
      '[sync-ort-wasm] 未找到 onnxruntime-web。请先执行 npm install。',
    );
    process.exitCode = 1;
    return;
  }

  mkdirSync(targetDirectory, { recursive: true });

  // 删除旧的 jsep 等多余文件，避免再次打进商店包
  for (const entryName of readdirSync(targetDirectory)) {
    const keep = REQUIRED_FILES.includes(entryName);
    if (!keep) {
      unlinkSync(join(targetDirectory, entryName));
      console.log(`[sync-ort-wasm] 已移除多余文件：${entryName}`);
    }
  }

  for (const fileName of REQUIRED_FILES) {
    const sourcePath = join(sourceDirectory, fileName);
    if (!existsSync(sourcePath)) {
      console.error(`[sync-ort-wasm] 缺少源文件：${fileName}`);
      process.exitCode = 1;
      return;
    }
    copyFileSync(sourcePath, join(targetDirectory, fileName));
    console.log(`[sync-ort-wasm] 已同步：${fileName}`);
  }

  console.log(
    '[sync-ort-wasm] 完成。商店包仅含 wasm EP；ORT 未对齐/失败时自动回退轻量判断。',
  );
}

main();
