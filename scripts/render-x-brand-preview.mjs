import { mkdir } from "node:fs/promises";
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
const avatarPath = path.join(
  assetRoot,
  "00-头像/us-lens-avatar-v3-market-desk.png",
);
const headerPath = path.join(
  assetRoot,
  "01-X顶图/us-lens-x-header-v3-market-desk.png",
);
const coverPath = path.join(
  assetRoot,
  "04-X内容模板/us-lens-x-post-cover-v3-market-desk.png",
);
const outputDir = path.join(assetRoot, "05-X账号预览");
const outputPath = path.join(
  outputDir,
  "us-lens-x-profile-v3-market-desk-preview.png",
);

await mkdir(outputDir, { recursive: true });

const avatarSize = 214;
const avatarMask = Buffer.from(
  `<svg width="${avatarSize}" height="${avatarSize}">
    <circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="#fff"/>
  </svg>`,
);
const avatar = await sharp(avatarPath)
  .resize(avatarSize, avatarSize)
  .composite([{ input: avatarMask, blend: "dest-in" }])
  .png()
  .toBuffer();

const header = await sharp(headerPath).resize(1500, 500).png().toBuffer();
const cover = await sharp(coverPath).resize(390, 488).png().toBuffer();

const overlay = Buffer.from(`
  <svg width="1800" height="1280" xmlns="http://www.w3.org/2000/svg">
    <rect x="150" y="60" width="1500" height="1120" rx="18" fill="#FFFFFF"/>
    <circle cx="347" cy="560" r="113" fill="#FFFFFF"/>
    <g font-family="'Helvetica Neue','PingFang SC','Microsoft YaHei',Arial,sans-serif">
      <text x="230" y="727" fill="#101820" font-size="40" font-weight="750">US LENS｜美股热点追踪</text>
      <text x="230" y="768" fill="#6D737A" font-size="24">@USLensDaily</text>
      <text x="230" y="834" fill="#101820" font-size="27">每日盘前 20:30／盘后 08:00（香港时间）</text>
      <text x="230" y="876" fill="#101820" font-size="27">拆解事实、市场解读与待验证假设</text>
      <text x="230" y="918" fill="#6D737A" font-size="23">相关公司仅作产业链参考，不构成投资建议</text>
      <line x1="230" y1="974" x2="1030" y2="974" stroke="#D4D6D9" stroke-width="2"/>
      <text x="230" y="1027" fill="#101820" font-size="21" font-weight="700" letter-spacing="2">PROFILE PREVIEW</text>
      <text x="230" y="1067" fill="#6D737A" font-size="20">头像覆盖区、报头安全区与日报封面均按 X 实际比例展示</text>
      <text x="1120" y="695" fill="#101820" font-size="24" font-weight="700">日报内容封面</text>
      <text x="1500" y="695" text-anchor="end" fill="#6D737A" font-size="19">1080 × 1350</text>
    </g>
  </svg>
`);

await sharp({
  create: {
    width: 1800,
    height: 1280,
    channels: 4,
    background: "#E9EAEC",
  },
})
  .composite([
    { input: overlay, left: 0, top: 0 },
    { input: header, left: 150, top: 60 },
    { input: avatar, left: 240, top: 453 },
    { input: cover, left: 1120, top: 718 },
  ])
  .png()
  .toFile(outputPath);

console.log(outputPath);
