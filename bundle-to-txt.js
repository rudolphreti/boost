import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FILES = ["package.json", "main.js", "index.html", "renderer.js"];
const OUT = "bundle.txt";

function sep() {
  return "\n-----------------\n\n";
}

async function run() {
  const parts = [];

  for (const f of FILES) {
    const p = path.resolve(process.cwd(), f);
    const code = await readFile(p, "utf8");
    parts.push(`${f}\n\n${code}`);
  }

  await writeFile(path.resolve(process.cwd(), OUT), parts.join(sep()), "utf8");
  console.log(`Saved: ${OUT}`);
}

run().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
