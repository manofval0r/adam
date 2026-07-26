import { describe, expect, it } from "vitest";
import { parseBranchStatusLine, parseGitStatusOutput } from "../src/git.js";

describe("git parsing", () => {
  it("parses branch tracking status with ahead/behind counts", () => {
    const parsed = parseBranchStatusLine("## main...origin/main [ahead 2, behind 1]");
    expect(parsed.branch).toBe("main");
    expect(parsed.remoteBranch).toBe("origin/main");
    expect(parsed.aheadBy).toBe(2);
    expect(parsed.behindBy).toBe(1);
  });

  it("parses git status output and dirty file count", () => {
    const snapshot = parseGitStatusOutput(["## main...origin/main [ahead 1]", " M src/main.ts", "?? src/new.ts"].join("\n"));
    expect(snapshot.available).toBe(true);
    expect(snapshot.branch).toBe("main");
    expect(snapshot.aheadBy).toBe(1);
    expect(snapshot.dirtyFileCount).toBe(2);
  });
});
