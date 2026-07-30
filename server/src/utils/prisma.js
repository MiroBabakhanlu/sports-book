const dotenv = require('dotenv');
dotenv.config();

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
    throw new Error('DATABASE_URL is missing in environment variables');
}


const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
});

async function connectDB() {
    try {
        await prisma.$connect();
        console.log('Connected to Railway PostgreSQL database successfully');
    } catch (error) {
        console.error(' Database connection failed:', error.message);
        console.error('Connection string:', connectionString.replace(/:[^@]*@/, ':***@'));
        throw error;
    }
}

async function disconnectDB() {
    try {
        await prisma.$disconnect();
        await pool.end();
        console.log(' Disconnected from Railway database successfully');
    } catch (error) {
        console.error('Error disconnecting:', error.message);
    }
}

module.exports = {
    prisma,
    connectDB,
    disconnectDB
};