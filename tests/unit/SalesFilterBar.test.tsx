// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SalesFilterBar } from "@/components/sales/SalesFilterBar";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const products = [{ id: "prod-1", productName: "Widget A" }];
const users = [{ id: "user-1", name: "Alice" }];

describe("SalesFilterBar", () => {
  it("renders a text input, status select, product select, and user select", () => {
    render(<SalesFilterBar products={products} users={users} />);
    expect(screen.getByPlaceholderText(/sale number or sku/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/product/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/user/i)).toBeInTheDocument();
  });

  it("navigates with the query param on text submit, resetting page to 1", () => {
    render(<SalesFilterBar products={products} users={users} />);
    fireEvent.change(screen.getByPlaceholderText(/sale number or sku/i), { target: { value: "SALE-000001" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("q=SALE-000001"));
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("page=1"));
  });

  it("navigates with the status param when a status is selected", () => {
    render(<SalesFilterBar products={products} users={users} />);
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: "CANCELLED" } });
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("status=CANCELLED"));
  });
});
