// Team name -> local radio station name (used to search radio-browser.info)
// Keys are lowercase for easy matching against event titles

const TEAM_STATIONS: Record<string, string> = {
  // MLB
  "arizona diamondbacks": "ESPN 620",
  "atlanta braves": "680 The Fan",
  "baltimore orioles": "WBAL",
  "boston red sox": "WEEI",
  "chicago cubs": "WSCR",
  "chicago white sox": "WMVP ESPN 1000",
  "cincinnati reds": "WLW",
  "cleveland guardians": "WTAM",
  "colorado rockies": "KOA",
  "detroit tigers": "WXYT",
  "houston astros": "KBME",
  "kansas city royals": "KCSP",
  "los angeles angels": "KLAA",
  "los angeles dodgers": "AM 570",
  "miami marlins": "WINZ",
  "milwaukee brewers": "WTMJ",
  "minnesota twins": "TIBN",
  "new york mets": "WCBS",
  "new york yankees": "WFAN",
  "oakland athletics": "Bloomberg Radio",
  "philadelphia phillies": "WIP",
  "pittsburgh pirates": "KDKA",
  "san diego padres": "KWFN",
  "san francisco giants": "KNBR",
  "seattle mariners": "KIRO",
  "st. louis cardinals": "KMOX",
  "tampa bay rays": "WDAE",
  "texas rangers": "KRLD",
  "toronto blue jays": "Sportsnet",
  "washington nationals": "WJFK",

  // NBA
  "atlanta hawks": "680 The Fan",
  "boston celtics": "WEEI",
  "brooklyn nets": "WFAN",
  "charlotte hornets": "WFNZ",
  "chicago bulls": "WMVP ESPN 1000",
  "cleveland cavaliers": "WTAM",
  "dallas mavericks": "KESN ESPN",
  "denver nuggets": "KOA",
  "detroit pistons": "WXYT",
  "golden state warriors": "KNBR",
  "houston rockets": "KBME",
  "indiana pacers": "WFNI",
  "la clippers": "AM 570",
  "los angeles lakers": "AM 570",
  "memphis grizzlies": "ESPN 92.9",
  "miami heat": "WINZ",
  "milwaukee bucks": "WTMJ",
  "minnesota timberwolves": "KFAN",
  "new orleans pelicans": "WWL",
  "new york knicks": "WEPN ESPN New York",
  "oklahoma city thunder": "WWLS",
  "orlando magic": "WDBO",
  "philadelphia 76ers": "WIP",
  "phoenix suns": "KMVP ESPN",
  "portland trail blazers": "KPOJ",
  "sacramento kings": "KHTK",
  "san antonio spurs": "WOAI",
  "toronto raptors": "Sportsnet",
  "utah jazz": "ESPN 700",
  "washington wizards": "WJFK",

  // NFL
  "arizona cardinals": "ESPN 620",
  "atlanta falcons": "680 The Fan",
  "baltimore ravens": "WBAL",
  "buffalo bills": "WGR",
  "carolina panthers": "WFNZ",
  "chicago bears": "WBBM",
  "cincinnati bengals": "WLW",
  "cleveland browns": "WKNR",
  "dallas cowboys": "KESN ESPN",
  "denver broncos": "KOA",
  "detroit lions": "WXYT",
  "green bay packers": "WTMJ",
  "houston texans": "KBME",
  "indianapolis colts": "WFNI",
  "jacksonville jaguars": "WJXL",
  "kansas city chiefs": "KCFX",
  "las vegas raiders": "KOMP",
  "los angeles chargers": "AM 570",
  "los angeles rams": "AM 570",
  "miami dolphins": "WINZ",
  "minnesota vikings": "KFAN",
  "new england patriots": "WBZ",
  "new orleans saints": "WWL",
  "new york giants": "WFAN",
  "new york jets": "WEPN ESPN New York",
  "philadelphia eagles": "WIP",
  "pittsburgh steelers": "KDKA",
  "san francisco 49ers": "KNBR",
  "seattle seahawks": "KIRO",
  "tampa bay buccaneers": "WDAE",
  "tennessee titans": "WGFX",
  "washington commanders": "WJFK",

  // NHL
  "boston bruins": "WEEI",
  "buffalo sabres": "WGR",
  "chicago blackhawks": "WGN",
  "colorado avalanche": "KOA",
  "dallas stars": "KESN ESPN",
  "detroit red wings": "WXYT",
  "minnesota wild": "KFAN",
  "new york rangers": "WEPN ESPN New York",
  "new york islanders": "WFAN",
  "philadelphia flyers": "WIP",
  "pittsburgh penguins": "KDKA",
  "san jose sharks": "KNBR",
  "tampa bay lightning": "WDAE",
  "toronto maple leafs": "Sportsnet",
  "washington capitals": "WJFK",
};

/**
 * Find a radio station name for a team.
 * Tries exact match first, then fuzzy match on partial team name.
 */
export function getStationForTeam(teamName: string): string | null {
  const lower = teamName.toLowerCase().trim();

  // Exact match
  if (TEAM_STATIONS[lower]) return TEAM_STATIONS[lower];

  // Partial match — check if any key contains the team name or vice versa
  for (const [key, station] of Object.entries(TEAM_STATIONS)) {
    if (key.includes(lower) || lower.includes(key)) return station;
  }

  // Try matching just the last word (team nickname)
  const words = lower.split(/\s+/);
  const nickname = words[words.length - 1];
  if (nickname.length >= 4) {
    for (const [key, station] of Object.entries(TEAM_STATIONS)) {
      if (key.endsWith(nickname)) return station;
    }
  }

  return null;
}
