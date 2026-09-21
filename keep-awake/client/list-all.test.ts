import assert from "node:assert/strict";
import { test } from "node:test";
import { collectAllPages } from "./list-all.js";

test("collectAllPages returns the first page without fetching more when hasMore is false", async () => {
  const entries = await collectAllPages(
    { entries: ["a", "b"], pageInfo: { hasMore: false, nextCursor: null } },
    async () => {
      throw new Error("fetchPage should not be called");
    },
  );
  assert.deepEqual(entries, ["a", "b"]);
});

test("collectAllPages follows the cursor across multiple pages", async () => {
  const cursorsSeen: string[] = [];
  const entries = await collectAllPages<string>(
    { entries: ["a"], pageInfo: { hasMore: true, nextCursor: "p2" } },
    async (cursor) => {
      cursorsSeen.push(cursor);
      if (cursor === "p2") {
        return { entries: ["b"], pageInfo: { hasMore: true, nextCursor: "p3" } };
      }
      return { entries: ["c"], pageInfo: { hasMore: false, nextCursor: null } };
    },
  );
  assert.deepEqual(entries, ["a", "b", "c"]);
  assert.deepEqual(cursorsSeen, ["p2", "p3"]);
});

test("collectAllPages stops if nextCursor is null even when hasMore is true", async () => {
  const entries = await collectAllPages(
    { entries: ["a"], pageInfo: { hasMore: true, nextCursor: null } },
    async () => {
      throw new Error("fetchPage should not be called");
    },
  );
  assert.deepEqual(entries, ["a"]);
});

test("collectAllPages preserves page order", async () => {
  const entries = await collectAllPages<number>(
    { entries: [1, 2], pageInfo: { hasMore: true, nextCursor: "next" } },
    async () => ({ entries: [3, 4], pageInfo: { hasMore: false, nextCursor: null } }),
  );
  assert.deepEqual(entries, [1, 2, 3, 4]);
});
