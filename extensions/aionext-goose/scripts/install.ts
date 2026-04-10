import { $ } from "bun";

if (process.platform === "win32") {
  throw new Error("Goose does not support Windows. Please visit https://github.com/block/goose for manual installation.");
}

const dir = process.env.AIONUI_AGENT_INSTALL_DIR;
if (!dir) {
  console.error("[install] AIONUI_AGENT_INSTALL_DIR is not set");
  process.exit(1);
}

const arch = process.arch === "arm64" ? "arm64" : "x86_64";
const platform = process.platform === "darwin" ? "darwin" : "linux";
const binaryUrl = `https://github.com/block/goose/releases/latest/download/goose-${platform}-${arch}`;
const binaryPath = `${dir}/goose`;

console.log(`[install] Downloading goose from ${binaryUrl} ...`);
try {
  await $`curl -fsSL ${binaryUrl} -o ${binaryPath}`;
  await $`chmod +x ${binaryPath}`;
  console.log(`[install] Goose installed to ${binaryPath}`);
} catch {
  console.error("[install] Failed to download goose binary");
  process.exit(1);
}
