"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

type PermissionState = "requesting" | "granted" | "denied" | "unavailable";

type QrScannerProps = {
  onDecode: (text: string) => void;
  paused?: boolean;
};

// Sliding-window dedup for identical decodes. While a code stays in the
// camera's view, ZXing re-decodes it roughly every ~500ms. Every sighting of
// the same text — including ones that are suppressed — refreshes the
// timestamp, so a held code never re-fires no matter how long it stays in
// frame. The same text only counts as a new scan once it has been OUT of
// frame (no decodes of it) for at least this long. Must be clearly longer
// than ZXing's internal re-decode interval so consecutive in-frame sightings
// always fall inside the window, but short enough that a deliberate re-scan
// (move the code away, then show it again) isn't perceived as unresponsive
// (e.g. the /sell page scanning the same product twice in a row to add two
// units).
const REPEAT_DECODE_COOLDOWN_MS = 1500;

// `paused` is kept in the prop type for backward compatibility with
// existing callers (e.g. app/(app)/scan/page.tsx) but is no longer
// destructured/used here — it has no effect now that repeat-decode dedup
// is time-based rather than paused-toggle-based (see
// REPEAT_DECODE_COOLDOWN_MS above).
export function QrScanner({ onDecode }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastDecodeRef = useRef<{ text: string; decodedAt: number } | null>(null);
  const [state, setState] = useState<PermissionState>("requesting");

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }

    const reader = new BrowserQRCodeReader();
    let cancelled = false;
    let controls: { stop: () => void } | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (cancelled || !result) return;
        const text = result.getText();
        const last = lastDecodeRef.current;
        const now = Date.now();
        // Always record this sighting (sliding window), whether or not it fires.
        lastDecodeRef.current = { text, decodedAt: now };
        if (last && last.text === text && now - last.decodedAt < REPEAT_DECODE_COOLDOWN_MS) {
          return;
        }
        onDecode(text);
      })
      .then((scannerControls) => {
        if (cancelled) {
          scannerControls.stop();
          return;
        }
        controls = scannerControls;
        setState("granted");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setState("denied");
        } else {
          setState("unavailable");
        }
      });

    return () => {
      cancelled = true;
      controls?.stop();
      BrowserQRCodeReader.releaseAllStreams();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDecode identity intentionally excluded; reader is set up once per mount
  }, []);

  if (state === "denied") {
    return (
      <p role="alert" className="text-sm text-destructive">
        Camera access is required to scan QR codes. Please enable camera
        access in your browser settings.
      </p>
    );
  }

  if (state === "unavailable") {
    return <p role="alert" className="text-sm text-destructive">No camera detected on this device.</p>;
  }

  return (
    <video
      ref={videoRef}
      data-testid="qr-video"
      className="w-full rounded-md border"
      muted
      playsInline
    />
  );
}
