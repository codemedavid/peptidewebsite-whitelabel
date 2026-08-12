import assert from "node:assert";
import {
  fetchMcpImageAsset,
  isPrivateNetworkAddress,
  parseMcpDataImage,
  validatePublicMcpImageUrl,
} from "../src/lib/mcp/image-assets";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : error}`);
  }
}

const publicLookup = async () => [{ address: "93.184.216.34" }];

async function main() {
  console.log("MCP image assets");

  await check("accepts JPG data URLs and preserves the filename", () => {
    const file = parseMcpDataImage(
      { dataUrl: `data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`, fileName: "my vial.jpg" },
      "product image",
    );
    assert.equal(file?.mimeType, "image/jpeg");
    assert.equal(file?.bytes.toString(), "jpeg");
    assert.equal(file?.fileName, "my-vial.jpg");
  });

  await check("rejects unsupported image formats", () => {
    assert.throws(
      () => parseMcpDataImage(
        { dataBase64: Buffer.from("gif").toString("base64"), mimeType: "image/gif" },
        "hero image",
      ),
      /JPG, PNG, or WebP/,
    );
  });

  await check("rejects decoded images over 10 MB", () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    assert.throws(
      () => parseMcpDataImage({ dataBase64: oversized, mimeType: "image/png" }, "product image"),
      /oversized|10 MB/,
    );
  });

  await check("classifies local and private network addresses", () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.168.1.2", "::1", "fd00::1"]) {
      assert.equal(isPrivateNetworkAddress(address), true, address);
    }
    assert.equal(isPrivateNetworkAddress("93.184.216.34"), false);
    assert.equal(isPrivateNetworkAddress("2606:4700:4700::1111"), false);
  });

  await check("accepts public URLs and rejects hosts resolving privately", async () => {
    assert.equal(
      await validatePublicMcpImageUrl("https://images.example.com/vial.png", "product image", publicLookup),
      "https://images.example.com/vial.png",
    );
    await assert.rejects(
      () => validatePublicMcpImageUrl(
        "https://images.example.com/vial.png",
        "product image",
        async () => [{ address: "10.0.0.2" }],
      ),
      /Private or local/,
    );
  });

  await check("downloads a bounded public PNG", async () => {
    const file = await fetchMcpImageAsset(
      { url: "https://images.example.com/vial.png", fileName: "vial.png" },
      "product image",
      {
        lookup: publicLookup,
        fetch: (async () => new Response(Buffer.from("png"), {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "3" },
        })) as typeof fetch,
      },
    );
    assert.equal(file.mimeType, "image/png");
    assert.equal(file.bytes.toString(), "png");
  });

  await check("revalidates redirects and rejects private redirect targets", async () => {
    await assert.rejects(
      () => fetchMcpImageAsset(
        { url: "https://images.example.com/vial.png" },
        "hero image",
        {
          lookup: async (hostname) => [{ address: hostname === "private.example.com" ? "127.0.0.1" : "93.184.216.34" }],
          fetch: (async () => new Response(null, {
            status: 302,
            headers: { location: "http://private.example.com/secret.png" },
          })) as typeof fetch,
        },
      ),
      /Private or local/,
    );
  });

  if (failed) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\n${passed} passed`);
}

void main();
