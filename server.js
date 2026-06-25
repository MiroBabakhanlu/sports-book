const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { connectDB } = require('./src/utils/prisma');
const errorMiddleware = require('./src/middlewares/errorMiddleware');
const teamsRoutes = require('./src/routes/team.routes');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
dotenv.config();
app.use(express.static(path.join(__dirname, 'public')));


app.use('/api/teams', teamsRoutes);


const port = process.env.PORT || 8080;
app.use(errorMiddleware);
app.listen(port, async () => {
    try {
        await connectDB();
    } catch (err) {
        console.error('Shutting down server due to DB connection failure');
        process.exit(1);
    }
    console.log('server is on: http://localhost:8080')
})