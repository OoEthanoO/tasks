import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
await mkdir("dist", { recursive: true });
await mkdir("resources", { recursive: true });
const icon = await sharp("../mobile/assets/icon.png").resize(256, 256).png().toBuffer();
await writeFile("resources/icon.png", icon);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(icon.length, 14); header.writeUInt32LE(22, 18);
await writeFile("resources/icon.ico", Buffer.concat([header, icon]));
const symbols = {
  work: ['#4ade80', '<path d="m12 8 13 8-13 8z" fill="#0c1712"/>'],
  rest: ['#7dd3fc', '<path d="M22 8A10 10 0 1 0 24 22 9 9 0 0 1 22 8" fill="#102030"/>'],
  idle: ['#fbbf24', '<path d="M11 9h4v14h-4zM18 9h4v14h-4z" fill="#241c0b"/>'],
  open: ['#a89aff', '<rect x="8" y="8" width="16" height="16" rx="2" fill="none" stroke="#151126" stroke-width="3"/>'],
};
for (const [name, [color, shape]] of Object.entries(symbols)) {
  await sharp(Buffer.from(`<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="15" fill="${color}"/>${shape}</svg>`)).png().toFile(`resources/${name}.png`);
}
const common = { bundle: true, logLevel: "info", absWorkingDir: root };
await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs", platform: "node", format: "cjs", target: "node22", external: ["electron"] });
await build({
  ...common, entryPoints: ["src/renderer.tsx"], outfile: "dist/renderer.js", platform: "browser", format: "iife", target: "chrome140", minify: true,
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@/components/useTracking": path.join(root, "src/useTracking.ts"), "@": path.resolve(root, ".."), "react": path.join(root, "node_modules/react"), "react-dom": path.join(root, "node_modules/react-dom") },
});
await copyFile("src/index.html", "dist/index.html");
console.log("Windows app built with the shared web UI and tracking model.");
