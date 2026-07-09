export const state = {
    selectedSeasonId: null,
    selectedTeamId: null,
    activeOpenLeagueId: null,
    selectedSeasonYear: null,
    currentAveragesData: [],
    currentMatchdaysData: [],
    activeTab: 'matchday-container',
    activeUpcomingFilter: 'team',
    allLeaguesData: null,
    globalInsightVariable: null,
    tabs: {
        currTeamMarket: false,
        ftMatches: false,
        upcommingTeamMatches: false,
        upcommingLeagueMatches: false,
    },
    selectedLeagues: [],
    filterByLeague: null,
    neededDataForUpCOmmingGames: null
};