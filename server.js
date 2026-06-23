const express = require('express');
const dotenv = require('dotenv');
const { connectDB } = require('./src/utils/prisma');

const app = express();
dotenv.config();



const port = process.env.PORT || 8080;
app.listen(port, async () => {
    try {
        await connectDB();
    } catch (err) {
        console.error('Shutting down server due to DB connection failure.');
        process.exit(1);
    }
    console.log('server is on: http://localhost:8080')
})