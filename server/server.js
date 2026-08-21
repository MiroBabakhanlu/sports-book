const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/utils/swagger');
const { connectDB } = require('./src/utils/prisma');
const errorMiddleware = require('./src/middlewares/errorMiddleware');
const authMiddleware = require('./src/middlewares/authMiddleware');
const teamsRoutes = require('./src/routes/team.routes');
const adminRoutes = require('./src/routes/admin.routes');
const bookmakerRoutes = require('./src/routes/bookmaker.routes');

//main routes
const bookmakersRoutes = require('./src/routes/main/bookmakers.routes');
const leaguesRoutes = require('./src/routes/main/leagues.routes');
const streaksRoutes = require('./src/routes/main/streaks.routes');
const streakChangesRoutes = require('./src/routes/main/streak-changes.routes');
const clicksRoutes = require('./src/routes/main/clicks.routes');
const matchupRoutes = require('./src/routes/main/matchup.routes');
const standingsRoutes = require('./src/routes/main/standings.routes');
const generalInfoRoutes = require('./src/routes/main/general-info.routes');

const { runPipelines } = require('./pop-db');
const { runOddsPipeline } = require('./odds-pipeline');
const { startStreakWorker } = require('./streak-tracker');
const { startStreakSyncScheduler } = require('./streak-sync-scheduler');
const { backfillStreakResults } = require('./backfill-streak-results');
const { fixPushResults } = require('./fix-push-results');


const targetLeagues = [
    // [140, 2025],
    // [39, 2026],
    // [39, 2025],
    // [135, 2025],
    // [253, 2026],
    // [71, 2026],
    // [169, 2026],
    // [98, 2026],
    [253, 2026],
    [169, 2025],
    [292, 2026],
    [293, 2026],
    // [245, 2026],
    [244, 2026],
    [242, 2026],
    [268, 2026],
    [253, 2026],
    [169, 2026],
    [71, 2026],
    [72, 2026],
    [103, 2026], //good
    [479, 2026], //good
    [113, 2026], //good
    [361, 2026], //good
    [364, 2026], // good

];

const activeLeagues = [
    // [39, 2026],
    // [253, 2026],
    // [71, 2026],
    // [169, 2026],
    // [292, 2026],
    // [253, 2026],
    // [98, 2026],
    // [292, 2026],
    [253, 2026],
    [169, 2025],
    [292, 2026],
    [293, 2026],
    // [245, 2026],
    [244, 2026],
    [242, 2026],
    [268, 2026],
    [253, 2026],
    [169, 2026],
    [71, 2026],
    [72, 2026],
    [103, 2026], //good
    [479, 2026], //good
    [113, 2026], //good
    [361, 2026], //good
    [364, 2026], // good

];
const newLeagues = [
    // [98, 2026] //
    // [106, 2026] //
    // [103, 2026], //good
    // [479, 2026], //good
    // [113, 2026], //good
    // [361, 2026], //good
    // [364, 2026], // good
    // [487, 2026] 
    [169, 2026]
]


const correctLeagues = [
    [253, 2026],
    [169, 2026],
    [71, 2026],
    [72, 2026],
    [103, 2026], //good
    [113, 2026], //good
];


const app = express();
dotenv.config();

// Deliberately NOT applied app-wide: most of /api/admin, /api/teams,
// /api/bookmaker are only ever called same-origin by the admin panel this
// same server serves from public/, and gating those too would reject the
// admin panel's own requests for no reason. Only applied to the specific
// routes that are genuinely called cross-origin (see src/utils/cors.js).
const { corsOptions } = require('./src/utils/cors');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'media')));




app.use('/api/teams', teamsRoutes);
app.use('/api/admin', adminRoutes)
app.use('/api/bookmaker', bookmakerRoutes)



//main routes whihc main site will use - guarded by Bearer token auth (authMiddleware)
// cors() here (not app-wide) since these are the only routes the separately-
// hosted client actually calls cross-origin.
app.use('/api/bookmakers', cors(corsOptions), authMiddleware, bookmakersRoutes)
app.use('/api/leagues', cors(corsOptions), authMiddleware, leaguesRoutes)
// streakChangesRoutes registered BEFORE streaksRoutes - it defines /changes
// and /changes/ack, and streaksRoutes' GET /:id would otherwise swallow
// "/changes" as if "changes" were a streak id, since Express matches routes
// in registration order.
app.use('/api/streaks', cors(corsOptions), authMiddleware, streakChangesRoutes)
app.use('/api/streaks', cors(corsOptions), authMiddleware, streaksRoutes)
app.use('/api/clicks', cors(corsOptions), authMiddleware, clicksRoutes)
app.use('/api/matchup', cors(corsOptions), authMiddleware, matchupRoutes)
app.use('/api/standings', cors(corsOptions), authMiddleware, standingsRoutes)
app.use('/api/general-info', cors(corsOptions), authMiddleware, generalInfoRoutes)

// Swagger UI for the main-site endpoints above. Docs live as @openapi JSDoc
// blocks next to each route (src/routes/main/*.routes.js) so they can't drift
// out of sync with a separately-maintained spec file.
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


const port = process.env.PORT || 8080;
app.use(errorMiddleware);
app.listen(port, async () => {
    try {
        console.log(process.env.DATABASE_URL)
        await connectDB();
        // runPipelines(correctLeagues)

        // runOddsPipeline(correctLeagues);
        // startStreakWorker(correctLeagues);
        startStreakSyncScheduler();
        // backfillStreakResults(30);
        // fixPushResults();

        // require('./update-db');
    } catch (err) {
        console.error('Shutting down server due to DB connection failure');
        process.exit(1);
    }
    console.log('server is on: http://localhost:8080')
})