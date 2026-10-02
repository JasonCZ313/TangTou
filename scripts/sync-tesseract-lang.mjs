/**
 * 把 Tesseract 中英词库同步到 public/tesseract/lang/，供扩展内离线 OCR。
 * 优先从 npm 包 @tesseract.js-data/* 拷贝；没有则从 jsDelivr 下载 .gz。
 * 用法：node scripts/sync-tesseract-lang.mjs
 */
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDirectory, '..');
const targetDirectory = join(repoRoot, 'public', 'tesseract', 'lang');

/** 本扩展 OCR 使用 chi_sim + eng */
const LANG_FILES = [
  {
    langCode: 'chi_sim',
    fileName: 'chi_sim.traineddata.gz',
    npmPackage: '@tesseract.js-data/chi_sim',
    npmRelativePath: join('4.0.0', 'chi_sim.traineddata.gz'),
    downloadUrl:
      'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0/chi_sim.traineddata.gz',
  },
  {
    langCode: 'eng',
    fileName: 'eng.traineddata.gz',
    npmPackage: '@tesseract.js-data/eng',
    npmRelativePath: join('4.0.0', 'eng.traineddata.gz'),
    downloadUrl:
      'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0/eng.traineddata.gz',
  },
];

/**
 * 从 URL 下载文件到目标路径。
 */
async function downloadFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 HTTP ${response.status}：${url}`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destinationPath),
  );
}

/**
 * 主流程：确保 lang 目录存在并放入中英词库。
 */
async function main() {
  mkdirSync(targetDirectory, { recursive: true });

  const keepNames = new Set(LANG_FILES.map((entry) => entry.fileName));
  for (const entryName of readdirSync(targetDirectory)) {
    if (!keepNames.has(entryName)) {
      unlinkSync(join(targetDirectory, entryName));
      console.log(`[sync-tesseract-lang] 已移除多余文件：${entryName}`);
    }
  }

  for (const langEntry of LANG_FILES) {
    const destinationPath = join(targetDirectory, langEntry.fileName);
    const npmPath = join(
      repoRoot,
      'node_modules',
      langEntry.npmPackage,
      langEntry.npmRelativePath,
    );

    if (existsSync(npmPath)) {
      copyFileSync(npmPath, destinationPath);
      console.log(
        `[sync-tesseract-lang] 已从 npm 同步：${langEntry.fileName}`,
      );
      continue;
    }

    if (existsSync(destinationPath)) {
      console.log(
        `[sync-tesseract-lang] 已存在，跳过下载：${langEntry.fileName}`,
      );
      continue;
    }

    console.log(
      `[sync-tesseract-lang] 正在下载：${langEntry.fileName}`,
    );
    await downloadFile(langEntry.downloadUrl, destinationPath);
    console.log(`[sync-tesseract-lang] 已下载：${langEntry.fileName}`);
  }

  console.log(
    '[sync-tesseract-lang] 完成。OCR 将使用扩展内词库（langPath=/tesseract/lang/）。',
  );
}

main().catch((error) => {
  console.error('[sync-tesseract-lang] 失败：', error);
  process.exitCode = 1;
});
