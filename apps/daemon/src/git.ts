import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface ParsedGitBranchStatus {
  branch: string;
  remoteBranch?: string;
  aheadBy: number;
  behindBy: number;
}

export interface GitStatusSnapshot {
  available: boolean;
  branch?: string;
  remoteBranch?: string;
  aheadBy?: number;
  behindBy?: number;
  dirtyFileCount?: number;
  error?: string;
}

export function findRepoRoot(startingDirectory: string): string | null {
  let current = path.resolve(startingDirectory);

  while (true) {
    if (existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function parseBranchStatusLine(line: string): ParsedGitBranchStatus {
  const header = line.replace(/^##\s*/, "").trim();
  const [branchPartRaw, remoteAndTrackingRaw] = header.split("...");
  let branch = branchPartRaw?.trim() ?? "unknown";

  if (branch.startsWith("No commits yet on ")) {
    branch = branch.replace("No commits yet on ", "");
  } else if (branch === "HEAD (no branch)") {
    branch = "detached";
  }

  let remoteBranch: string | undefined;
  let aheadBy = 0;
  let behindBy = 0;

  if (remoteAndTrackingRaw) {
    const tracking = remoteAndTrackingRaw.trim();
    const trackingParts = tracking.split(" [");
    remoteBranch = trackingParts[0]?.trim() || undefined;
    const statusPart = trackingParts[1]?.replace("]", "") ?? "";

    const aheadMatch = statusPart.match(/ahead\s+(\d+)/);
    const behindMatch = statusPart.match(/behind\s+(\d+)/);

    if (aheadMatch?.[1]) {
      aheadBy = Number.parseInt(aheadMatch[1], 10);
    }
    if (behindMatch?.[1]) {
      behindBy = Number.parseInt(behindMatch[1], 10);
    }
  }

  const output: ParsedGitBranchStatus = {
    branch,
    aheadBy,
    behindBy
  };

  if (remoteBranch) {
    output.remoteBranch = remoteBranch;
  }

  return output;
}

export function parseGitStatusOutput(statusOutput: string): GitStatusSnapshot {
  const lines = statusOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { available: false, error: "git status returned no output" };
  }

  const firstLine = lines[0];
  if (!firstLine) {
    return { available: false, error: "git status returned no branch header" };
  }
  const branchInfo = parseBranchStatusLine(firstLine);
  const dirtyFileCount = Math.max(lines.length - 1, 0);

  const snapshot: GitStatusSnapshot = {
    available: true,
    branch: branchInfo.branch,
    aheadBy: branchInfo.aheadBy,
    behindBy: branchInfo.behindBy,
    dirtyFileCount
  };

  if (branchInfo.remoteBranch) {
    snapshot.remoteBranch = branchInfo.remoteBranch;
  }

  return snapshot;
}

export function getGitStatus(repoRoot: string): GitStatusSnapshot {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "status", "--porcelain=v1", "-b", "--untracked-files=normal"],
    {
      encoding: "utf8",
      timeout: 8_000
    }
  );

  if (result.error) {
    return {
      available: false,
      error: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      available: false,
      error: (result.stderr || result.stdout || "git status failed").trim()
    };
  }

  return parseGitStatusOutput(result.stdout);
}
