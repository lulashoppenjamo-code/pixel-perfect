import { useState } from "react";
import { validImageUrl } from "@/lib/productImport";

export function ProductImage({ src, emoji, name, className = "h-full w-full object-contain" }: { src?: string | null; emoji?: string | null; name?: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!src || !validImageUrl(src) || failedUrl === src) return <span aria-label={name ? `Imagen de ${name} no disponible` : "Imagen no disponible"}>{emoji || "📦"}</span>;
  return <img src={src} alt={name ?? ""} className={className} loading="lazy" onError={() => setFailedUrl(src)} />;
}