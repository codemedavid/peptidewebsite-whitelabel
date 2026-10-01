// Test stub for next/server: the REAL NextResponse, plus an after() that queues
// work so the test can flush it deterministically (globalThis.__flushAfter).
import { NextResponse } from "next/dist/server/web/spec-extension/response.js";

const queue = [];
export function after(task) {
  queue.push(task);
}
globalThis.__flushAfter = async () => {
  while (queue.length) {
    const task = queue.shift();
    await (typeof task === "function" ? task() : task);
  }
};
export { NextResponse };
