import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function exampleKeys(contents: string): Set<string> {
  return new Set(
    contents
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );
}

function composeVariables(contents: string): Set<string> {
  return new Set([...contents.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]!));
}

const legacyCompatibilityVariables = new Set(["AUTH_MODE", "SSO_TRUST_PROXY_HEADERS"]);

describe("environment examples", () => {
  test.each([
    [".env.example", "docker-compose.prod.yml"],
    [".env.dockerhub.example", "docker-compose.hub.yml"],
  ])("%s documents every supported variable in %s", (examplePath, composePath) => {
    const documented = exampleKeys(read(examplePath));
    const used = composeVariables(read(composePath));
    const missing = [...used]
      .filter((key) => !legacyCompatibilityVariables.has(key) && !documented.has(key))
      .sort();

    expect(missing).toEqual([]);
  });
});
