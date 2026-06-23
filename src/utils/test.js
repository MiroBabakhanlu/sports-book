import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.SPORT_API_KEY || 'be6628089266c3f9779a94c9744b1dcf';
const BASE_URL = 'https://v3.football.api-sports.io';

// 💡 SETTING: Set to 3 to test a few batches. Set to 0 to run the ENTIRE season (all 380 matches).
const BATCH_LIMIT = 3;

// Helper to split array into chunks of a specific size
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Helper to introduce a tiny delay between API calls
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runBatchTest() {
    let totalApiRequests = 0;
    let totalMatchesProcessed = 0;

    try {
        console.log('--- STARTING BATCHING TEST ---');
        console.log('Step 1: Fetching all finished match IDs for La Liga 2024...');

        // Initial request to get the season schedule
        const listResponse = await axios.get(`${BASE_URL}/fixtures`, {
            headers: { 'x-apisports-key': API_KEY },
            params: { league: 140, season: 2024, status: 'FT' }
        });

        totalApiRequests++;
        const fixtures = listResponse.data.response;

        if (!fixtures || fixtures.length === 0) {
            console.log('❌ No fixtures found. Check your API key or parameters.');
            return;
        }

        const allFixtureIds = fixtures.map(f => f.fixture.id);
        console.log(`✅ Found a total of ${allFixtureIds.length} completed matches for the season.`);

        // Step 2: Chunk the IDs into groups of 20
        const chunks = chunkArray(allFixtureIds, 20);
        console.log(`Step 2: Split matches into ${chunks.length} batches of up to 20 IDs each.`);

        // Determine how many batches we will actually execute for this test
        const batchesToRun = BATCH_LIMIT > 0 ? chunks.slice(0, BATCH_LIMIT) : chunks;
        console.log(`Step 3: Preparing to execute ${batchesToRun.length} batch requests...\n`);

        // Step 3: Loop through chunks and execute requests
        for (let i = 0; i < batchesToRun.length; i++) {
            const currentChunk = batchesToRun[i];
            const idsString = currentChunk.join('-');

            console.log(`🚀 [API Request #${totalApiRequests + 1}] Sending batch ${i + 1}/${chunks.length} containing ${currentChunk.length} IDs...`);

            const batchResponse = await axios.get(`${BASE_URL}/fixtures`, {
                headers: { 'x-apisports-key': API_KEY },
                params: { ids: idsString }
            });

            totalApiRequests++;
            const returnedMatches = batchResponse.data.response || [];
            totalMatchesProcessed += returnedMatches.length;

            console.log(`   └─ Success! Received data for ${returnedMatches.length} matches.`);

            // Verify that the statistics array exists on the first item of this batch
            if (returnedMatches.length > 0) {
                const sampleMatch = returnedMatches[0];
                const hasStats = sampleMatch.statistics && sampleMatch.statistics.length > 0;
                console.log(`   └─ Sanity Check: Stats embedded for "${sampleMatch.teams.home.name}"? ${hasStats ? 'YES ✅' : 'NO ❌'}`);
            }

            // Add a 200ms delay to stay safe with rate limits
            await delay(200);
        }

        // --- FINAL METRIC LOGS ---
        console.log('\n======================================');
        console.log('           TEST SUMMARY               ');
        console.log('======================================');
        console.log(`Total Matches Discovered:  ${allFixtureIds.length}`);
        console.log(`Total Batches Created:     ${chunks.length}`);
        console.log(`Total Batches Executed:    ${batchesToRun.length}`);
        console.log(`Total Matches Processed:   ${totalMatchesProcessed}`);
        console.log(`TOTAL API REQUESTS SENT:   ${totalApiRequests}`);
        console.log('======================================');

    } catch (error) {
        console.error('\n❌ Error running batch test:', error.response ? error.response.data : error.message);
    }
}

runBatchTest();