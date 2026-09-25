// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ReturnItemsDialog } from "@/components/sales/ReturnItemsDialog";
import { returnSaleItemsAction } from "@/lib/actions/sale.actions";

vi.mock("@/lib/actions/sale.actions", () => ({
  returnSaleItemsAction: vi.fn(),
}));

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const items = [
  { id: "item-1", productName: "Widget A", sku: "WID-A", quantity: 5, returnedQuantity: 0 },
  { id: "item-2", productName: "Widget B", sku: "WID-B", quantity: 3, returnedQuantity: 1 },
];

describe("ReturnItemsDialog", () => {
  it("shows each line's sold quantity and remaining-returnable amount", () => {
    render(<ReturnItemsDialog saleId="sale-1" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /return items/i }));
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.getByText(/remaining: 2/i)).toBeInTheDocument(); // item-2: 3 - 1
  });

  it("disables Confirm when no line has a non-zero quantity entered", () => {
    render(<ReturnItemsDialog saleId="sale-1" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /return items/i }));
    expect(screen.getByRole("button", { name: /confirm return/i })).toBeDisabled();
  });

  it("submits only the non-zero lines to returnSaleItemsAction", async () => {
    vi.mocked(returnSaleItemsAction).mockResolvedValue({ ok: true });
    render(<ReturnItemsDialog saleId="sale-1" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /return items/i }));

    const qtyInputs = screen.getAllByRole("spinbutton");
    fireEvent.change(qtyInputs[0], { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: /confirm return/i }));

    await waitFor(() =>
      expect(returnSaleItemsAction).toHaveBeenCalledWith({
        saleId: "sale-1",
        items: [{ saleItemId: "item-1", quantity: 2 }],
      })
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("does not allow a quantity input above the remaining amount", () => {
    render(<ReturnItemsDialog saleId="sale-1" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /return items/i }));
    const qtyInputs = screen.getAllByRole("spinbutton");
    expect(qtyInputs[1]).toHaveAttribute("max", "2"); // item-2's remaining
  });
});
