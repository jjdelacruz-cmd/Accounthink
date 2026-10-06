// Copies MediaPipe's WebAssembly files into public/ so the camera check loads them from
// our own site (no third-party CDN). Runs before `next dev` and `next build`.
import { copyFileSync, mkdirSync } from "node:fs";

const from = "node_modules/@mediapipe/tasks-vision/wasm";
const to = "public/mediapipe/wasm";
mkdirSync(to, { recursive: true });
for (const f of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  copyFileSync(`${from}/${f}`, `${to}/${f}`);
}
console.log("MediaPipe wasm copied to", to);
