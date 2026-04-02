"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Channel {
  name: string;
  // YouTube handle-based embed (works for channels with active live streams)
  handle?: string;
  // Direct video ID (for known stable streams)
  videoId?: string;
  // External embed URL
  embedUrl?: string;
}

const CHANNELS: Channel[] = [
  { name: "Al Jazeera", handle: "aljaborzenglish", videoId: "gCNeDWCI0vo" },
  { name: "Sky News", handle: "skynews" },
  { name: "France 24", handle: "FRANCE24English" },
  { name: "DW News", handle: "DWNews" },
  { name: "Infowars", embedUrl: "https://www.infowars.com/show" },
];

function getEmbedUrl(channel: Channel): string {
  // If we have a direct video ID, use it
  if (channel.videoId) {
    return `https://www.youtube.com/embed/${channel.videoId}?autoplay=1&mute=1&rel=0`;
  }
  // If external embed
  if (channel.embedUrl) {
    return channel.embedUrl;
  }
  // Use YouTube handle-based live embed
  // This redirects to the current live stream for the channel
  if (channel.handle) {
    return `https://www.youtube.com/embed/live_stream?channel=${channel.handle}&autoplay=1&mute=1&rel=0`;
  }
  return "";
}

export function LiveStreamPlayer() {
  const [activeChannel, setActiveChannel] = useState(0);
  const [multiView, setMultiView] = useState(false);
  const channel = CHANNELS[activeChannel];

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#21262d]">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#f85149]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f85149] animate-pulse" />
          LIVE
        </span>

        <div className="flex gap-0.5 bg-[#0d1117] rounded p-0.5 ml-2">
          <button
            onClick={() => setMultiView(false)}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
              !multiView ? "bg-[#1c2128] text-white" : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            Single
          </button>
          <button
            onClick={() => setMultiView(true)}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
              multiView ? "bg-[#1c2128] text-white" : "text-[#484f58] hover:text-[#768390]"
            )}
          >
            Multi
          </button>
        </div>

        {!multiView && (
          <div className="flex gap-1 ml-auto overflow-x-auto">
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
        )}
      </div>

      {/* Stream(s) */}
      {multiView ? (
        <div className="grid grid-cols-2 gap-px bg-[#21262d]">
          {CHANNELS.slice(0, 4).map((ch) => (
            <div key={ch.name} className="relative aspect-video bg-[#0d1117]">
              <iframe
                src={getEmbedUrl(ch)}
                title={ch.name}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1 pointer-events-none">
                <span className="text-[10px] font-medium text-white/80">{ch.name}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="relative aspect-video">
          <iframe
            key={channel.name}
            src={getEmbedUrl(channel)}
            title={channel.name}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}
