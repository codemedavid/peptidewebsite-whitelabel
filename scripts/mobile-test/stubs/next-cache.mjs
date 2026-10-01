// Test stub for next/cache: no data cache, so every read hits the (PGlite) DB.
globalThis.__revalidated = globalThis.__revalidated ?? [];
export const unstable_cache = (fn) => fn;
export const revalidateTag = (tag) => globalThis.__revalidated.push(tag);
export const revalidatePath = (path) => globalThis.__revalidated.push(path);
