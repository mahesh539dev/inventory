import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildPublicProductUrl, generateQrPng } from "@/lib/services/qr.service";

const ORIGINAL_APP_URL = process.env.APP_URL;

describe("buildPublicProductUrl", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://inventory.example.com";
  });

  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  it("builds the public product URL from APP_URL and the identifier", () => {
    expect(buildPublicProductUrl("abc123")).toBe("https://inventory.example.com/p/abc123");
  });

  it("throws when APP_URL is not set", () => {
    delete process.env.APP_URL;
    expect(() => buildPublicProductUrl("abc123")).toThrow("APP_URL environment variable is not set");
  });
});

describe("generateQrPng", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://inventory.example.com";
  });

  afterEach(() => {
    process.env.APP_URL = ORIGINAL_APP_URL;
  });

  it("returns a non-empty PNG buffer", async () => {
    const buffer = await generateQrPng("abc123");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // PNG magic bytes: 0x89 'P' 'N' 'G' '\r' '\n' 0x1A '\n'
    expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("produces different bytes for different identifiers", async () => {
    const bufferA = await generateQrPng("identifier-a");
    const bufferB = await generateQrPng("identifier-b");
    expect(bufferA.equals(bufferB)).toBe(false);
  });
});
