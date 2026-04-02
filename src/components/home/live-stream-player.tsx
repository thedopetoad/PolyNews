"use client";

import { useState } from "react";
import { STREAM_CHANNELS, StreamChannel } from "@/lib/constants";
import { cn } from "@/lib/utils";

function StreamEmbed({ channel, muted = true }: { channel: StreamChannel; muted?: boolean }) {
  if (channel.platform === "rumble") {
    // Infowars - embed their live page via Rumble channel
    return (
      <iframe
        src="https://rumble.com/c/InfowarsLive"
        title={channel.name}
        className="absolute inset-0 w-full h-full"
        allowFullScreen
      />
    );
  }

  // YouTube: use channel-based live stream embed
  const src = `https://www.youtube.com/embed/live_stream?channel=${channel.id}&autoplay=1&mute=${muted ? 1 : 0}&rel=0`;
  return (
    <iframe
      src={src}
      title={channel.name}
      className="absolute inset-0 w-full h-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}

export function LiveStreamPlayer() {
  const [activeChannel, setActiveChannel] = useState(0);
  const [multiView, setMultiView] = useState(false);
  const channel = STREAM_CHANNELS[activeChannel];

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
            {STREAM_CHANNELS.map((ch, idx) => (
              <button
                key={ch.id}
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
          {STREAM_CHANNELS.filter((c) => c.platform === "youtube")
            .slice(0, 4)
            .map((ch) => (
              <div key={ch.id} className="relative aspect-video bg-[#0d1117]">
                <StreamEmbed channel={ch} muted />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1 pointer-events-none">
                  <span className="text-[10px] font-medium text-white/80">{ch.name}</span>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="relative aspect-video">
          <StreamEmbed channel={channel} />
        </div>
      )}
    </div>
  );
}
