import { gatherDaemonHealth } from "./health.js";
import { runDaemonOnce } from "./daemon.js";
import { runRelayWorkerOnce } from "./prompt-worker.js";
import { loadDaemonConfig } from "./config.js";

interface CliFlags {
  json: boolean;
  cwd?: string;
  once: boolean;
}

function parseFlags(args: string[]): CliFlags {
  const flags: CliFlags = { json: false, once: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      flags.json = true;
      continue;
    }
    if (arg === "--cwd") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --cwd");
      }
      flags.cwd = value;
      index += 1;
      continue;
    }
    if (arg === "--once") {
      flags.once = true;
    }
  }

  return flags;
}

function printHelp(): void {
  console.log(
    [
      "Adam Daemon (Milestone 1)",
      "",
      "Usage:",
      "  adam-daemon health [--json] [--cwd <path>]",
      "  adam-daemon start [--json] [--cwd <path>] [--once]",
      "  adam-daemon relay-once [--json] [--cwd <path>]",
      "",
      "Commands:",
      "  health   Show daemon health snapshot (repo, git, codex, latest session).",
      "  start    Run daemon cycle, then continue relay polling unless --once is used.",
      "  relay-once  Send heartbeat, pull queued prompts, run Codex, and report prompt states."
    ].join("\n")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHealthHuman(snapshot: ReturnType<typeof gatherDaemonHealth>["snapshot"]): void {
  console.log(`Status: ${snapshot.status}`);
  console.log(`Generated: ${snapshot.generatedAt}`);
  console.log(`CWD: ${snapshot.cwd}`);
  console.log(`Repo: ${snapshot.projectRoot ?? "not detected"}`);

  if (snapshot.git.available) {
    console.log(
      `Git: branch=${snapshot.git.branch} dirty=${snapshot.git.dirtyFileCount} ahead=${snapshot.git.aheadBy} behind=${snapshot.git.behindBy}`
    );
  } else {
    console.log(`Git: unavailable (${snapshot.git.error ?? "unknown"})`);
  }

  if (snapshot.codex.available) {
    console.log(`Codex: available (${snapshot.codex.version ?? "version unknown"})`);
  } else {
    console.log(`Codex: unavailable (${snapshot.codex.error ?? "unknown"})`);
  }

  if (snapshot.codex.latestSession) {
    console.log(`Latest Codex session: ${snapshot.codex.latestSession.sessionId}`);
    console.log(`Session file: ${snapshot.codex.latestSession.filePath}`);
  } else {
    console.log("Latest Codex session: not found");
  }
}

async function run(): Promise<void> {
  const [commandRaw, ...rest] = process.argv.slice(2);
  const command = commandRaw ?? "health";

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  const flags = parseFlags(rest);
  const cwd = flags.cwd ?? process.cwd();

  if (command === "health") {
    const { snapshot } = gatherDaemonHealth(cwd);
    if (flags.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      printHealthHuman(snapshot);
    }
    return;
  }

  if (command === "start") {
    const result = runDaemonOnce(cwd);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Session: ${result.sessionId}`);
      console.log(`Emitted events: ${result.emittedEvents}`);
      console.log(`Event log: ${result.logPath}`);
      console.log(`Health status: ${result.healthStatus}`);
    }

    if (flags.once) {
      return;
    }

    const config = loadDaemonConfig(cwd);
    if (!config.relayBaseUrl || !config.relayDeviceToken) {
      if (!flags.json) {
        console.log("Relay polling skipped (relayBaseUrl/deviceToken not configured).");
      }
      return;
    }

    while (true) {
      try {
        const workerResult = await runRelayWorkerOnce(cwd);
        if (!flags.json) {
          console.log(
            `Relay poll: status=${workerResult.status} fetched=${workerResult.promptsFetched} ack=${workerResult.promptsAcknowledged} failed=${workerResult.promptsFailed}`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`adam-daemon relay error: ${message}`);
      }
      await sleep(config.relayPollIntervalMs);
    }

    return;
  }

  if (command === "relay-once") {
    const result = await runRelayWorkerOnce(cwd);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Status: ${result.status}`);
      console.log(`Prompts fetched: ${result.promptsFetched}`);
      console.log(`Prompts acknowledged: ${result.promptsAcknowledged}`);
      console.log(`Prompts failed: ${result.promptsFailed}`);
    }
    return;
  }

  throw new Error(`Unknown command '${command}'. Use --help for usage.`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`adam-daemon error: ${message}`);
  process.exitCode = 1;
});
