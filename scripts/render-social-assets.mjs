import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, "..");
const assetRoot =
  process.env.US_LENS_SOCIAL_ASSETS ??
  path.resolve(
    siteRoot,
    "../00-美股投资知识库/03-输出与复盘层/06-品牌与社媒/03-视觉资产",
  );

async function findSvgFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return findSvgFiles(target);
      return entry.isFile() && entry.name.toLowerCase().endsWith(".svg")
        ? [target]
        : [];
    }),
  );
  return files.flat();
}

const svgFiles = await findSvgFiles(assetRoot);
if (svgFiles.length === 0) {
  throw new Error(`未在视觉资产目录找到 SVG：${assetRoot}`);
}

for (const svgPath of svgFiles) {
  const pngPath = svgPath.replace(/\.svg$/i, ".png");
  await sharp(svgPath, { density: 72 }).png().toFile(pngPath);
  console.log(`Rendered ${path.relative(assetRoot, pngPath)}`);
}
