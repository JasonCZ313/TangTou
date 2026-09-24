/**
 * 从 element-china-area-data 生成省市区树 JSON，写入 public 与 fixtures。
 * 节点统一为 { code, name, children? }，列表不含「其他」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regionData } from 'element-china-area-data';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * 递归转换 element 节点为本地 RegionNode。
 */
function convertNode(rawNode) {
  const node = {
    code: String(rawNode.value),
    name: String(rawNode.label),
  };
  if (Array.isArray(rawNode.children) && rawNode.children.length > 0) {
    node.children = rawNode.children.map(convertNode);
  }
  return node;
}

const tree = regionData.map(convertNode);

// 补充港澳台省级节点（无下级时可直接确认）
const extraProvinces = [
  { code: '81', name: '香港特别行政区' },
  { code: '82', name: '澳门特别行政区' },
  { code: '71', name: '台湾省' },
];
for (const province of extraProvinces) {
  if (!tree.some((item) => item.code === province.code || item.name === province.name)) {
    tree.push(province);
  }
}

const payload = {
  version: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  regions: tree,
};

const publicDir = path.join(repoRoot, 'public', 'data');
const fixturesDir = path.join(repoRoot, 'fixtures', 'data');
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(fixturesDir, { recursive: true });

const jsonText = JSON.stringify(payload);
fs.writeFileSync(path.join(publicDir, 'china-pca.json'), jsonText);
fs.writeFileSync(path.join(fixturesDir, 'china-pca.json'), jsonText);

const provinceCount = tree.length;
let cityCount = 0;
let districtCount = 0;
for (const province of tree) {
  for (const city of province.children || []) {
    cityCount += 1;
    districtCount += (city.children || []).length;
  }
}

console.log(
  `china-pca.json OK provinces=${provinceCount} cities=${cityCount} districts=${districtCount} bytes=${jsonText.length}`,
);
