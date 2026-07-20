const swaggerJsdoc = require('swagger-jsdoc');

// Docs are written as JSDoc `@openapi` blocks directly above each route
// definition (see src/routes/main/*.routes.js), so the spec never drifts
// from the actual route file - no separate YAML/JSON to keep in sync.
const options = {
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'Sports Book - Main API',
            version: '1.0.0',
            description: 'Public-facing endpoints consumed by the main site (bookmakers, leagues, streaks).'
        },
        servers: [
            { url: '/api', description: 'Current host' }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'Shared API token issued to the frontend. Send as: Authorization: Bearer <token>'
                }
            }
        },
        security: [{ bearerAuth: [] }]
    },
    // Glob patterns are resolved relative to process.cwd() (i.e. the project root
    // server.js is launched from), not this file's own directory.
    apis: ['./src/routes/main/*.routes.js']
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
