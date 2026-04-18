"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

type QualitySignalImageProps = {
  src: string | null;
  alt: string;
};

export function QualitySignalImage({
  src,
  alt,
}: QualitySignalImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const failed = Boolean(src) && failedSrc === src;

  if (!src || failed) {
    return (
      <div className="flex h-32 w-full items-center justify-center gap-2 rounded-[22px] border border-dashed border-white/12 bg-[color:var(--surface-low)] px-4 text-center text-xs font-medium tracking-[0.18em] text-[var(--muted-foreground)] uppercase">
        <ImageOff className="size-4 shrink-0" />
        <span>{src ? "Image unavailable" : "No image attached"}</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[22px] border border-white/8 bg-[color:var(--surface-low)]">
      {/* The asset host is team-specific, so this stays as a plain img instead of next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        className="h-32 w-full object-cover"
        loading="lazy"
        onError={() => setFailedSrc(src)}
        referrerPolicy="no-referrer"
        src={src}
      />
    </div>
  );
}
