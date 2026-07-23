const express = require('express');
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
const clicksRoutes = require('./src/routes/main/clicks.routes');
const matchupRoutes = require('./src/routes/main/matchup.routes');

const { runPipelines } = require('./pop-db');
const { runOddsPipeline } = require('./odds-pipeline');
const { startStreakWorker } = require('./streak-tracker');


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


const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
dotenv.config();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'media')));




app.use('/api/teams', teamsRoutes);
app.use('/api/admin', adminRoutes)
app.use('/api/bookmaker', bookmakerRoutes)



//main routes whihc main site will use - guarded by Bearer token auth (authMiddleware)
app.use('/api/bookmakers', authMiddleware, bookmakersRoutes)
app.use('/api/leagues', authMiddleware, leaguesRoutes)
app.use('/api/streaks', authMiddleware, streaksRoutes)
app.use('/api/clicks', authMiddleware, clicksRoutes)
app.use('/api/matchup', authMiddleware, matchupRoutes)

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
        // runPipelines(targetLeagues)

        // runOddsPipeline(activeLeagues);
        // startStreakWorker(targetLeagues);

        // require('./update-db');
    } catch (err) {
        console.error('Shutting down server due to DB connection failure');
        process.exit(1);
    }
    console.log('server is on: http://localhost:8080')
})