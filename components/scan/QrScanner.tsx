"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

type PermissionState = "requesting" | "granted" | "denied" | "unavailable";

type QrScannerProps = {
  onDecode: (text: string) => void;
  paused?: boolean;
};

// How long an identical decode is suppressed after it fires, to absorb the
// camera's own rapid internal re-scan (ZXing rescans roughly every ~500ms)
// without treating it as a deliberate second scan. Must be clearly longer
// than that internal interval so a single physical scan can never straddle
// the boundary and double-fire, but short enough that a deliberate re-scan
// of the same code a couple of seconds later isn't perceived as
// unresponsive (e.g. the /sell page scanning the same product twice in a
// row to add two units).
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
        if (last && last.text === text && Date.now() - last.decodedAt < REPEAT_DECODE_COOLDOWN_MS) {
          return;
        }
        lastDecodeRef.current = { text, decodedAt: Date.now() };
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
