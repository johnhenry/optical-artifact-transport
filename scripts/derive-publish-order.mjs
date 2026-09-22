#!/usr/bin/env node
// Derives the npm-publish batch order for this monorepo's publishable
// workspace packages from their actual `dependencies` on each other,
// instead of a hardcoded list. A hardcoded batch order silently rots when
// the dependency graph changes (a package added, or an existing package's
// internal deps change) -- the same failure mode math-plus hit in its own
// hand-rolled JSR-publish loop (issue #47 there): the hardcoded loop was
// missing packages that had since been added and nothing caught it until
// a real publish run.
//
// A "batch" here is a topological layer: every package in batch N depends
// (directly, among this repo's own @johnhenry/oat-* packages) only on
// packages already published in batches < N, so publishing strictly in
// batch order always satisfies npm's own resolution needs at publish time.
// Packages within a batch have no dependency relationship to each other
// and are sorted alphabetically for a deterministic, readable order.
//
// Usage:
//   node scripts/derive-publish-order.mjs
//     Prints one batch per line, package names space-separated, in
//     publish order -- consumed directly by staggered-publish.sh.
//
//   import { computeBatches, readPublishablePackages } from "./derive-publish-order.mjs"
//     For tests / other programmatic use.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Topologically sorts packages into publish-order layers based on which of
 * this repo's own packages appear in each package's dependencies (regular,
 * dev, or peer -- any of the three would make publish order matter).
 *
 * @param {Array<{name: string, dependencies?: Record<string,string>, devDependencies?: Record<string,string>, peerDependencies?: Record<string,string>}>} packages
 * @returns {string[][]} batches, in publish order (batch 0 first)
 */
export function computeBatches(packages) {
  const names = new Set(packages.map((p) => p.name));
  const internalDeps = new Map(
    packages.map((p) => [
      p.name,
      new Set(
        Object.keys({
          ...p.dependencies,
          ...p.devDependencies,
          ...p.peerDependencies,
        }).filter((dep) => names.has(dep) && dep !== p.name),
      ),
    ]),
  );

  const remaining = new Set(names);
  const batches = [];

  while (remaining.size > 0) {
    const layer = [...remaining]
      .filter((name) =>
        [...internalDeps.get(name)].every((dep) => !remaining.has(dep)),
      )
      .sort();

    if (layer.length === 0) {
      // Every remaining package still depends on another remaining
      // package -- a cycle among this repo's own packages (or a
      // dependency on a package that doesn't exist in the workspace at
      // all, which would otherwise loop forever). Fail loudly rather
      // than publish in a broken order.
      throw new Error(
        `optical-artifact-transport: cannot derive a publish order -- cyclic or unresolved internal dependency among: ${[...remaining].sort().join(", ")}`,
      );
    }

    batches.push(layer);
    for (const name of layer) remaining.delete(name);
  }

  return batches;
}

/**
 * Reads every non-private workspace package's package.json, in the shape
 * computeBatches() expects. Workspace entries may be literal directories
 * (as this repo currently declares) or a trailing `/*` glob.
 *
 * @param {string} [rootDir]
 */
export async function readPublishablePackages(rootDir = ROOT) {
  const rootPkg = JSON.parse(
    await readFile(join(rootDir, "package.json"), "utf8"),
  );
  const workspaceEntries = rootPkg.workspaces ?? [];

  const dirs = [];
  for (const entry of workspaceEntries) {
    if (entry.endsWith("/*")) {
      const base = entry.slice(0, -2);
      const children = await readdir(join(rootDir, base), {
        withFileTypes: true,
      });
      for (const child of children) {
        if (child.isDirectory()) dirs.push(join(base, child.name));
      }
    } else {
      dirs.push(entry);
    }
  }

  const packages = [];
  for (const dir of dirs) {
    let pkg;
    try {
      pkg = JSON.parse(
        await readFile(join(rootDir, dir, "package.json"), "utf8"),
      );
    } catch {
      continue; // not a package (missing/unreadable package.json)
    }
    if (pkg.private) continue; // e.g. examples/file-transfer, never published
    packages.push(pkg);
  }
  return packages;
}

async function main() {
  const packages = await readPublishablePackages();
  const batches = computeBatches(packages);
  for (const batch of batches) {
    console.log(batch.join(" "));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
