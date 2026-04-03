"use client";

import { useState, useEffect, useCallback } from "react";
import { STREAM_CHANNELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface LiveStream {
  videoId: string;
  title: string;
}

interface ChannelStreams {
  channelId: string;
  name: string;
  streams: LiveStream[];
  loading: boolean;
}

export function LiveStreamPlayer() {
  const [channels, setChannels] = useState<ChannelStreams[]>(
    STREAM_CHANNELS.map((c) => ({ channelId: c.channelId, name: c.name, streams: [], loading: true }))
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [activeStreamIdx, setActiveStreamIdx] = useState(0);

  const fetchAllStreams = useCallback(async () => {
    const results = await Promise.all(
      STREAM_CHANNELS.map(async (ch) => {
        try {
          const res = await fetch(`/api/youtube/live?channelId=${ch.channelId}`);
          if (!res.ok) return { channelId: ch.channelId, name: ch.name, streams: [], loading: false };
          const data = await res.json();
          return { channelId: ch.channelId, name: ch.name, streams: data.streams || [], loading: false };
        } catch {
          return { channelId: ch.channelId, name: ch.name, streams: [], loading: false };
        }
      })
    );
    setChannels(results);

    // Auto-select first channel with a live stream if current has none
    setActiveIdx((prev) => {
      if (results[prev]?.streams.length > 0) return prev;
      const firstLive = results.findIndex((c) => c.streams.length > 0);
      return firstLive >= 0 ? firstLive : prev;
    });
    setActiveStreamIdx(0);
  }, []);

  useEffect(() => {
    fetchAllStreams();
    const interval = setInterval(fetchAllStreams, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAllStreams]);

  const active = channels[activeIdx];
  const activeStream = active?.streams[activeStreamIdx];
  const isLoading = channels.every((c) => c.loading);

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      {/* Channel tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[#21262d] overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#f85149] mr-2 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f85149] animate-pulse" />
          LIVE
        </span>
        {STREAM_CHANNELS.map((ch, idx) => {
          const chData = channels[idx];
          const hasStream = chData && chData.streams.length > 0;
          return (
            <button
              key={ch.channelId}
              onClick={() => { setActiveIdx(idx); setActiveStreamIdx(0); }}
              className={cn(
                "px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0",
                activeIdx === idx
                  ? "text-white"
                  : hasStream
                    ? "text-[#768390] hover:text-[#adbac7]"
                    : "text-[#484f58]"
              )}
              style={activeIdx === idx ? { backgroundColor: ch.color + "33", color: ch.color } : undefined}
            >
              {ch.name}
              {!chData?.loading && !hasStream && <span className="ml-1 text-[9px] opacity-50">off</span>}
              {hasStream && chData.streams.length > 1 && (
                <span className="ml-1 text-[9px] opacity-70">{chData.streams.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Stream selector (if multiple) */}
      {active && active.streams.length > 1 && (
        <div className="flex gap-1 px-3 py-1.5 border-b border-[#21262d] bg-[#0d1117] overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {active.streams.map((stream, idx) => (
            <button
              key={stream.videoId}
              onClick={() => setActiveStreamIdx(idx)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors",
                activeStreamIdx === idx
                  ? "bg-[#21262d] text-[#e6edf3]"
                  : "text-[#484f58] hover:text-[#768390]"
              )}
            >
              {stream.title.length > 40 ? stream.title.slice(0, 40) + "..." : stream.title}
            </button>
          ))}
        </div>
      )}

      {/* Video player */}
      <div className="relative aspect-video bg-black">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-[#484f58]">Finding live streams...</p>
          </div>
        ) : activeStream ? (
          <iframe
            key={activeStream.videoId}
            src={`https://www.youtube.com/embed/${activeStream.videoId}?autoplay=1&mute=1&rel=0`}
            title={activeStream.title}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <p className="text-sm text-[#484f58]">{active?.name || "Channel"} is not live right now</p>
            <p className="text-[11px] text-[#484f58]">Try another channel</p>
          </div>
        )}
      </div>

      {/* Stream info bar */}
      {activeStream && (
        <div className="px-3 py-1.5 border-t border-[#21262d]">
          <p className="text-[11px] text-[#768390] truncate">{activeStream.title}</p>
        </div>
      )}
    </div>
  );
}
