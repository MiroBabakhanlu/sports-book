const { prisma } = require("../utils/prisma");
const AppError = require("../middlewares/AppError");
const fs = require('fs');
const path = require('path');

const bookmakerService = {
    getBookmakersData: async () => {
        const bookmakers = await prisma.bookmaker.findMany({
            include: {
                regions: true,
            },
            orderBy: { name: 'asc' }
        });

        if (!bookmakers) {
            throw new AppError('Bookmakers not found', 404);
        }

        const mediaPath = path.join(__dirname, '../.././public/media');
        const mediaFiles = fs.readdirSync(mediaPath);

        const bookmakersWithLogo = bookmakers.map(bookmaker => {
            const logoFile = mediaFiles.find(file => {
                const fileName = path.parse(file).name;
                return fileName.toLowerCase() === bookmaker.name.toLowerCase();
            });

            return {
                ...bookmaker,
                logo_url: logoFile ? `../media/${logoFile}` : null
            };
        });

        return bookmakersWithLogo;
    },

    getInUseRegions: async () => {
        const inUseRegions = await prisma.bookmakerRegion.findMany({
            where: {
                region_code: {
                    not: null // Exclude draft/empty configurations
                }
            },
            select: {
                region_code: true
            }
        });

        // Flatten the array of objects into a simple array of strings
        return inUseRegions.map(item => item.region_code);
    },

    // FIX 1: Changed from "name" to "id" to support non-unique bookmaker names
    changeAffiliateLink: async (id, value) => {
        if (!id || !value) {
            throw new AppError('bookmaker ID and value are required', 400);
        }

        const bookmaker = await prisma.bookmaker.update({
            where: {
                id: parseInt(id)
            },
            data: {
                affiliate_link: value
            }
        });

        return bookmaker;
    },

    changeDefault: async (bookmakerId) => {
        const id = parseInt(bookmakerId);

        return await prisma.$transaction(async (tx) => {
            // 1. Reset all bookmakers to NOT default
            await tx.bookmaker.updateMany({
                where: { is_default: true },
                data: { is_default: false }
            });

            // 2. NEW: Clear all regions for this bookmaker so these regions 
            // are freed up for other non-default bookmakers to use
            await tx.bookmakerRegion.deleteMany({
                where: { bookmaker_id: id }
            });

            // 3. Set the selected bookmaker to default
            const updatedBookmaker = await tx.bookmaker.update({
                where: { id: id },
                data: { is_default: true }
            });

            return updatedBookmaker;
        });
    },

    changeStatus: async (id, newStatus) => {
        if (!id || newStatus === undefined) {
            throw new AppError('bookmakerId and newStatus are required', 400);
        }

        const bookmaker = await prisma.bookmaker.update({
            where: {
                id: id
            },
            data: {
                is_active: newStatus
            }
        });

        return bookmaker;
    },

    // FIX 2: Updated query to use the new global unique constraint on region_code
    changeBookmakerRegion: async (id, regionCode) => {
        if (!id || !regionCode) {
            throw new AppError('bookmakerId and regionCode are required', 400);
        }

        const bookmakerId = parseInt(id);
        const upperRegionCode = regionCode.toUpperCase().trim();

        // Find the region using the single unique property
        const existingRegion = await prisma.bookmakerRegion.findUnique({
            where: {
                region_code: upperRegionCode
            }
        });

        if (existingRegion) {
            // If THIS bookmaker already has it, it's a safe no-op. Just return it.
            if (existingRegion.bookmaker_id === bookmakerId) {
                return existingRegion;
            }
            // If a DIFFERENT bookmaker has it, throw an error!
            throw new AppError(`The region "${upperRegionCode}" is already assigned to another bookmaker.`, 400);
        }

        // If no one has it, create it cleanly
        return await prisma.bookmakerRegion.create({
            data: {
                bookmaker_id: bookmakerId,
                region_code: upperRegionCode,
                is_active: true
            }
        });
    },

    removeBookmakerRegion: async (bookmakerId, regionCode) => {
        if (!bookmakerId || !regionCode) {
            throw new AppError('bookmakerId and regionCode are required', 400);
        }

        const id = parseInt(bookmakerId);
        const upperRegionCode = regionCode.toUpperCase().trim();

        // deleteMany remains completely safe here because it uses optional criteria filters
        return await prisma.bookmakerRegion.deleteMany({
            where: {
                bookmaker_id: id,
                region_code: upperRegionCode
            }
        });
    },
    createBookmaker: async (data) => {
        const { name, affiliate_link, is_active, logo_url } = data;

        // Ensure defaults if left empty
        const bookmaker = await prisma.bookmaker.create({
            data: {
                name: name,
                affiliate_link: affiliate_link || null,
                is_active: is_active !== undefined ? is_active : true, // Default to true if not provided
                is_default: false, // New bookmakers should never be default upon creation
                logo_url: logo_url || null // Saves the /media/... string, or null if they didn't upload one
            }
        });

        return bookmaker;
    },
    removeBookmakerEntirely: async (bookmakerId) => {
        const id = parseInt(bookmakerId);

        return await prisma.$transaction(async (tx) => {
            // 1. Clear relational data entries (Regions) first to bypass constraints
            await tx.bookmakerRegion.deleteMany({
                where: { bookmaker_id: id }
            });

            // 2. Drop the target bookmaker identity unit completely
            const executionOutput = await tx.bookmaker.delete({
                where: { id: id }
            });

            return executionOutput;
        });
    },
}

module.exports = bookmakerService;

