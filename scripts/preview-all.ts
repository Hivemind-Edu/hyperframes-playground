import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const videosRoot = join(root, "videos");
const logDir = join(root, ".preview-logs");
const registryPath = join(logDir, "previews.tsv");
const defaultBasePort = 5000;
const hyperframesVersion = "0.6.0-alpha.2";

type Project = {
  dir: string;
  projectName: string;
  relativePath: string;
};

type Preview = Project & {
  port: number;
  url: string;
  logPath: string;
  process: ReturnType<typeof Bun.spawn>;
};

type Options = {
  basePort: number;
  killExisting: boolean;
  filter: string | null;
};

function parseArgs(args: string[]): Options {
  const options: Options = {
    basePort: defaultBasePort,
    killExisting: true,
    filter: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--base-port" || arg === "-p") {
      const value = args[i + 1];
      if (!value) throw new Error(`${arg} needs a port number`);
      options.basePort = Number(value);
      i += 1;
      continue;
    }

    if (arg === "--no-kill") {
      options.killExisting = false;
      continue;
    }

    if (arg === "--filter" || arg === "-f") {
      const value = args[i + 1];
      if (!value) throw new Error(`${arg} needs a search string`);
      options.filter = value;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.basePort) || options.basePort < 1 || options.basePort > 65535) {
    throw new Error(`Invalid base port: ${options.basePort}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: bun run preview:all [options]

Starts a HyperFrames preview for every videos/**/hyperframes.json project.

Options:
  -p, --base-port <port>  First port to use. Default: ${defaultBasePort}
  -f, --filter <text>    Start only projects whose path contains this text
      --no-kill          Do not kill existing preview ports before starting
  -h, --help             Show this help
`);
}

function findProjects(dir: string): Project[] {
  const projects: Project[] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    const hasHyperframesConfig = entries.some((entry) => entry.isFile() && entry.name === "hyperframes.json");

    if (hasHyperframesConfig) {
      projects.push({
        dir: currentDir,
        projectName: currentDir.split("/").at(-1) ?? "project",
        relativePath: relative(root, currentDir),
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      walk(join(currentDir, entry.name));
    }
  }

  walk(dir);
  return projects.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function killPid(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  await Bun.spawn(["kill", String(pid)], { stdout: "ignore", stderr: "ignore" }).exited.catch(() => {});
}

async function commandForPid(pid: number) {
  const ps = Bun.spawn(["ps", "-o", "command=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(ps.stdout).text();
  await ps.exited.catch(() => {});
  return output.trim();
}

async function listeningPidsForPort(port: number) {
  const lsof = Bun.spawn(["lsof", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(lsof.stdout).text();
  await lsof.exited.catch(() => {});

  return output
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function killListeningPorts(startPort: number, endPort: number) {
  const lsof = Bun.spawn(["lsof", `-tiTCP:${startPort}-${endPort}`, "-sTCP:LISTEN"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(lsof.stdout).text();
  await lsof.exited.catch(() => {});

  const pids = output
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  await Promise.all(
    [...new Set(pids)].map(async (pid) => {
      const command = await commandForPid(pid);
      if (command.toLowerCase().includes("hyperframes")) {
        await killPid(pid);
      }
    }),
  );
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

async function allocatePorts(basePort: number, count: number) {
  const ports: number[] = [];
  let port = basePort;

  while (ports.length < count) {
    if (port > 65535) {
      throw new Error(`Could not allocate ${count} ports starting at ${basePort}`);
    }

    if (!(await isPortListening(port))) {
      ports.push(port);
    }

    port += 1;
  }

  return ports;
}

async function killRegisteredPreviews() {
  if (!existsSync(registryPath)) return;

  const rows = readFileSync(registryPath, "utf8").trim().split("\n").slice(1);
  const entries = rows.map((row) => {
    const [port, pid] = row.split("\t");
    return { port: Number(port), pid: Number(pid) };
  });
  const pids = entries
    .flatMap((entry) => [entry.pid])
    .filter((value) => Number.isInteger(value) && value > 0);

  for (const entry of entries) {
    if (Number.isInteger(entry.port) && entry.port > 0) {
      pids.push(...(await listeningPidsForPort(entry.port)));
    }
  }

  await Promise.all([...new Set(pids)].map(killPid));
}

function matchesFilter(project: Project, filter: string | null) {
  if (!filter) return true;
  return project.relativePath.toLowerCase().includes(filter.toLowerCase());
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  const projects = findProjects(videosRoot).filter((project) => matchesFilter(project, options.filter));

  if (projects.length === 0) {
    throw new Error(options.filter ? `No projects matched filter "${options.filter}"` : "No HyperFrames projects found");
  }

  const endPort = options.basePort + projects.length + 50;
  if (endPort > 65535) {
    throw new Error(`Port range ${options.basePort}-${endPort} exceeds 65535`);
  }

  mkdirSync(logDir, { recursive: true });

  if (options.killExisting) {
    await killRegisteredPreviews();
    await killListeningPorts(options.basePort, endPort);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  const ports = await allocatePorts(options.basePort, projects.length);
  const previews: Preview[] = [];
  const registryRows = ["port\tpid\tproject\turl\tlog"];

  for (const [index, project] of projects.entries()) {
    const port = ports[index];
    if (!port) throw new Error(`Missing allocated port for ${project.relativePath}`);
    const url = `http://localhost:${port}/#project/${encodeURIComponent(project.projectName)}`;
    const logPath = join(logDir, `preview-${port}.log`);
    rmSync(logPath, { force: true });

    const logFile = Bun.file(logPath);
    const process = Bun.spawn(["npx", "--yes", `hyperframes@${hyperframesVersion}`, "preview", "--port", String(port)], {
      cwd: project.dir,
      stdout: logFile,
      stderr: logFile,
      stdin: "ignore",
    });

    previews.push({ ...project, port, url, logPath, process });
    registryRows.push(`${port}\t${process.pid}\t${project.relativePath}\t${url}\t${logPath}`);
  }

  writeFileSync(registryPath, `${registryRows.join("\n")}\n`);

  console.log("Started HyperFrames previews:");
  for (const preview of previews) {
    console.log(`${preview.port}\t${preview.relativePath}\t${preview.url}`);
  }
  console.log(`\nRegistry: ${registryPath}`);
  console.log("Press Ctrl+C to stop all previews.");

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nStopping previews...");

    for (const preview of previews) {
      preview.process.kill();
      for (const pid of await listeningPidsForPort(preview.port)) {
        await killPid(pid);
      }
    }

    await Promise.all(previews.map((preview) => preview.process.exited.catch(() => {})));

    for (const preview of previews) {
      for (const pid of await listeningPidsForPort(preview.port)) {
        await killPid(pid);
      }
    }

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.race(previews.map((preview) => preview.process.exited));

  for (const preview of previews) {
    const exitCode = await Promise.race([
      preview.process.exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
    ]);
    if (exitCode !== null) {
      console.error(`Preview exited: ${preview.relativePath} (${preview.port}), see ${preview.logPath}`);
    }
  }

  await shutdown();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
