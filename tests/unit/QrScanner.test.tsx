// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { decodeFromVideoDeviceMock, stopContinuousDecodeMock } = vi.hoisted(() => ({
  decodeFromVideoDeviceMock: vi.fn(),
  stopContinuousDecodeMock: vi.fn(),
}));

vi.mock("@zxing/browser", () => {
  class BrowserQRCodeReader {
    decodeFromVideoDevice = decodeFromVideoDeviceMock;
    static releaseAllStreams = stopContinuousDecodeMock;
  }
  return { BrowserQRCodeReader };
});

import { QrScanner } from "@/components/scan/QrScanner";

function mockGetUserMedia(behavior: () => Promise<MediaStream>) {
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(behavior) },
  });
}

describe("QrScanner", () => {
  beforeEach(() => {
    decodeFromVideoDeviceMock.mockReset();
    stopContinuousDecodeMock.mockReset();
  });

  afterEach(() => {
    // @ts-expect-error -- test cleanup of a property we defined per-test
    delete window.navigator.mediaDevices;
  });

  it("shows the denied message when getUserMedia rejects with NotAllowedError", async () => {
    mockGetUserMedia(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    decodeFromVideoDeviceMock.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    render(<QrScanner onDecode={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Camera access is required to scan QR codes. Please enable camera access in your browser settings."
        )
      ).toBeInTheDocument()
    );
  });

  it("shows the no-camera message when getUserMedia rejects with NotFoundError", async () => {
    mockGetUserMedia(() => Promise.reject(new DOMException("no device", "NotFoundError")));
    decodeFromVideoDeviceMock.mockRejectedValue(new DOMException("no device", "NotFoundError"));

    render(<QrScanner onDecode={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("No camera detected on this device.")).toBeInTheDocument()
    );
  });

  it("renders the video viewfinder once permission is granted", async () => {
    mockGetUserMedia(() =>
      Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)
    );
    decodeFromVideoDeviceMock.mockResolvedValue(undefined);

    render(<QrScanner onDecode={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("qr-video")).toBeInTheDocument());
  });

  it("calls onDecode with the decoded text", async () => {
    mockGetUserMedia(() =>
      Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)
    );
    const onDecode = vi.fn();
    decodeFromVideoDeviceMock.mockImplementation(
      async (_deviceId: string, _video: unknown, callback: (result: { getText: () => string } | undefined) => void) => {
        callback({ getText: () => "abc123" });
        return undefined;
      }
    );

    render(<QrScanner onDecode={onDecode} />);

    await waitFor(() => expect(onDecode).toHaveBeenCalledWith("abc123"));
  });

  it("ignores an identical repeat decode of the same code", async () => {
    mockGetUserMedia(() =>
      Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)
    );
    const onDecode = vi.fn();
    decodeFromVideoDeviceMock.mockImplementation(
      async (_deviceId: string, _video: unknown, callback: (result: { getText: () => string } | undefined) => void) => {
        callback({ getText: () => "abc123" });
        callback({ getText: () => "abc123" });
        return undefined;
      }
    );

    render(<QrScanner onDecode={onDecode} />);

    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));
  });
});
