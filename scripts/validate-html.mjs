import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const htmlPath = path.resolve("index.html");
if (!fs.existsSync(htmlPath)) throw new Error("index.html não encontrado.");
const html = fs.readFileSync(htmlPath, "utf8");

if (!html.includes('data-fechou-build="V337"')) {
  throw new Error("Marcador de build V337 ausente no elemento HTML.");
}
if (!html.includes('window.FECHOU_BUILD_VERSION="V337-CANONICAL-CHAT-AND-EVIDENCE"')) {
  throw new Error("Marcador interno V337 ausente.");
}
if (!html.includes("async function openChat") || !html.includes("async function loadEvidence")) {
  throw new Error("Funções centrais de chat/evidências não encontradas.");
}

const ids = [...html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]);
const seen = new Set();
const duplicates = new Set();
for (const id of ids) {
  if (seen.has(id)) duplicates.add(id);
  seen.add(id);
}
if (duplicates.size) {
  throw new Error("IDs HTML duplicados: " + [...duplicates].join(", "));
}

const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
const ignoredTypes = new Set(["application/json", "application/ld+json", "importmap", "speculationrules"]);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fechou-v337-"));
let checked = 0;
try {
  for (let i = 0; i < scriptTags.length; i++) {
    const attrs = scriptTags[i][1] || "";
    const code = scriptTags[i][2] || "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*(["'])(.*?)\1/i);
    const type = (typeMatch?.[2] || "").toLowerCase();
    if (ignoredTypes.has(type) || !code.trim()) continue;
    const ext = type === "module" ? "mjs" : "js";
    const file = path.join(tempDir, `script-${i}.${ext}`);
    fs.writeFileSync(file, code);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`Erro de sintaxe no script inline #${i}:\n${result.stderr || result.stdout}`);
    }
    checked++;
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`FECHOU V337 validado: ${checked} scripts JavaScript, ${ids.length} IDs HTML, zero IDs duplicados.`);
