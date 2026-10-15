import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "artifacts/api-server");
const apiRequire = createRequire(path.join(apiDir, "package.json"));
const { build } = apiRequire("esbuild");
const { default: pinoPlugin } = await import(apiRequire.resolve("esbuild-plugin-pino"));
globalThis.require = apiRequire;

const output = path.join(root, ".vercel/output");
const functionDir = path.join(output, "functions/api.func");

// Only remove generated output, never Vercel's project link or environment files.
await rm(output, { recursive: true, force: true });
await mkdir(functionDir, { recursive: true });

execFileSync("pnpm", ["--filter", "@workspace/research-social-workflow", "run", "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", BASE_PATH: "/" },
});
await cp(path.join(root, "artifacts/research-social-workflow/dist/public"),
  path.join(output, "static"), { recursive: true });

// Export Express itself, not index.ts, which starts a long-running port listener.
// Bundle workspace packages so Vercel needs no TS aliases or repo node_modules.
await build({
  entryPoints: [path.join(apiDir, "src/app.ts")],
  outdir: functionDir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  logLevel: "info",
  external: ["pg-native"],
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [pinoPlugin({ transports: ["pino-pretty"] })],
  banner: {
    js: `import { createRequire as __bundleRequire } from 'node:module';
import { fileURLToPath as __bundleFilePath } from 'node:url';
import { dirname as __bundleDirname } from 'node:path';
const require = __bundleRequire(import.meta.url);
const __filename = __bundleFilePath(import.meta.url);
const __dirname = __bundleDirname(__filename);
globalThis.require = require;`,
  },
});

await writeFile(path.join(functionDir, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs22.x",
  handler: "app.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: true,
  maxDuration: 300,
}, null, 2));

// API routes preserve the original path, and must precede the SPA fallback.
await writeFile(path.join(output, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "/api(?:/.*)?", dest: "/api", headers: { "Cache-Control": "no-store" } },
    { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
    { handle: "filesystem" },
    { src: "/.*", dest: "/index.html" },
  ],
}, null, 2));

console.log("Vercel build ready: static frontend + bundled Node.js API.");
