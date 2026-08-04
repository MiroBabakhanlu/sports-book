const { prisma } = require("../src/utils/prisma");

async function main() {

    const football = await prisma.sport.upsert({
        where: { slug: 'football' },
        update: {},
        create: {
            name: 'Football',
            slug: 'football',
            api_provider: 'api-football',
            id_api: '1',
            is_active: true,
        },
    });

    const coreMarkets = [
        // Goals
        { name: 'Team Goals', slug: 'team-goals', scope: 'team', description: 'Total goals scored by a specific team' },
        { name: 'Total Goals', slug: 'total-goals', scope: 'team', description: 'Combined goals scored by both teams in the match' },

        // Yellow Cards
        { name: 'Team Yellow Cards', slug: 'team-yellow-cards', scope: 'team', description: 'Total yellow cards received by a specific team' },
        { name: 'Total Yellow Cards', slug: 'total-yellow-cards', scope: 'team', description: 'Combined yellow cards issued to both teams in the match' },

        // Red Cards
        { name: 'Team Red Cards', slug: 'team-red-cards', scope: 'team', description: 'Total red cards received by a specific team' },
        { name: 'Total Red Cards', slug: 'total-red-cards', scope: 'team', description: 'Combined red cards issued to both teams in the match' },

        // Corner Kicks
        { name: 'Team Corner Kicks', slug: 'team-corner-kicks', scope: 'team', description: 'Total corner kicks taken by a specific team' },
        { name: 'Total Corner Kicks', slug: 'total-corner-kicks', scope: 'team', description: 'Combined corner kicks taken by both teams in the match' },

        // Half-time Goals
        { name: 'Total Goals 1st Half', slug: 'total-goals-1st-half', scope: 'team', description: 'Combined goals scored by both teams in the first half' },
        { name: 'Total Goals 2nd Half', slug: 'total-goals-2nd-half', scope: 'team', description: 'Combined goals scored by both teams in the second half' },

        // Conceded (opponent-perspective) markets
        { name: 'Team Goals Conceded', slug: 'team-goals-conceded', scope: 'team', description: 'Goals conceded by a specific team (what opponents scored against them)' },
        // { name: 'Team Corner Kicks Conceded', slug: 'team-corner-kicks-conceded', scope: 'team', description: 'Corner kicks conceded by a specific team (corners opponents took against them)' },
        // { name: 'Team Yellow Cards Conceded', slug: 'team-yellow-cards-conceded', scope: 'team', description: 'Yellow cards the opponent received (opponent aggression against this team)' }

        // Team Statistics widget - comparison stats, not streak-eligible markets
        // (never added to STREAK_CHECK_SLUGS/TARGET_SLUGS).
        { name: 'Team Goals 1st Half', slug: 'team-goals-1st-half', scope: 'team', description: 'Goals scored by a specific team in the first half' },
        { name: 'Team Goals 2nd Half', slug: 'team-goals-2nd-half', scope: 'team', description: 'Goals scored by a specific team in the second half' },
        { name: 'Team Possession', slug: 'team-possession', scope: 'team', description: 'Ball possession percentage for a specific team' },
        { name: 'Team Shots', slug: 'team-shots', scope: 'team', description: 'Total shots taken by a specific team' },
        { name: 'Team Clean Sheets', slug: 'team-clean-sheets', scope: 'team', description: 'Per-match 1/0 - whether a specific team conceded zero goals that match' },

        // Boolean/categorical markets - no numeric threshold, avg_value ends up being
        // an occurrence RATE (same trick as team-clean-sheets above), and the streak
        // is "N consecutive matches with the same 1/0 outcome" rather than "N
        // consecutive matches over/under a line". 1 = the "positive" side of the
        // pair, chosen explicitly so avg_value has one unambiguous meaning:
        //   oddeven:          1 = total match goals were ODD, 0 = EVEN. avg_value = odd-rate.
        //   both-teams-score: 1 = both teams scored (BTTS yes), 0 = no. avg_value = BTTS-yes rate.
        { name: 'Odd/Even', slug: 'oddeven', scope: 'team', description: 'Per-match 1/0 - whether total match goals were odd (1) or even (0)' },
        { name: 'Both Teams Score', slug: 'both-teams-score', scope: 'team', description: 'Per-match 1/0 - whether both teams scored in that match' },
    ];

    for (const market of coreMarkets) {
        await prisma.market.upsert({
            where: { slug: market.slug },
            update: {},
            create: {
                sport_id: football.id,
                name: market.name,
                slug: market.slug,
                scope: market.scope,
                description: market.description,
            },
        });
    }

    console.log('Manual seeding completed successfully');
}

main()
    .catch((e) => {
        console.error('Error during seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });