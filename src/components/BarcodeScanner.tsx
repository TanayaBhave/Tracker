// Full-screen barcode scanner for 365-brand/UPC lookup (workstream W4, Phase 3).
// Camera is only requested once this component mounts, i.e. behind an explicit
// tap in MealSheet — never on app load — so iOS only prompts for camera
// permission when the parent actually means to scan.
//
// zxing-wasm's reader subpath is dynamically imported so its ~1MB wasm loader
// never lands in the main bundle; the .wasm binary itself is imported via
// Vite's `?url` asset pipeline (see the wasm import below) so it's served from
// this app's own build (and precached by the PWA service worker — see
// vite.config.ts's workbox globPatterns) instead of zxing-wasm's default
// jsDelivr CDN fallback, keeping the scanner usable offline after first load.
import { useEffect, useRef, useState } from 'react';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { readBarcodes as ReadBarcodesFn } from 'zxing-wasm/reader';

type Props = { onScan: (upc: string) => void; onClose: () => void };

const SCAN_INTERVAL_MS = 300;
const BARCODE_FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE'] as const;

// Module-level so the locateFile override is only registered once per page
// load, even if the scanner is opened/closed repeatedly.
let wasmPrepared = false;

export function BarcodeScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const readBarcodesRef = useRef<typeof ReadBarcodesFn | undefined>(undefined);
  const scanningRef = useRef(false); // true while a decode is in flight — skips overlapping ticks
  const stoppedRef = useRef(false); // set on close/unmount so a late decode never fires onScan after teardown
  const [status, setStatus] = useState<'requesting' | 'live' | 'denied' | 'error'>('requesting');
  const [errorMsg, setErrorMsg] = useState<string>();

  useEffect(() => {
    let intervalId: number | undefined;
    const canvas = document.createElement('canvas');

    async function tick() {
      if (scanningRef.current || stoppedRef.current) return;
      const video = videoRef.current;
      const readBarcodes = readBarcodesRef.current;
      if (!video || !readBarcodes || video.readyState < 2 || video.videoWidth === 0) return;
      scanningRef.current = true;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const results = await readBarcodes(imageData, {
          formats: [...BARCODE_FORMATS],
          tryHarder: true,
          maxNumberOfSymbols: 1,
        });
        const hit = results.find((r) => r.isValid && r.text.trim());
        if (hit && !stoppedRef.current) {
          stoppedRef.current = true;
          onScan(hit.text.trim());
        }
      } catch {
        // Transient decode errors are expected on frames without a clean, in-focus
        // barcode — just keep scanning on the next tick.
      } finally {
        scanningRef.current = false;
      }
    }

    async function start() {
      try {
        const zxing = await import('zxing-wasm/reader');
        if (!wasmPrepared) {
          wasmPrepared = true;
          zxing.prepareZXingModule({
            overrides: {
              locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + path),
            },
          });
        }
        readBarcodesRef.current = zxing.readBarcodes;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (stoppedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus('live');
        intervalId = window.setInterval(() => { void tick(); }, SCAN_INTERVAL_MS);
      } catch (err) {
        setStatus(err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }

    void start();
    return () => {
      stoppedRef.current = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [onScan]);

  function handleClose() {
    stoppedRef.current = true;
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: '#000',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div style={{
        position: 'relative', width: '78%', maxWidth: 360, aspectRatio: '16 / 9',
        border: '3px solid rgba(255,255,255,0.85)', borderRadius: 16,
        boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)',
      }}
      />
      <div style={{
        position: 'absolute', top: 'calc(env(safe-area-inset-top) + 16px)', left: 0, right: 0,
        textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: 600, padding: '0 24px',
      }}
      >
        {status === 'requesting' && 'Requesting camera…'}
        {status === 'live' && 'Point the camera at a barcode'}
        {status === 'denied' && 'Camera access was denied. Enable it in Settings > Safari to scan.'}
        {status === 'error' && `Camera error${errorMsg ? `: ${errorMsg}` : ''}`}
      </div>
      <button
        type="button"
        onClick={handleClose}
        style={{
          position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom) + 24px)',
          minHeight: 'var(--tap)', padding: '12px 28px', borderRadius: 999,
          background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: 16, fontWeight: 600,
        }}
      >
        Cancel
      </button>
    </div>
  );
}
