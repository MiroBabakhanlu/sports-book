const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { connectDB } = require('./src/utils/prisma');
const errorMiddleware = require('./src/middlewares/errorMiddleware');
const teamsRoutes = require('./src/routes/team.routes');
const { runPipelines } = require('./pop-db');
const { runOddsPipeline } = require('./odds-pipeline');
const { startStreakWorker } = require('./streak-tracker');



const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
dotenv.config();
app.use(express.static(path.join(__dirname, 'public')));


app.use('/api/teams', teamsRoutes);


const port = process.env.PORT || 8080;
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
    [245, 2026],
    [244, 2026],
    [242, 2026],
    [268, 2026],
    [253, 2026],
    [169, 2026],
    [71, 2026],
    [72, 2026],


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
    [245, 2026],
    [244, 2026],
    [242, 2026],
    [268, 2026],
    [253, 2026],
    [169, 2026],
    [71, 2026],
    [72, 2026],

];
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