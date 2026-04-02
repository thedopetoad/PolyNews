"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Channel {
  name: string;
  type: "youtube" | "iframe";
  src: string; // video ID for YouTube, full URL for iframe
}

// Mix of YouTube (stable IDs) and direct embeds from news company websites
const CHANNELS: Channel[] = [
  {
    name: "Al Jazeera",
    type: "youtube",
    src: "gCNeDWCI0vo",
  },
  {
    name: "France 24",
    type: "iframe",
    src: "https://embed.france24.com/en/live",
  },
];

function getEmbedUrl(channel: Channel): string {
  if (channel.type === "iframe") return channel.src;
  return `https://www.youtube.com/embed/${channel.src}?autoplay=1&mute=1&rel=0`;
}

export function LiveStreamPlayer() {
  const [activeChannel, setActiveChannel] = useState(0);
  const channel = CHANNELS[activeChannel];

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#21262d]">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#f85149]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f85149] animate-pulse" />
          LIVE
        </span>
        <div className="flex gap-1 ml-auto">
          {CHANNELS.map((ch, idx) => (
            <button
              key={ch.name}
              onClick={() => setActiveChannel(idx)}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] whitespace-nowrap transition-colors",
                idx === activeChannel
                  ? "bg-[#1c2128] text-white"
                  : "text-[#484f58] hover:text-[#768390]"
              )}
            >
              {ch.name}
            </button>
          ))}
        </div>
      </div>
      <div className="relative aspect-video bg-black">
        <iframe
          key={channel.name}
          src={getEmbedUrl(channel)}
          title={channel.name}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}
