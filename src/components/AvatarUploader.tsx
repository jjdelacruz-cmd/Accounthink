"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setAvatar } from "@/app/actions/account";
import { Avatar } from "@/components/Avatar";

const SIZE = 128;

/** Crops the picked photo to a square, shrinks it to 128 px and returns a small JPEG data URL. */
async function toAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  for (const q of [0.8, 0.65, 0.5, 0.35]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= 30000) return url;
  }
  throw new Error("too big");
}

export function AvatarUploader({ name, avatar }: { name: string; avatar: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(avatar);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  // The picker only works once the page is interactive; until then the button stays disabled.
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- runs only after hydration, which is the point
  useEffect(() => setReady(true), []);

  const save = (url: string | null) =>
    start(async () => {
      const res = await setAvatar(url);
      if (res.error) {
        setStatus({ ok: false, text: res.error });
        return;
      }
      setPreview(url);
      setStatus({ ok: true, text: url ? "Photo saved ✓" : "Photo removed" });
      router.refresh();
    });

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} src={preview} size={80} />
      <div className="space-y-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Choose a photo"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setStatus(undefined);
            try {
              save(await toAvatar(file));
            } catch {
              setStatus({ ok: false, text: "Couldn't use that photo. Try another one." });
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || !ready}
            onClick={() => input.current?.click()}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold disabled:opacity-50"
          >
            {pending ? "Saving…" : preview ? "Change photo" : "Add a photo"}
          </button>
          {preview && (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(null)}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        {status && (
          <p className={`text-xs font-semibold ${status.ok ? "text-emerald-700" : "text-red-700"}`}>{status.text}</p>
        )}
        <p className="text-xs text-slate-500">A clear photo of your face. Your instructors can see it.</p>
      </div>
    </div>
  );
}
