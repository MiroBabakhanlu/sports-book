const dotenv = require('dotenv');
dotenv.config();

const { PrismaClient } = require('@prisma/client');
const { PrismaNeon } = require('@prisma/adapter-neon');

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
    throw new Error('❌ DATABASE_URL is missing in environment variables');
}

const adapter = new PrismaNeon({ connectionString });

const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
});

async function connectDB() {
    try {
        await prisma.$connect();
        console.log('✅ Connected to Neon database successfully');
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        throw error;
    }
}

async function disconnectDB() {
    try {
        await prisma.$disconnect();
        console.log('👋 Disconnected from Neon database successfully');
    } catch (error) {
        console.error('❌ Error disconnecting:', error.message);
    }
}

module.exports = {
    prisma,
    connectDB,
    disconnectDB
};