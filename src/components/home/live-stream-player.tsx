"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Channel {
  name: string;
  src: string;
}

const CHANNELS: Channel[] = [
  { name: "Al Jazeera", src: "gCNeDWCI0vo" },
];

export function LiveStreamPlayer() {
  const [activeChannel] = useState(0);
  const channel = CHANNELS[activeChannel];

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#21262d]">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#f85149]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f85149] animate-pulse" />
          LIVE
        </span>
        <span className="text-[11px] text-[#adbac7] ml-auto">{channel.name}</span>
      </div>
      <div className="relative aspect-video bg-black">
        <iframe
          src={`https://www.youtube.com/embed/${channel.src}?autoplay=1&mute=1&rel=0`}
          title={channel.name}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}
