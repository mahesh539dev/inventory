// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

let capturedOnDecode: ((text: string) => void) | null = null;

vi.mock("@/components/scan/QrScanner", () => ({
  QrScanner: ({ onDecode }: { onDecode: (text: string) => void }) => {
    capturedOnDecode = onDecode;
    return <div data-testid="qr-scanner-stub" />;
  },
}));

vi.mock("@/lib/actions/scan.actions", () => ({
  resolveProductForScan: vi.fn(),
}));

import { resolveProductForScan } from "@/lib/actions/scan.actions";
import ScanPage from "@/app/(app)/scan/page";

describe("ScanPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(resolveProductForScan).mockReset();
    capturedOnDecode = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the QR scanner and a manual SKU fallback form", () => {
    render(<ScanPage />);

    expect(screen.getByTestId("qr-scanner-stub")).toBeInTheDocument();
    expect(screen.getByLabelText(/sku/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /find product/i })).toBeInTheDocument();
  });

  it("navigates to the product page when a decoded QR resolves", async () => {
    vi.mocked(resolveProductForScan).mockResolvedValue({ id: "prod-1" });
    render(<ScanPage />);

    capturedOnDecode!("https://example.com/p/abc123");

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/products/prod-1"));
    expect(resolveProductForScan).toHaveBeenCalledWith({ publicIdentifier: "abc123" });
  });

  it("shows an inline error and does not navigate for an unrecognized QR payload", async () => {
    render(<ScanPage />);

    capturedOnDecode!("WIFI:T:WPA;S:MyNetwork;P:secret;;");

    await waitFor(() =>
      expect(screen.getByText("Not a recognized product QR code")).toBeInTheDocument()
    );
    expect(resolveProductForScan).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows an inline error when the decoded identifier matches no product", async () => {
    vi.mocked(resolveProductForScan).mockResolvedValue(null);
    render(<ScanPage />);

    capturedOnDecode!("https://example.com/p/does-not-exist");

    await waitFor(() =>
      expect(
        screen.getByText("Product not found — it may have been removed or its QR code regenerated.")
      ).toBeInTheDocument()
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to the product page on successful manual SKU submit", async () => {
    vi.mocked(resolveProductForScan).mockResolvedValue({ id: "prod-2" });
    render(<ScanPage />);

    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "SKU-123" } });
    fireEvent.click(screen.getByRole("button", { name: /find product/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/products/prod-2"));
    expect(resolveProductForScan).toHaveBeenCalledWith({ sku: "SKU-123" });
  });

  it("shows an inline error when manual SKU submit matches no product", async () => {
    vi.mocked(resolveProductForScan).mockResolvedValue(null);
    render(<ScanPage />);

    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "NOPE" } });
    fireEvent.click(screen.getByRole("button", { name: /find product/i }));

    await waitFor(() =>
      expect(
        screen.getByText("Product not found — it may have been removed or its QR code regenerated.")
      ).toBeInTheDocument()
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only manual SKU without calling the server action", () => {
    render(<ScanPage />);

    fireEvent.change(screen.getByLabelText(/sku/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /find product/i }));

    expect(resolveProductForScan).not.toHaveBeenCalled();
  });
});
