import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".vercel/output");
const handler = path.join(output, "functions/api.func/app.mjs");

test("build output routes API separately from static files and SPA", async () => {
  const config = JSON.parse(await readFile(path.join(output, "config.json"), "utf8"));
  assert.equal(config.version, 3);
  assert.ok(new RegExp(`^${config.routes[0].src}$`).test("/api/campaigns/generate"));
  assert.ok(!new RegExp(`^${config.routes[0].src}$`).test("/apiculture"));
  assert.equal(config.routes[0].dest, "/api");
  assert.equal(config.routes.at(-1).dest, "/index.html");
  await access(path.join(output, "static/index.html"));
  assert.ok((await readdir(path.join(output, "static/assets"))).some((name) => name.endsWith(".js")));
  const runtime = JSON.parse(await readFile(path.join(output, "functions/api.func/.vc-config.json"), "utf8"));
  assert.equal(runtime.runtime, "nodejs22.x");
  assert.equal(runtime.maxDuration, 300);
  await access(handler);
});

test("bundled API starts without Replit AI credentials or PORT and serves API paths", async () => {
  // No database settings, Claude key, or Replit credentials reach this process.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import app from ${JSON.stringify(`file://${handler}`)};
    const server = app.listen(0, "127.0.0.1", () => {
      process.stdout.write("READY:" + server.address().port + "\\n");
    });
  `], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      VERCEL: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let stdout = "", stderr = "";
      const timeout = setTimeout(() => reject(new Error(`Bundle startup timed out: ${stderr}`)), 15_000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        const match = stdout.match(/READY:(\d+)/);
        if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
      });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Bundle exited ${code}: ${stderr}`)); });
    });
    const providers = await fetch(`http://127.0.0.1:${port}/api/providers`);
    assert.equal(providers.status, 200);
    assert.ok((await providers.json()).some((provider) => provider.id === "anthropic"));
    const missing = await fetch(`http://127.0.0.1:${port}/api/not-a-route`);
    assert.equal(missing.status, 404);
    assert.ok(!missing.headers.get("content-type")?.includes("application/json"));
  } finally {
    child.kill();
  }
});
