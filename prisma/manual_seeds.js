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
        { name: 'Total Goals', slug: 'total-goals', scope: 'match', description: 'Combined goals scored by both teams in the match' },

        // Yellow Cards
        { name: 'Team Yellow Cards', slug: 'team-yellow-cards', scope: 'team', description: 'Total yellow cards received by a specific team' },
        { name: 'Total Yellow Cards', slug: 'total-yellow-cards', scope: 'match', description: 'Combined yellow cards issued to both teams in the match' },

        // Red Cards
        { name: 'Team Red Cards', slug: 'team-red-cards', scope: 'team', description: 'Total red cards received by a specific team' },
        { name: 'Total Red Cards', slug: 'total-red-cards', scope: 'match', description: 'Combined red cards issued to both teams in the match' },

        // Corner Kicks
        { name: 'Team Corner Kicks', slug: 'team-corner-kicks', scope: 'team', description: 'Total corner kicks taken by a specific team' },
        { name: 'Total Corner Kicks', slug: 'total-total-clicks', scope: 'match', description: 'Combined corner kicks taken by both teams in the match' }
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

    console.log('✅ Manual seeding completed successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Error during seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });