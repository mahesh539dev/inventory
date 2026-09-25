// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { decodeFromVideoDeviceMock, stopContinuousDecodeMock, controlsStopMock } = vi.hoisted(() => ({
  decodeFromVideoDeviceMock: vi.fn(),
  stopContinuousDecodeMock: vi.fn(),
  controlsStopMock: vi.fn(),
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
    controlsStopMock.mockReset();
  });

  afterEach(() => {
    cleanup();
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
    decodeFromVideoDeviceMock.mockResolvedValue({ stop: controlsStopMock });

    render(<QrScanner onDecode={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("qr-video")).toBeInTheDocument());
  });

  it("stops the scan loop's controls on unmount, not just the camera stream", async () => {
    mockGetUserMedia(() =>
      Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)
    );
    decodeFromVideoDeviceMock.mockResolvedValue({ stop: controlsStopMock });

    const { unmount } = render(<QrScanner onDecode={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("qr-video")).toBeInTheDocument());

    unmount();

    expect(controlsStopMock).toHaveBeenCalledTimes(1);
    expect(stopContinuousDecodeMock).toHaveBeenCalledTimes(1);
  });

  it("calls onDecode with the decoded text", async () => {
    mockGetUserMedia(() =>
      Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)
    );
    const onDecode = vi.fn();
    decodeFromVideoDeviceMock.mockImplementation(
      async (_deviceId: string, _video: unknown, callback: (result: { getText: () => string } | undefined) => void) => {
        callback({ getText: () => "abc123" });
        return { stop: controlsStopMock };
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
        return { stop: controlsStopMock };
      }
    );

    render(<QrScanner onDecode={onDecode} />);

    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));
  });

  it("allows an identical decode again once the repeat-decode cooldown has elapsed", async () => {
    // Proves the time-based dedup's other half: unlike the old permanent,
    // identity-only dedup, the SAME decoded text must be allowed to fire
    // onDecode again once enough real time has passed — this is what lets a
    // consuming page (e.g. /sell) support scanning the same product's QR
    // code twice in a row to add two units. The first decode and the second
    // (post-cooldown) decode are delivered as two separate synchronous
    // callback invocations from the mocked decodeFromVideoDevice, with
    // vi.setSystemTime used to advance the clock past
    // REPEAT_DECODE_COOLDOWN_MS (1500ms) in between — mirroring how
    // tests/unit/sell.page.test.tsx mocks time for this same class of
    // cooldown (vi.useFakeTimers({ toFake: ["Date"] }) + vi.setSystemTime,
    // since the component reads Date.now() directly rather than scheduling
    // a timer).
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      mockGetUserMedia(() =>
        Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)
      );
      const onDecode = vi.fn();
      let callback!: (result: { getText: () => string } | undefined) => void;
      decodeFromVideoDeviceMock.mockImplementation(
        async (_deviceId: string, _video: unknown, cb: (result: { getText: () => string } | undefined) => void) => {
          callback = cb;
          callback({ getText: () => "abc123" });
          return { stop: controlsStopMock };
        }
      );

      render(<QrScanner onDecode={onDecode} />);

      await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1));

      // Advance past the 1500ms cooldown window via the faked Date clock.
      vi.setSystemTime(Date.now() + 1600);

      callback({ getText: () => "abc123" });

      await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(2));
      expect(onDecode).toHaveBeenNthCalledWith(1, "abc123");
      expect(onDecode).toHaveBeenNthCalledWith(2, "abc123");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires only once for a code held in frame across repeated ~500ms re-decodes", async () => {
    // Complement of the test above: a code that never leaves the camera's
    // view is re-decoded by ZXing roughly every ~500ms. Each of those
    // re-decodes must refresh the cooldown (sliding window), so the held
    // code never re-fires — even past the 1500ms mark measured from the
    // first (only) accepted decode.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      mockGetUserMedia(() =>
        Promise.resolve({ getTracks: () => [] } as unknown as MediaStream)
      );
      const onDecode = vi.fn();
      let callback!: (result: { getText: () => string } | undefined) => void;
      decodeFromVideoDeviceMock.mockImplementation(
        async (_deviceId: string, _video: unknown, cb: (result: { getText: () => string } | undefined) => void) => {
          callback = cb;
          return { stop: controlsStopMock };
        }
      );

      render(<QrScanner onDecode={onDecode} />);

      await waitFor(() => expect(screen.getByTestId("qr-video")).toBeInTheDocument());

      const start = Date.now();
      for (const offset of [0, 500, 1000, 1500, 2000]) {
        vi.setSystemTime(start + offset);
        callback({ getText: () => "abc123" });
      }

      expect(onDecode).toHaveBeenCalledTimes(1);
      expect(onDecode).toHaveBeenCalledWith("abc123");
    } finally {
      vi.useRealTimers();
    }
  });
});
