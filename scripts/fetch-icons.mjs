// Downloads catalog app logos (from the research-verified icon list) and
// normalizes every one to a 128x128 transparent-background PNG in
// public/icons/<app-id>.png. Run from the repo root: node scripts/fetch-icons.mjs
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const list = JSON.parse(readFileSync(new URL("./icon-list.json", import.meta.url)));
mkdirSync("public/icons", { recursive: true });

const UA = "outfitter-icon-fetch/1.0 (+https://github.com/TylerSander/outfitter)";
let ok = 0;
const failures = [];

for (const item of list) {
  if (item.quality === "none") {
    failures.push(`${item.app_id}: no icon source`);
    continue;
  }
  try {
    const res = await fetch(item.icon_url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // SVGs rasterize at high density so 128px comes out crisp.
    const input = item.format === "svg" ? sharp(buf, { density: 300 }) : sharp(buf);
    const png = await input
      .resize(128, 128, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    writeFileSync(`public/icons/${item.app_id}.png`, png);
    ok += 1;
    console.log(`ok   ${item.app_id}  (${png.length} B from ${item.format})`);
  } catch (e) {
    failures.push(`${item.app_id}: ${e.message} <- ${item.icon_url}`);
    console.error(`FAIL ${item.app_id}: ${e.message}`);
  }
}

console.log(`\n${ok}/${list.length} icons written`);
if (failures.length > 0) {
  console.log("failures:\n  " + failures.join("\n  "));
  process.exitCode = 1;
}
