import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "README.md",
  "docs/master-plan.md",
  "docs/mvp-plan.md",
  "docs/event-schema.md",
  "docs/adapter-contract.md",
  "docs/architecture-decisions.md",
  "docs/legal-safety-risk-register.md",
  "docs/integration-surface-research.md",
  "docs/continuous-checklist.md",
  "docs/changelog.md",
];

const errors = [];

function toDisplayPath(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function lineAndColumn(content, index) {
  const before = content.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function targetExists(sourceFile, href) {
  const withoutAnchor = href.split("#")[0];
  if (!withoutAnchor) {
    return true;
  }

  const decoded = decodeURIComponent(withoutAnchor);
  const absolute = path.resolve(path.dirname(sourceFile), decoded);
  return existsSync(absolute);
}

for (const requiredFile of requiredFiles) {
  if (!existsSync(path.join(root, requiredFile))) {
    errors.push(`Missing required file: ${requiredFile}`);
  }
}

const markdownFiles = walk(root).filter((file) => file.endsWith(".md"));

for (const file of markdownFiles) {
  const displayPath = toDisplayPath(file);
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);

  if (!content.endsWith("\n")) {
    errors.push(`${displayPath}: file must end with a newline`);
  }

  if (content.endsWith("\n\n")) {
    errors.push(`${displayPath}: file must not end with multiple blank lines`);
  }

  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      errors.push(`${displayPath}:${index + 1}: trailing whitespace`);
    }
  });

  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const href = match[1].trim();
    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:") ||
      href.startsWith("#")
    ) {
      continue;
    }

    if (!targetExists(file, href)) {
      const location = lineAndColumn(content, match.index);
      errors.push(`${displayPath}:${location.line}:${location.column}: broken local link '${href}'`);
    }
  }
}

const emptyMarkdownFiles = markdownFiles.filter((file) => statSync(file).size === 0);
for (const file of emptyMarkdownFiles) {
  errors.push(`${toDisplayPath(file)}: markdown file is empty`);
}

if (errors.length > 0) {
  console.error("Documentation health check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}
console.log(`Documentation health check passed for ${markdownFiles.length} markdown files.`);
console.log(`Documentation health check passed for ${markdownFiles.length} markdown files.`);
