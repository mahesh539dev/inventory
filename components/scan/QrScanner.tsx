"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

type PermissionState = "requesting" | "granted" | "denied" | "unavailable";

type QrScannerProps = {
  onDecode: (text: string) => void;
  paused?: boolean;
};

export function QrScanner({ onDecode, paused = false }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastDecodedRef = useRef<string | null>(null);
  const [state, setState] = useState<PermissionState>("requesting");

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }

    const reader = new BrowserQRCodeReader();
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (cancelled || !result) return;
        const text = result.getText();
        if (text === lastDecodedRef.current) return;
        lastDecodedRef.current = text;
        onDecode(text);
      })
      .then(() => {
        if (!cancelled) setState("granted");
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
      BrowserQRCodeReader.releaseAllStreams();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDecode identity intentionally excluded; reader is set up once per mount
  }, []);

  useEffect(() => {
    if (!paused) lastDecodedRef.current = null;
  }, [paused]);

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
