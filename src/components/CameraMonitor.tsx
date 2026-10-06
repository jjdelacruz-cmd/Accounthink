"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { classify, WarningTracker, type Look, type Pose } from "@/lib/gaze";

// Everything here runs on the student's phone. The camera picture is never saved or sent;
// only warnings (kind + how many seconds) go to the server.

const TICK_MS = 500;
const BASELINE_FRAMES = 6;

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/** Loads the face model once per page (about 7 MB the first time, then cached). */
function loadLandmarker(): Promise<FaceLandmarker> {
  landmarkerPromise ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
      });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })().catch((e) => {
    landmarkerPromise = null; // allow a retry
    throw e;
  });
  return landmarkerPromise;
}

export type CameraStatus = "idle" | "starting" | "denied" | "unsupported" | "error" | "running" | "off";

export const LOOK_MESSAGE: Record<Exclude<Look, "ok">, string> = {
  away: "Look at your screen.",
  no_face: "We can't see your face. Keep your face in front of the camera.",
  multi: "Someone else is in view. Only you should be in front of the camera.",
};

/**
 * Starts the front camera and checks each frame. `onEpisode` is called when a warning starts
 * (seconds = null) and again when it ends (with how long it lasted).
 */
function useCameraWatch(onEpisode?: (kind: Exclude<Look, "ok"> | "off", seconds: number | null) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [look, setLook] = useState<Look>("ok");
  const [warning, setWarning] = useState<Exclude<Look, "ok"> | null>(null);
  const [calibrated, setCalibrated] = useState(false);
  const tracker = useRef(new WarningTracker());
  const baseline = useRef<Pose | null>(null);
  const samples = useRef<Pose[]>([]);
  const offSince = useRef<number | null>(null);
  const onEpisodeRef = useRef(onEpisode);
  useEffect(() => {
    onEpisodeRef.current = onEpisode;
  }, [onEpisode]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const markOff = useCallback(() => {
    if (offSince.current === null) {
      offSince.current = Date.now();
      onEpisodeRef.current?.("off", null);
    }
    setStatus("off");
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    setStatus("starting");
    try {
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        }),
        loadLandmarker(),
      ]);
      stop();
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", markOff);
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      if (offSince.current !== null) {
        const seconds = Math.max(1, Math.round((Date.now() - offSince.current) / 1000));
        offSince.current = null;
        onEpisodeRef.current?.("off", seconds);
      }
      setStatus("running");
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") setStatus("denied");
      else setStatus("error");
      if (offSince.current === null && streamRef.current === null) {
        offSince.current = Date.now();
        onEpisodeRef.current?.("off", null);
      }
    }
  }, [stop, markOff]);

  // Frame checks.
  useEffect(() => {
    if (status !== "running") return;
    let cancelled = false;
    const t = setInterval(async () => {
      const v = videoRef.current;
      if (cancelled || !v || document.visibilityState === "hidden") return;
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === "ended") {
        markOff();
        return;
      }
      if (v.readyState < 2) return;
      let res;
      try {
        res = (await loadLandmarker()).detectForVideo(v, performance.now());
      } catch {
        return;
      }
      const { look: now, pose } = classify(res.faceLandmarks, res.faceBlendshapes, baseline.current);
      if (now === "ok" && pose) {
        if (!baseline.current) {
          samples.current.push(pose);
          if (samples.current.length >= BASELINE_FRAMES) {
            const mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
            baseline.current = {
              yaw: mid(samples.current.map((p) => p.yaw)),
              pitch: mid(samples.current.map((p) => p.pitch)),
            };
            setCalibrated(true);
          }
        } else {
          // Follow slow posture changes while the student is looking at the screen.
          baseline.current = {
            yaw: baseline.current.yaw * 0.97 + pose.yaw * 0.03,
            pitch: baseline.current.pitch * 0.97 + pose.pitch * 0.03,
          };
        }
      }
      setLook(now);
      const before = tracker.current.warning;
      const done = tracker.current.step(now, Date.now());
      if (done) onEpisodeRef.current?.(done.kind, done.seconds);
      const after = tracker.current.warning;
      if (after && after !== before) onEpisodeRef.current?.(after, null);
      setWarning(after);
    }, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [status, markOff]);

  /** Ends any open warning and turns the camera off. */
  const finish = useCallback(() => {
    const done = tracker.current.flush(Date.now());
    if (done) onEpisodeRef.current?.(done.kind, done.seconds);
    stop();
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, look, warning, calibrated, start, finish };
}

function Preview({
  videoRef,
  tone,
  className = "",
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  tone: "ok" | "warn" | "idle";
  className?: string;
}) {
  return (
    <video
      ref={videoRef}
      muted
      playsInline
      autoPlay
      aria-label="Your camera"
      className={`-scale-x-100 rounded-xl border-4 bg-slate-900 object-cover ${
        tone === "ok" ? "border-emerald-500" : tone === "warn" ? "border-red-500" : "border-slate-300"
      } ${className}`}
    />
  );
}

function blockedText(status: CameraStatus) {
  if (status === "denied")
    return "Camera access was blocked. Allow the camera for this site in your browser settings (tap the lock or camera icon next to the address), then try again.";
  if (status === "unsupported") return "This browser can't use the camera. Open the exam in Chrome or Safari.";
  if (status === "off") return "Your camera stopped. Turn it back on to continue.";
  return "Couldn't start the camera. Close other apps using it, then try again.";
}

// ===========================================================================
// Before starting: check the camera works and sees the student's face.
// ===========================================================================
export function CameraGate({ children }: { children: ReactNode }) {
  const cam = useCameraWatch();
  const passed = cam.status === "running" && cam.calibrated;
  const failed = ["denied", "unsupported", "error", "off"].includes(cam.status);

  // One <video> element throughout, so the stream stays attached when the check passes.
  return (
    <div className="space-y-3">
      <div className={`space-y-3 rounded-xl p-3 ${passed ? "bg-emerald-50" : "border border-slate-200"}`}>
        {!passed && <p className="text-sm font-semibold">Camera check</p>}
        <div className="flex items-center gap-3">
          <Preview
            videoRef={cam.videoRef}
            tone={cam.status === "running" ? (cam.look === "ok" ? "ok" : "warn") : "idle"}
            className={`shrink-0 ${passed ? "h-16 w-12" : "h-32 w-24"}`}
          />
          <div className="space-y-2 text-sm text-slate-700">
            {passed && (
              <p className="font-semibold text-emerald-800">Camera ready ✓ Keep your face in view during the exam.</p>
            )}
            {cam.status === "idle" && <p>Tap the button and allow the camera when your phone asks.</p>}
            {cam.status === "starting" && <p>Starting the camera… (the first time can take a few seconds)</p>}
            {cam.status === "running" && !passed && (
              <p>{cam.look === "ok" ? "Hold still and look at the middle of the screen…" : LOOK_MESSAGE[cam.look]}</p>
            )}
            {failed && <p className="text-red-700">{blockedText(cam.status)}</p>}
          </div>
        </div>
        {(cam.status === "idle" || (failed && cam.status !== "unsupported")) && (
          <button
            type="button"
            onClick={cam.start}
            className="min-h-12 w-full rounded-xl border-2 border-emerald-700 font-semibold text-emerald-800"
          >
            {cam.status === "idle" ? "Turn on camera" : "Try again"}
          </button>
        )}
      </div>
      {passed && children}
    </div>
  );
}

// ===========================================================================
// During the exam: small preview, warnings, and a block if the camera is off.
// ===========================================================================
export function CameraWatch({
  onEpisode,
  finishedRef,
}: {
  /** seconds = null when a warning starts; a number when it ends. */
  onEpisode: (kind: "cam_no_face" | "cam_away" | "cam_multi" | "cam_off", seconds: number | null) => void;
  finishedRef: React.RefObject<boolean>;
}) {
  const [count, setCount] = useState(0);
  const cam = useCameraWatch((kind, seconds) => {
    if (finishedRef.current) return;
    if (seconds === null) setCount((n) => n + 1);
    onEpisode(kind === "off" ? "cam_off" : kind === "away" ? "cam_away" : kind === "multi" ? "cam_multi" : "cam_no_face", seconds);
  });
  const { start, finish } = cam;

  useEffect(() => {
    start(); // the camera can only start in the browser
    return finish;
  }, [start, finish]);

  // Coming back to the page can stop the camera on some phones: start it again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !finishedRef.current) start();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [start, finishedRef]);

  const blocked = ["denied", "unsupported", "error", "off"].includes(cam.status);

  return (
    <>
      <div className="pointer-events-none fixed right-3 top-16 z-30 flex flex-col items-end gap-1">
        <Preview
          videoRef={cam.videoRef}
          tone={cam.status !== "running" ? "idle" : cam.warning ? "warn" : "ok"}
          className="h-20 w-[3.75rem] shadow-lg"
        />
        {count > 0 && (
          <span className="rounded-full bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
            {count} warning{count === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {cam.warning && !blocked && (
        // Above the bottom buttons, so the question stays readable.
        <div role="alert" className="fixed inset-x-0 bottom-20 z-30 mx-auto max-w-2xl px-4">
          <div className="rounded-xl border-2 border-red-500 bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-lg">
            ⚠ {LOOK_MESSAGE[cam.warning]} This is recorded for your instructor.
          </div>
        </div>
      )}

      {blocked && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-slate-900/95 px-6 text-center text-white">
          <p className="text-lg font-semibold">Camera needed</p>
          <p className="max-w-xs text-sm text-slate-200">{blockedText(cam.status)}</p>
          <p className="max-w-xs text-xs text-slate-400">Your timer keeps running and your answers are saved.</p>
          {cam.status !== "unsupported" && (
            <button onClick={start} className="min-h-12 rounded-xl bg-white px-6 font-semibold text-slate-900">
              Turn camera back on
            </button>
          )}
        </div>
      )}
    </>
  );
}
