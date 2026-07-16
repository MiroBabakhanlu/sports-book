const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { connectDB } = require('./src/utils/prisma');
const errorMiddleware = require('./src/middlewares/errorMiddleware');
const teamsRoutes = require('./src/routes/team.routes');
const adminRoutes = require('./src/routes/admin.routes');
const bookmakerRoutes = require('./src/routes/bookmaker.routes');

//main routes
const bookmakersRoutes = require('./src/routes/main/bookmakers.routes');
const leaguesRoutes = require('./src/routes/main/leagues.routes');

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



//main routes whihc main site will use
app.use('/api/bookmakers', bookmakersRoutes)
app.use('/api/leagues', leaguesRoutes)


const port = process.env.PORT || 8080;
app.use(errorMiddleware);
app.listen(port, async () => {
    try {
        console.log(process.env.DATABASE_URL)
        await connectDB();
        runPipelines(targetLeagues)

        // runOddsPipeline(activeLeagues);
        // startStreakWorker(targetLeagues);

        // require('./update-db');
    } catch (err) {
        console.error('Shutting down server due to DB connection failure');
        process.exit(1);
    }
    console.log('server is on: http://localhost:8080')
})