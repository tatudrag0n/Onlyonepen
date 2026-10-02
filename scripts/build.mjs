// 静的ホスティング向けのビルド（dist/ に index.html / style.css / app.js を配置）
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const file of ["index.html", "style.css", "app.js"]) {
  await cp(file, `dist/${file}`);
}

console.log("Built dist/ (index.html, style.css, app.js)");