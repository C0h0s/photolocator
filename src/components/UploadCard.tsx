"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Icon from "@/components/icons";
import type { QuotaStatus, SearchMode } from "@/lib/types";

interface Props {
  signedIn: boolean;
  osmEnabled: boolean;
  /** Deep search is gated behind sign-in whenever OSM sign-in is configured. */
  deepLocked: boolean;
  quota: QuotaStatus;
  authError?: string;
}

const MAX_BYTES = 15 * 1024 * 1024;

export default function UploadCard({ signedIn, osmEnabled, deepLocked, quota, authError }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mode, setMode] = useState<SearchMode>(deepLocked ? "quick" : "deep");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(authError ?? null);

  const pick = useCallback((candidate: File | undefined | null) => {
    if (!candidate) return;
    if (!candidate.type.startsWith("image/")) return setError("That doesn't look like an image.");
    if (candidate.size > MAX_BYTES) return setError("That photo is too large (15 MB max).");
    setError(null);
    setFile(candidate);
  }, []);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (item) pick(item);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pick]);

  async function submit() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("image", file);
      body.append("mode", mode);
      const res = await fetch("/api/search", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed. Please try again.");
      router.push(`/search/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setBusy(false);
    }
  }

  const outOfSearches = quota.remaining === 0;

  return (
    <div className="upload glass">
      <div
        className={`drop${dragging ? " drop--active" : ""}${preview ? " drop--filled" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Choose a photo"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        {preview ? (
          <>
            <img src={preview} alt="Selected photo" className="drop__preview" />
            <span className="drop__swap mono">Click to change</span>
          </>
        ) : (
          <div className="drop__empty">
            <span className="drop__icon">
              <Icon.Upload size={22} />
            </span>
            <strong>Drop a photo to locate</strong>
            <span className="mono">JPG · PNG · WebP · paste works too</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <div className="modes" role="radiogroup" aria-label="Search mode">
        <button type="button" role="radio" aria-checked={mode === "quick"} className="mode" onClick={() => setMode("quick")}>
          <span className="mode__title">
            <Icon.Eye size={14} /> Quick find
          </span>
          <span className="mode__hint">Region model + one visual read · ~20 s</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "deep"}
          className="mode"
          disabled={deepLocked}
          onClick={() => setMode("deep")}
          title={deepLocked ? "Sign in with OpenStreetMap to unlock" : undefined}
        >
          <span className="mode__title">
            {deepLocked ? <Icon.Lock size={14} /> : <Icon.Shield size={14} />} Deep search
          </span>
          <span className="mode__hint">{deepLocked ? "Sign in to unlock" : "Investigates & verifies · 1–4 min"}</span>
        </button>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <button type="button" className="btn btn--primary btn--block" disabled={!file || busy || outOfSearches} onClick={submit}>
        {busy ? "Uploading…" : "Locate photo"} {!busy && <Icon.ArrowRight size={15} />}
      </button>

      <p className="quota mono">
        {outOfSearches
          ? signedIn || !osmEnabled
            ? "No searches left today · resets 00:00 UTC"
            : "No free searches left today · sign in for more"
          : `${quota.remaining}/${quota.limit} ${signedIn ? "" : "free "}search${quota.limit === 1 ? "" : "es"} left today · resets 00:00 UTC`}
      </p>
    </div>
  );
}
