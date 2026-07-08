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
    changeAffiliateLink: async (name, value) => {
        if (!name || !value) {
            throw new AppError('name and value are required', 400);
        }

        const bookmaker = await prisma.bookmaker.update({
            where: {
                name: name
            },
            data: {
                affiliate_link: value
            }
        });

        return bookmaker;
    },
    changeDefault: async (bookmakerId) => {
        return await prisma.$transaction(async (tx) => {
            // 1. Reset all bookmakers to NOT default
            await tx.bookmaker.updateMany({
                where: { is_default: true },
                data: { is_default: false }
            });

            // 2. Set the selected bookmaker to default
            const updatedBookmaker = await tx.bookmaker.update({
                where: { id: bookmakerId },
                data: { is_default: true }
            });

            return updatedBookmaker;
        });
    },

    changeStatus: async (id, newStatus) => {
        console.log(id, newStatus)
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
    changeBookmakerRegion: async (id, regionCode) => {
        if (!id || !regionCode) {
            throw new AppError('bookmakerId and regionCode are required', 400);
        }

        const bookmakerId = parseInt(id);
        const upperRegionCode = regionCode.toUpperCase().trim();

        // 1. Check if this bookmaker already has this region configured
        const existingRegion = await prisma.bookmakerRegion.findUnique({
            where: {
                bookmaker_id_region_code: {
                    bookmaker_id: bookmakerId,
                    region_code: upperRegionCode
                }
            }
        });

        // 2. If it exists, do nothing and simply return the existing record
        if (existingRegion) {
            return existingRegion;
        }

        // 3. If it doesn't exist, create and add it
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

        // Using deleteMany makes this operation safe even if the record doesn't exist
        return await prisma.bookmakerRegion.deleteMany({
            where: {
                bookmaker_id: id,
                region_code: upperRegionCode
            }
        });
    }


}

module.exports = bookmakerService;

