/** Thin standalone wrapper; the implementation lives in cli/evalkit/command.ts. */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { runCli } from "../cli/index.js";
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCli(["eval", ...process.argv.slice(2)], {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  });
}
