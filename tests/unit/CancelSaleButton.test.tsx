// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CancelSaleButton } from "@/components/sales/CancelSaleButton";
import { cancelSaleAction } from "@/lib/actions/sale.actions";

vi.mock("@/lib/actions/sale.actions", () => ({
  cancelSaleAction: vi.fn(),
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CancelSaleButton", () => {
  it("shows a confirm step before calling the action", () => {
    render(<CancelSaleButton saleId="sale-1" />);
    fireEvent.click(screen.getByRole("button", { name: /cancel sale/i }));
    expect(cancelSaleAction).not.toHaveBeenCalled();
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
  });

  it("calls cancelSaleAction with the sale id on confirm and refreshes on success", async () => {
    vi.mocked(cancelSaleAction).mockResolvedValue({ ok: true });
    render(<CancelSaleButton saleId="sale-1" />);
    fireEvent.click(screen.getByRole("button", { name: /cancel sale/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(cancelSaleAction).toHaveBeenCalledWith({ saleId: "sale-1" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the error message on failure without refreshing", async () => {
    vi.mocked(cancelSaleAction).mockResolvedValue({ ok: false, error: "Sale cannot be cancelled" });
    render(<CancelSaleButton saleId="sale-1" />);
    fireEvent.click(screen.getByRole("button", { name: /cancel sale/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(screen.getByText("Sale cannot be cancelled")).toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
