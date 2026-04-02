"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Channel {
  name: string;
  videoId: string;
}

// Only channels with confirmed working 24/7 YouTube embeds
const CHANNELS: Channel[] = [
  { name: "Al Jazeera", videoId: "gCNeDWCI0vo" },
];

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
                "px-2 py-1 rounded text-[11px] whitespace-nowrap transition-colors",
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
      <div className="relative aspect-video">
        <iframe
          key={channel.videoId}
          src={`https://www.youtube.com/embed/${channel.videoId}?autoplay=1&mute=1&rel=0`}
          title={channel.name}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}
