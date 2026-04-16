"use client";

import { useQuery } from "@tanstack/react-query";

interface TeamRecord {
  logo: string;
  name: string;
  abbr: string;
}

/**
 * Fetches ESPN's logo map for a sport. Cached for 1 hour client-side to
 * match the 6-hour server cache — consumers use matchTeamLogo() below to
 * look up by loose team name.
 */
export function useTeamLogos(sport: string | undefined) {
  return useQuery<{ teams: Record<string, TeamRecord> }>({
    queryKey: ["espn-teams", sport],
    queryFn: async () => {
      if (!sport) return { teams: {} };
      const res = await fetch(`/api/sports/espn-teams?sport=${sport}`);
      if (!res.ok) return { teams: {} };
      return res.json();
    },
    enabled: !!sport,
    staleTime: 3_600_000,
  });
}

/**
 * Loose-match a team name against the ESPN logo dictionary. Tries several
 * strategies: full lowercase name, last word (mascot), first word (city),
 * and an "any word contains" fallback — since Polymarket titles vary wildly
 * ("Baltimore Orioles" vs just "Orioles") and ESPN data is authoritative.
 */
export function matchTeamLogo(
  teamName: string,
  dict: Record<string, TeamRecord> | undefined,
): TeamRecord | null {
  if (!dict || !teamName) return null;
  const lower = teamName.toLowerCase().trim();
  if (dict[lower]) return dict[lower];
  const words = lower.split(/\s+/).filter((w) => w.length > 2);
  for (const w of words) {
    if (dict[w]) return dict[w];
  }
  // Last-ditch: scan all keys for any that contain any of our words
  for (const key of Object.keys(dict)) {
    for (const w of words) {
      if (key.includes(w) || w.includes(key)) return dict[key];
    }
  }
  return null;
}
