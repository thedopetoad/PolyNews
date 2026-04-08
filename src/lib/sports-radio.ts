// Direct stream URLs for sports radio stations
// Verified against radio-browser.info and iHeartRadio public streams

interface StationInfo {
  name: string;
  url: string;
}

// Fallback: ESPN Radio (always available)
const ESPN_RADIO: StationInfo = {
  name: "ESPN Radio",
  url: "http://live.amperwave.net/direct/espn-network-48?source=v7player",
};

// Team -> station with direct stream URL
// Keys are lowercase team names
const TEAM_STREAMS: Record<string, StationInfo> = {
  // MLB
  "chicago white sox": { name: "ESPN 1000 Chicago", url: "https://live.amperwave.net/direct/goodkarma-wmvpammp3-ibc1" },
  "cincinnati reds": { name: "700 WLW", url: "https://stream.revma.ihrhls.com/zc1713/hls.m3u8" },
  "milwaukee brewers": { name: "620 WTMJ", url: "https://live.amperwave.net/manifest/goodkarma-wtmjamaac-ibc3" },
  "san francisco giants": { name: "KNBR 680", url: "http://17793.live.streamtheworld.com/KNBRAM_SC" },
  "seattle mariners": { name: "KIRO 710 ESPN", url: "https://bonneville.cdnstream1.com/2642_48.aac" },
  "minnesota twins": { name: "KFAN Sports", url: "https://stream.revma.ihrhls.com/zc1209" },

  // NBA
  "chicago bulls": { name: "ESPN 1000 Chicago", url: "https://live.amperwave.net/direct/goodkarma-wmvpammp3-ibc1" },
  "golden state warriors": { name: "KNBR 680", url: "http://17793.live.streamtheworld.com/KNBRAM_SC" },
  "milwaukee bucks": { name: "620 WTMJ", url: "https://live.amperwave.net/manifest/goodkarma-wtmjamaac-ibc3" },
  "minnesota timberwolves": { name: "KFAN Sports", url: "https://stream.revma.ihrhls.com/zc1209" },

  // NFL
  "chicago bears": { name: "ESPN 1000 Chicago", url: "https://live.amperwave.net/direct/goodkarma-wmvpammp3-ibc1" },
  "green bay packers": { name: "620 WTMJ", url: "https://live.amperwave.net/manifest/goodkarma-wtmjamaac-ibc3" },
  "seattle seahawks": { name: "KIRO FM", url: "https://bonneville.cdnstream1.com/2643_48.aac" },
  "minnesota vikings": { name: "KFAN Sports", url: "https://stream.revma.ihrhls.com/zc1209" },

  // NHL
  "chicago blackhawks": { name: "ESPN 1000 Chicago", url: "https://live.amperwave.net/direct/goodkarma-wmvpammp3-ibc1" },
};

/**
 * Get a radio station for a team.
 * Returns a direct stream URL — falls back to ESPN Radio if no team-specific station.
 */
export function getStationForTeam(teamName: string): StationInfo {
  const lower = teamName.toLowerCase().trim();

  // Exact match
  if (TEAM_STREAMS[lower]) return TEAM_STREAMS[lower];

  // Partial match
  for (const [key, station] of Object.entries(TEAM_STREAMS)) {
    if (key.includes(lower) || lower.includes(key)) return station;
  }

  // Try matching last word (nickname)
  const words = lower.split(/\s+/);
  const nickname = words[words.length - 1];
  if (nickname.length >= 4) {
    for (const [key, station] of Object.entries(TEAM_STREAMS)) {
      if (key.endsWith(nickname)) return station;
    }
  }

  // Fallback: ESPN Radio
  return ESPN_RADIO;
}
