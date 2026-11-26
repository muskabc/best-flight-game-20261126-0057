// Minimal static server for local play-testing: node serve.ts [--port 8902]
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gameRoot = resolve(fileURLToPath(new URL("./game", import.meta.url)));
const args = process.argv.slice(2);
const pi = args.indexOf("--port");
const port = pi >= 0 ? Number(args[pi + 1]) || 8902 : 8902;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(join(gameRoot, "." + path));
  if (!file.startsWith(gameRoot)) { res.writeHead(403).end(); return; }
  try {
    if (!statSync(file).isFile()) throw new Error("nope");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log("serving game/ on http://localhost:" + port));
