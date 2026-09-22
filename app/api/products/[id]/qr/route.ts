import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { findProductById } from "@/lib/repositories/product.repo";
import { generateQrPng } from "@/lib/services/qr.service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireUser();

  const { id } = await params;
  const product = await findProductById(id);
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const png = await generateQrPng(product.publicIdentifier);
  const isDownload = new URL(request.url).searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": isDownload
        ? `attachment; filename="${product.sku}-qr.png"`
        : "inline",
      "Cache-Control": "no-store",
    },
  });
}
