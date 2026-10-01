/**
 * Chrome / Edge 构建冒烟：验证产物清单与关键入口存在，且未打入 ORT JSEP 大文件。
 * 用法：先 npm run build 与 npm run build:edge，再 node scripts/smoke-build.mjs
 * 或：npm run smoke:build（脚本内会先构建）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDirectory, '..');

/** 需要存在的相对路径（相对各浏览器输出根） */
const REQUIRED_RELATIVE_PATHS = [
  'manifest.json',
  'background.js',
  'content-scripts/content.js',
  'sidepanel.html',
  'options.html',
  'popup.html',
  'offscreen.html',
];

/**
 * 校验单个浏览器输出目录。
 */
function verifyOutputRoot(outputRoot, label) {
  const problems = [];
  if (!existsSync(outputRoot)) {
    problems.push(`缺少输出目录：${outputRoot}`);
    return problems;
  }

  for (const relativePath of REQUIRED_RELATIVE_PATHS) {
    const absolutePath = join(outputRoot, relativePath);
    if (!existsSync(absolutePath)) {
      problems.push(`[${label}] 缺少 ${relativePath}`);
    }
  }

  const manifestPath = join(outputRoot, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.manifest_version !== 3) {
      problems.push(`[${label}] manifest_version 不是 3`);
    }
    if (!manifest.name || !String(manifest.name).includes('躺投')) {
      problems.push(`[${label}] manifest.name 异常`);
    }
    const permissionList = manifest.permissions ?? [];
    for (const needed of [
      'storage',
      'sidePanel',
      'scripting',
      'activeTab',
      'offscreen',
      'unlimitedStorage',
    ]) {
      if (!permissionList.includes(needed)) {
        problems.push(`[${label}] 缺少权限 ${needed}`);
      }
    }
  }

  const ortDirectory = join(outputRoot, 'ort');
  if (existsSync(ortDirectory)) {
    const ortNames = readdirSync(ortDirectory);
    if (ortNames.some((name) => /jsep/i.test(name))) {
      problems.push(`[${label}] ort/ 仍含 jsep 资产，体积策略未生效`);
    }
    const wasmName = 'ort-wasm-simd-threaded.wasm';
    if (!ortNames.includes(wasmName)) {
      problems.push(`[${label}] 缺少 ${wasmName}（可选本机 ORT 需要）`);
    } else {
      const wasmBytes = statSync(join(ortDirectory, wasmName)).size;
      if (wasmBytes < 1_000_000) {
        problems.push(`[${label}] ${wasmName} 体积异常偏小`);
      }
    }
  }

  return problems;
}

/**
 * 是否带 --skip-build：只校验已有产物。
 */
function shouldSkipBuild() {
  return process.argv.includes('--skip-build');
}

/**
 * 运行一条 npm 脚本（Windows 下用 npm.cmd，避免 shell+args 弃用警告）。
 */
function runNpmScript(scriptName) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['run', scriptName], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`npm run ${scriptName} 失败`);
  }
}

function main() {
  if (!shouldSkipBuild()) {
    runNpmScript('sync:ort');
    runNpmScript('build');
    runNpmScript('build:edge');
  }

  const problems = [
    ...verifyOutputRoot(join(repoRoot, '.output', 'chrome-mv3'), 'chrome-mv3'),
    ...verifyOutputRoot(join(repoRoot, '.output', 'edge-mv3'), 'edge-mv3'),
  ];

  // 文档资产：上架与隐私
  for (const docPath of [
    'docs/privacy-policy.md',
    'docs/store/listing.md',
    'docs/degradation-matrix.md',
  ]) {
    if (!existsSync(join(repoRoot, docPath))) {
      problems.push(`缺少文档 ${docPath}`);
    }
  }

  if (problems.length > 0) {
    console.error('[smoke-build] 未通过：');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    '[smoke-build] 通过：Chrome/Edge 产物齐全，无 ORT jsep，隐私/商店文档存在。',
  );
  console.log(
    '[smoke-build] 请再在浏览器手动：加载已解压 → 扫页预览写入 → 探活不点提交。',
  );
}

try {
  main();
} catch (error) {
  console.error(
    '[smoke-build] 异常：',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
