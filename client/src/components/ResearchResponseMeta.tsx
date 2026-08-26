import React from "react";
import { Clock3, ExternalLink, Search } from "lucide-react";

export type ResearchSource = { title: string; url: string };

export function splitResearchContent(content: string) {
  const marker = "\n\nSources:\n";
  const markerIndex = content.lastIndexOf(marker);
  if (markerIndex === -1) return { body: content, sources: [] as ResearchSource[] };
  const body = content.slice(0, markerIndex);
  const sources = content.slice(markerIndex + marker.length).split("\n").flatMap(line => {
    const match = line.match(/^- \[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    return match ? [{ title: match[1], url: match[2] }] : [];
  });
  return { body, sources };
}

function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "—";
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}

export function ResearchSources({ sources }: { sources: ResearchSource[] }) {
  if (!sources.length) return null;
  return <section className="research-sources" aria-label="Verified research sources">
    <span><Search size={12} />Verified sources</span>
    <div>{sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={11} />{source.title}</a>)}</div>
  </section>;
}

export function ResearchTiming({ latencyMs }: { latencyMs?: number | null }) {
  return <span className="research-final-timing" title="Research citations arrive with the final provider response"><Clock3 size={12} />Research final {formatDuration(latencyMs)} · final-only</span>;
}
