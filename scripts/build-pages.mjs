import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const templatesDir = path.join(root, "templates");
const staticDir = path.join(root, "static");
const cloudflareDir = path.join(root, "cloudflare");

const templatePages = ["index.html", "navigation.html", "rescue.html"];
const cfFiles = ["_redirects", "_headers"];

async function fileExists(targetPath) {
    try {
        await access(targetPath);
        return true;
    } catch (_err) {
        return false;
    }
}

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, "static"), { recursive: true });

await cp(staticDir, path.join(distDir, "static"), { recursive: true });

for (const page of templatePages) {
    await cp(path.join(templatesDir, page), path.join(distDir, page));
}

for (const file of cfFiles) {
    const src = path.join(cloudflareDir, file);
    const dst = path.join(distDir, file);
    if (await fileExists(src)) {
        await cp(src, dst);
    }
}

console.log("Cloudflare Pages build complete -> dist/");
