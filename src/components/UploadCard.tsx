"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QuotaStatus, SearchMode } from "@/lib/types";

interface Props {
  signedIn: boolean;
  osmEnabled: boolean;
  quota: QuotaStatus;
  authError?: string;
}

const MAX_BYTES = 15 * 1024 * 1024;

export default function UploadCard({ signedIn, osmEnabled, quota, authError }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mode, setMode] = useState<SearchMode>("quick");
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
  const deepLocked = !signedIn;

  return (
    <div className="upload">
      <div
        className={`dropzone${dragging ? " dropzone--active" : ""}${preview ? " dropzone--filled" : ""}`}
        role="button"
        tabIndex={0}
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
          <img src={preview} alt="Selected photo" className="dropzone__preview" />
        ) : (
          <div className="dropzone__empty">
            <UploadIcon />
            <strong>Drop a photo here</strong>
            <span>or click to browse · paste works too</span>
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
          <span className="mode__title">Quick find</span>
          <span className="mode__hint">Fast read of the obvious clues</span>
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
          <span className="mode__title">Deep search {deepLocked && <span className="mode__lock">🔒</span>}</span>
          <span className="mode__hint">{deepLocked ? "Sign in to unlock" : "Slower, more thorough reasoning"}</span>
        </button>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <button type="button" className="cta" disabled={!file || busy || outOfSearches} onClick={submit}>
        {busy ? "Uploading…" : "Locate photo"}
      </button>

      <p className="quota">
        {outOfSearches
          ? signedIn || !osmEnabled
            ? "No searches left today · resets 00:00 UTC"
            : "No free searches left today · sign in with OpenStreetMap for more"
          : `${quota.remaining} of ${quota.limit} ${signedIn ? "" : "free "}search${quota.limit === 1 ? "" : "es"} left today · resets 00:00 UTC`}
      </p>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M12 16V4m0 0l-4 4m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" />
    </svg>
  );
}
