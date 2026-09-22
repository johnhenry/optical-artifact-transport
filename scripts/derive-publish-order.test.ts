import { describe, expect, it } from "vitest";
import {
  computeBatches,
  readPublishablePackages,
} from "./derive-publish-order.mjs";

describe("computeBatches", () => {
  it("puts a package with no internal deps in batch 0", () => {
    const batches = computeBatches([{ name: "@x/a" }]);
    expect(batches).toEqual([["@x/a"]]);
  });

  it("puts a dependent package in a later batch than its dependency", () => {
    const batches = computeBatches([
      { name: "@x/a" },
      { name: "@x/b", dependencies: { "@x/a": "^1.0.0" } },
    ]);
    expect(batches).toEqual([["@x/a"], ["@x/b"]]);
  });

  it("groups independent packages into the same batch, sorted", () => {
    const batches = computeBatches([
      { name: "@x/root" },
      { name: "@x/zeta", dependencies: { "@x/root": "^1.0.0" } },
      { name: "@x/alpha", dependencies: { "@x/root": "^1.0.0" } },
    ]);
    expect(batches).toEqual([["@x/root"], ["@x/alpha", "@x/zeta"]]);
  });

  it("handles a 3-layer chain", () => {
    const batches = computeBatches([
      { name: "@x/c", dependencies: { "@x/b": "^1.0.0" } },
      { name: "@x/a" },
      { name: "@x/b", dependencies: { "@x/a": "^1.0.0" } },
    ]);
    expect(batches).toEqual([["@x/a"], ["@x/b"], ["@x/c"]]);
  });

  it("ignores dependencies on packages outside the workspace", () => {
    const batches = computeBatches([
      { name: "@x/a", dependencies: { "some-external-lib": "^2.0.0" } },
    ]);
    expect(batches).toEqual([["@x/a"]]);
  });

  it("considers devDependencies and peerDependencies too", () => {
    const batches = computeBatches([
      { name: "@x/a" },
      { name: "@x/b", devDependencies: { "@x/a": "^1.0.0" } },
      { name: "@x/c", peerDependencies: { "@x/a": "^1.0.0" } },
    ]);
    expect(batches).toEqual([["@x/a"], ["@x/b", "@x/c"]]);
  });

  it("throws on a cycle instead of silently misordering", () => {
    expect(() =>
      computeBatches([
        { name: "@x/a", dependencies: { "@x/b": "^1.0.0" } },
        { name: "@x/b", dependencies: { "@x/a": "^1.0.0" } },
      ]),
    ).toThrow(/cyclic or unresolved/);
  });
});

describe("readPublishablePackages against the real repo", () => {
  it("finds this repo's publishable oat-* packages and excludes the private example", async () => {
    const packages = await readPublishablePackages();
    const names = packages.map((p) => p.name).sort();

    expect(names).toEqual([
      "@johnhenry/oat-bootstrap",
      "@johnhenry/oat-protocol",
      "@johnhenry/oat-qr-fountain",
      "@johnhenry/oat-receiver",
      "@johnhenry/oat-sender",
      "@johnhenry/oat-sim",
      "@johnhenry/oat-ui",
    ]);
    expect(names).not.toContain("file-transfer-demo");
  });

  it("derives the same two-layer batching currently hardcoded in staggered-publish.sh", async () => {
    const packages = await readPublishablePackages();
    const batches = computeBatches(packages);

    expect(batches).toEqual([
      ["@johnhenry/oat-protocol", "@johnhenry/oat-qr-fountain"],
      [
        "@johnhenry/oat-bootstrap",
        "@johnhenry/oat-receiver",
        "@johnhenry/oat-sender",
        "@johnhenry/oat-sim",
        "@johnhenry/oat-ui",
      ],
    ]);
  });
});
