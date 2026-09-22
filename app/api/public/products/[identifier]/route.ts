import { NextResponse } from "next/server";
import { findPublicProductView } from "@/lib/repositories/product.repo";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params;
  const view = await findPublicProductView(identifier);

  if (!view) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json(view);
}
