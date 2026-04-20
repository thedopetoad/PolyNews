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
  const [multiView, setMultiView] = useState(false);
  const [multiSelections, setMultiSelections] = useState<number[]>([]);

  const fetchAllStreams = useCallback(async () => {
    type ApiResult = { channelId: string; streams: LiveStream[] };
    const merged = new Map<string, LiveStream[]>();
    await Promise.all(
      ["/api/youtube/live", "/api/rumble/live"].map(async (url) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const data = await res.json();
          for (const r of (data.results || []) as ApiResult[]) {
            merged.set(r.channelId, r.streams || []);
          }
        } catch {
          // ignore; channels with no data stay empty below
        }
      })
    );
    const results: ChannelStreams[] = STREAM_CHANNELS.map((ch) => ({
      channelId: ch.channelId,
      name: ch.name,
      streams: merged.get(ch.channelId) || [],
      loading: false,
    }));
    setChannels(results);

    setActiveIdx((prev) => {
      if (results[prev]?.streams.length > 0) return prev;
      const firstLive = results.findIndex((c) => c.streams.length > 0);
      return firstLive >= 0 ? firstLive : prev;
    });
    setActiveStreamIdx(0);

    setMultiSelections((prev) => {
      if (prev.length > 0) return prev;
      const live = results.map((c, i) => ({ i, live: c.streams.length > 0 })).filter((c) => c.live).map((c) => c.i);
      return live.slice(0, 4);
    });
  }, []);

  useEffect(() => {
    fetchAllStreams();
    const interval = setInterval(fetchAllStreams, 30 * 60 * 1000); // Refresh every 30 min
    return () => clearInterval(interval);
  }, [fetchAllStreams]);

  const toggleMultiSelection = (idx: number) => {
    setMultiSelections((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      if (prev.length >= 4) return prev;
      return [...prev, idx];
    });
  };

  const active = channels[activeIdx];
  const activeStream = active?.streams[activeStreamIdx];
  const activeChannelConfig = STREAM_CHANNELS[activeIdx];
  const isLoading = channels.every((c) => c.loading);

  const embedUrl = (videoId: string, platform: "youtube" | "rumble" | undefined) =>
    platform === "rumble"
      ? `https://rumble.com/embed/${videoId}/?autoplay=1`
      : `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0`;

  return (
    <div className="rounded-lg border border-[#21262d] bg-[#161b22] overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[#21262d] overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#f85149] mr-2 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f85149] animate-pulse" />
          LIVE
        </span>

        {!multiView ? (
          // Single view: channel tabs (live only; hidden once loaded if offline)
          <>
            {STREAM_CHANNELS.map((ch, idx) => {
              const chData = channels[idx];
              const hasStream = chData && chData.streams.length > 0;
              if (chData && !chData.loading && !hasStream) return null;
              return (
                <button
                  key={ch.channelId}
                  onClick={() => { setActiveIdx(idx); setActiveStreamIdx(0); }}
                  className={cn(
                    "px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0",
                    activeIdx === idx ? "text-white" : "text-[#768390] hover:text-[#adbac7]"
                  )}
                  style={activeIdx === idx ? { backgroundColor: ch.color + "33", color: ch.color } : undefined}
                >
                  {ch.name}
                  {hasStream && chData.streams.length > 1 && (
                    <span className="ml-1 text-[9px] opacity-70">{chData.streams.length}</span>
                  )}
                </button>
              );
            })}
          </>
        ) : (
          // Multi view: selectable live channels (up to 4)
          <>
            {STREAM_CHANNELS.map((ch, idx) => {
              const chData = channels[idx];
              const hasStream = chData && chData.streams.length > 0;
              if (chData && !chData.loading && !hasStream) return null;
              const selected = multiSelections.includes(idx);
              return (
                <button
                  key={ch.channelId}
                  onClick={() => hasStream && toggleMultiSelection(idx)}
                  disabled={!hasStream}
                  className={cn(
                    "px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0",
                    selected
                      ? "text-white ring-1 ring-[#58a6ff]"
                      : hasStream
                        ? "text-[#768390] hover:text-[#adbac7]"
                        : "text-[#484f58] cursor-not-allowed"
                  )}
                  style={selected ? { backgroundColor: ch.color + "33", color: ch.color } : undefined}
                >
                  {ch.name}
                </button>
              );
            })}
            <span className="text-[10px] text-[#484f58] flex-shrink-0 ml-1">{multiSelections.length}/4</span>
          </>
        )}

        {/* Multi-view toggle */}
        <button
          onClick={() => setMultiView(!multiView)}
          className={cn(
            "ml-auto flex-shrink-0 px-2 py-1 rounded text-[11px] font-medium transition-colors",
            multiView
              ? "bg-[#58a6ff]/15 text-[#58a6ff]"
              : "text-[#484f58] hover:text-[#768390]"
          )}
          title={multiView ? "Single view" : "Multi view (4 streams)"}
        >
          {multiView ? "1x" : "4x"}
        </button>
      </div>

      {/* Stream selector for single view */}
      {!multiView && active && active.streams.length > 1 && (
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

      {/* Video area */}
      {!multiView ? (
        // Single view
        <div className="relative aspect-video bg-black">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-sm text-[#484f58]">Finding live streams...</p>
            </div>
          ) : activeStream ? (
            <iframe
              key={activeStream.videoId}
              src={embedUrl(activeStream.videoId, activeChannelConfig?.platform)}
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
      ) : (
        // Multi view: 2x2 grid
        <div className="grid grid-cols-2 bg-black">
          {[0, 1, 2, 3].map((slot) => {
            const chIdx = multiSelections[slot];
            const ch = chIdx !== undefined ? channels[chIdx] : null;
            const stream = ch?.streams[0];
            const chConfig = chIdx !== undefined ? STREAM_CHANNELS[chIdx] : null;

            return (
              <div key={slot} className="relative aspect-video border border-[#0d1117]">
                {stream ? (
                  <>
                    <iframe
                      key={stream.videoId}
                      src={embedUrl(stream.videoId, chConfig?.platform)}
                      title={stream.title}
                      className="absolute inset-0 w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-medium text-white/80 bg-black/60">
                      {chConfig?.name}
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]">
                    <p className="text-[11px] text-[#484f58]">{ch ? `${ch.name} offline` : "Select a channel"}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stream info bar (single view only) */}
      {!multiView && activeStream && (
        <div className="px-3 py-1.5 border-t border-[#21262d]">
          <p className="text-[11px] text-[#768390] truncate">{activeStream.title}</p>
        </div>
      )}
    </div>
  );
}
