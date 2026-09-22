import { toBuffer } from "qrcode";

export function buildPublicProductUrl(publicIdentifier: string): string {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    throw new Error("APP_URL environment variable is not set");
  }
  return `${appUrl}/p/${publicIdentifier}`;
}

export async function generateQrPng(publicIdentifier: string): Promise<Buffer> {
  const targetUrl = buildPublicProductUrl(publicIdentifier);
  return toBuffer(targetUrl, { type: "png" });
}
