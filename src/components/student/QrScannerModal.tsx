import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  AlertCircle,
  Camera,
  ImageUp,
  Keyboard,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { apiRequest } from '../../services/api.ts';
import type { PublicSessionDTO } from '../../../shared/types.ts';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onVerified: (session: PublicSessionDTO) => void;
  onSwitchToCode: () => void;
}

export function QrScannerModal({
  open,
  onClose,
  onVerified,
  onSwitchToCode,
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const verifyingRef = useRef(false);

  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'active' | 'denied' | 'unavailable'>('idle');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const verifyPayload = useCallback(
    async (rawPayload: string) => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      setVerifying(true);
      setError(null);
      try {
        const res = await apiRequest<{ session: PublicSessionDTO }>('/sessions/verify-qr', {
          method: 'POST',
          body: { payload: rawPayload },
        });
        stopCamera();
        onVerified(res.session);
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : 'QR verification failed. Please scan the latest QR or enter the 6-digit code.'
        );
      } finally {
        setVerifying(false);
        verifyingRef.current = false;
      }
    },
    [onVerified, stopCamera]
  );

  const scanLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA && !verifyingRef.current) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (decoded?.data) {
          void verifyPayload(decoded.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanLoop);
  }, [verifyPayload]);

  const startCamera = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      return;
    }

    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('active');
      rafRef.current = requestAnimationFrame(scanLoop);
    } catch (err: unknown) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setCameraState('denied');
      } else {
        setCameraState('unavailable');
      }
    }
  }, [scanLoop]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setCameraState('idle');
      setError(null);
      return;
    }
    void startCamera();
    return () => {
      stopCamera();
    };
  }, [open, startCamera, stopCamera]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);
    setVerifying(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Unable to process uploaded image.');
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(imgData.data, imgData.width, imgData.height);
      if (!decoded?.data) {
        setError('No readable QR code was detected in that image. Try a clearer screenshot or enter the 6-digit code.');
        setVerifying(false);
        return;
      }
      setVerifying(false);
      await verifyPayload(decoded.data);
    } catch (err: unknown) {
      setVerifying(false);
      setError(err instanceof Error ? err.message : 'Unable to decode QR image.');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#141033]/50 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-scanner-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              stopCamera();
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg rounded-[30px] tp-modal-glass overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#17143A]/8">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#6334E8]/12 text-[#6334E8] flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </div>
                <h2 id="qr-scanner-title" className="font-display font-bold text-lg text-[#17143A]">
                  Scan Official Session QR
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onClose();
                }}
                aria-label="Close QR scanner"
                className="p-2 rounded-xl text-[#5B617A] hover:text-[#17143A] hover:bg-white/80 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-2xl bg-rose-50/90 border border-rose-200 p-3.5 text-sm text-rose-800"
                >
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p>{error}</p>
                    {cameraState === 'active' && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          rafRef.current = requestAnimationFrame(scanLoop);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-900 underline cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Resume scanning
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-[#17143A] flex items-center justify-center ring-1 ring-white/20">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraState === 'active' ? 'opacity-100' : 'opacity-0'}`}
                />
                <canvas ref={canvasRef} className="hidden" />

                {cameraState === 'active' && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-52 h-52 rounded-2xl relative shadow-[0_0_0_9999px_rgba(20,16,51,0.48)]">
                      <span className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-[3px] border-l-[3px] border-white rounded-tl-xl" />
                      <span className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-[3px] border-r-[3px] border-white rounded-tr-xl" />
                      <span className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-[3px] border-l-[3px] border-white rounded-bl-xl" />
                      <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-[3px] border-r-[3px] border-white rounded-br-xl" />
                    </div>
                  </div>
                )}

                {cameraState === 'requesting' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-2 p-6 text-center">
                    <Loader2 className="w-7 h-7 animate-spin text-[#A78BFA]" />
                    <p className="text-sm font-medium">Requesting camera permission...</p>
                  </div>
                )}

                {(cameraState === 'denied' || cameraState === 'unavailable') && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 p-6 text-center">
                    <Camera className="w-8 h-8 text-[#A78BFA]" />
                    <p className="text-sm font-semibold">
                      {cameraState === 'denied'
                        ? 'Camera permission was denied.'
                        : 'No camera detected on this device.'}
                    </p>
                    <p className="text-xs text-white/75 max-w-xs">
                      Upload a QR code image below or enter the host’s six-digit session code manually.
                    </p>
                  </div>
                )}

                {verifying && (
                  <div className="absolute inset-0 bg-[#17143A]/75 backdrop-blur-xs flex flex-col items-center justify-center text-white gap-2">
                    <Loader2 className="w-7 h-7 animate-spin text-white" />
                    <p className="text-sm font-medium">Verifying QR token with server...</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label className="tp-glass-btn flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-[#17143A] cursor-pointer">
                  <ImageUp className="w-4 h-4 text-[#6334E8]" />
                  <span>Upload QR Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="sr-only"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    onClose();
                    onSwitchToCode();
                  }}
                  className="tp-glass-btn flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-[#17143A] cursor-pointer"
                >
                  <Keyboard className="w-4 h-4 text-[#6334E8]" />
                  <span>Enter 6-Digit Code</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
