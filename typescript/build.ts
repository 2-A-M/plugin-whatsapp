#!/usr/bin/env bun

/**
 * Standalone build script for @elizaos/plugin-whatsapp.
 *
 * Uses Bun's native bundler so the plugin can be built outside the
 * elizaOS monorepo (e.g. after `npm install` or in downstream projects).
 * The previous version imported `runBuild` from `../../../eliza/build-utils`
 * which only exists inside the monorepo, causing the npm-published package
 * to ship without compiled JavaScript.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const distDir = join(process.cwd(), "dist");

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  external: [
    // Node builtins
    "fs",
    "path",
    "os",
    "http",
    "https",
    "crypto",
    "stream",
    "events",
    "util",
    "url",
    "net",
    "tls",
    "zlib",
    "buffer",
    "child_process",
    "readline",
    // Core dependency
    "@elizaos/core",
    // Runtime dependencies (resolved from node_modules)
    "axios",
    "@hapi/boom",
    "@whiskeysockets/baileys",
    "pino",
    "qrcode",
    "qrcode-terminal",
  ],
  sourcemap: "linked",
  minify: false,
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Create type declaration stub
if (!existsSync(distDir)) {
  await mkdir(distDir, { recursive: true });
}
const dtsContent = [
  'export * from "../src/index";',
  'export { default } from "../src/index";',
  "",
].join("\n");
await writeFile(join(distDir, "index.d.ts"), dtsContent, "utf8");

console.log("[plugin-whatsapp] Build complete");
