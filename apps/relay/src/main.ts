import { createRelayServer } from "./server.js";
import { loadRelayConfig } from "./config.js";

async function start(): Promise<void> {
  const config = loadRelayConfig();
  const server = createRelayServer({ config });

  await server.listen({
    host: config.host,
    port: config.port
  });

  console.log(`adam-relay listening on ${config.host}:${config.port}`);
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`adam-relay error: ${message}`);
  process.exitCode = 1;
});
