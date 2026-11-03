import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as { version?: unknown };

if (typeof packageMetadata.version !== "string" || packageMetadata.version.length === 0) {
  throw new Error("@adam/daemon package.json must declare a non-empty version.");
}

export const DAEMON_VERSION = packageMetadata.version;
