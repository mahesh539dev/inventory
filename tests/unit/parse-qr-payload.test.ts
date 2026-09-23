import { describe, it, expect } from "vitest";
import { parseQrPayload } from "@/lib/scan/parse-qr-payload";

describe("parseQrPayload", () => {
  it("extracts the identifier from a full absolute URL", () => {
    expect(parseQrPayload("https://inventory.example.com/p/abc123")).toEqual({
      publicIdentifier: "abc123",
    });
  });

  it("extracts the identifier from a URL with a trailing slash", () => {
    expect(parseQrPayload("https://inventory.example.com/p/abc123/")).toEqual({
      publicIdentifier: "abc123",
    });
  });

  it("extracts the identifier from a URL with query params", () => {
    expect(parseQrPayload("https://inventory.example.com/p/abc123?ref=sticker")).toEqual({
      publicIdentifier: "abc123",
    });
  });

  it("extracts the identifier from a path-only string (no scheme/host)", () => {
    expect(parseQrPayload("/p/abc123")).toEqual({ publicIdentifier: "abc123" });
  });

  it("extracts the identifier from a bare identifier string", () => {
    expect(parseQrPayload("abc123")).toEqual({ publicIdentifier: "abc123" });
  });

  it("returns null for an unrelated URL", () => {
    expect(parseQrPayload("https://example.com/some/other/path")).toBeNull();
  });

  it("returns null for a wifi-config-style QR payload", () => {
    expect(parseQrPayload("WIFI:T:WPA;S:MyNetwork;P:password123;;")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseQrPayload("")).toBeNull();
  });

  it("returns null for whitespace-only text", () => {
    expect(parseQrPayload("   ")).toBeNull();
  });
});
