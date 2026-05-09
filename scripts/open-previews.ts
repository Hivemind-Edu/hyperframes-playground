import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const registryPath = join(root, ".preview-logs", "previews.tsv");

type RegistryEntry = {
  port: number;
  pid: number;
  project: string;
  url: string;
  log: string;
};

function printHelp() {
  console.log(`Usage: bun run preview:open [search]

Opens running HyperFrames previews from .preview-logs/previews.tsv.

Examples:
  bun run preview:open
  bun run preview:open react advanced video1
  bun run preview:open 5004
`);
}

function readRegistry(): RegistryEntry[] {
  if (!existsSync(registryPath)) {
    throw new Error(`No preview registry found at ${registryPath}. Run "bun run preview:all" first.`);
  }

  return readFileSync(registryPath, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((row) => {
      const [port, pid, project, url, log] = row.split("\t");
      if (!port || !pid || !project || !url || !log) {
        throw new Error(`Malformed preview registry row: ${row}`);
      }
      return {
        port: Number(port),
        pid: Number(pid),
        project,
        url,
        log,
      };
    });
}

async function isPortListening(port: number) {
  const lsof = Bun.spawn(["lsof", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(lsof.stdout).text();
  await lsof.exited.catch(() => {});
  return output.trim().length > 0;
}

function matchesQuery(entry: RegistryEntry, query: string) {
  if (!query) return true;
  const haystack = `${entry.port} ${entry.project} ${entry.url}`.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token));
}

async function openUrl(url: string) {
  const command =
    process.platform === "darwin" ? ["open", url] :
    process.platform === "win32" ? ["cmd", "/c", "start", "", url] :
    ["xdg-open", url];

  const open = Bun.spawn(command, { stdout: "ignore", stderr: "inherit" });
  await open.exited;
}

async function main() {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const query = args.join(" ").trim();
  const entries = readRegistry().filter((entry) => matchesQuery(entry, query));
  const running = [];

  for (const entry of entries) {
    if (await isPortListening(entry.port)) {
      running.push(entry);
    }
  }

  if (running.length === 0) {
    throw new Error(query ? `No running previews matched "${query}"` : "No running previews found");
  }

  if (query && running.length > 1) {
    console.error(`"${query}" matched multiple running previews:`);
    for (const entry of running) {
      console.error(`${entry.port}\t${entry.project}\t${entry.url}`);
    }
    console.error("Use a more specific path term or port.");
    process.exit(1);
  }

  for (const entry of running) {
    console.log(`Opening ${entry.project}: ${entry.url}`);
    await openUrl(entry.url);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
