const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { Vibrant } = require("node-vibrant/node");

/**
 * Convert RGB array to HEX
 */
const rgbToHex = ([r, g, b]) => {
    return "#" + [r, g, b]
        .map(value => value.toString(16).padStart(2, "0"))
        .join("");
};

/**
 * Calculate readable text color
 */
const getContrastText = (hex) => {
    if (!hex) return "#FFFFFF";
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? "#000000" : "#FFFFFF";
};

/**
 * Get dominant color from image buffer using sharp
 */
const getDominantColorFromBuffer = async (buffer) => {
    try {
        const { data } = await sharp(buffer)
            .resize(50, 50, { fit: 'inside' })
            .raw()
            .toBuffer({ resolveWithObject: true });

        const colorCount = {};
        let maxCount = 0;
        let dominantColor = [0, 0, 0];

        for (let i = 0; i < data.length; i += 12) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const key = `${Math.round(r / 5) * 5},${Math.round(g / 5) * 5},${Math.round(b / 5) * 5}`;
            colorCount[key] = (colorCount[key] || 0) + 1;

            if (colorCount[key] > maxCount) {
                maxCount = colorCount[key];
                const [cr, cg, cb] = key.split(',').map(Number);
                dominantColor = [cr, cg, cb];
            }
        }

        return dominantColor;
    } catch (error) {
        console.error("Dominant color extraction failed:", error);
        return [0, 0, 0];
    }
};

/**
 * Extract logo colors
 */
const getImageColors = async (base64) => {
    try {
        const imageBuffer = Buffer.from(
            base64.replace(/^data:image\/.+;base64,/, ""),
            "base64"
        );

        const pngBuffer = await sharp(imageBuffer).png().toBuffer();

        const dominantRGB = await getDominantColorFromBuffer(pngBuffer);
        const primary = rgbToHex(dominantRGB);

        const palette = await Vibrant.from(pngBuffer).getPalette();
        const secondary = palette.Vibrant?.hex ||
            palette.LightVibrant?.hex ||
            palette.Muted?.hex ||
            primary;

        return {
            color_primary: primary,
            color_secondary: secondary,
            text_color: getContrastText(primary)
        };
    } catch (error) {
        console.error("Color extraction failed:", error);
        return {
            color_primary: "#000000",
            color_secondary: "#666666",
            text_color: "#FFFFFF"
        };
    }
};

/**
 * Format bookmaker response
 */
const formatBookmakerResponse = (bookmaker) => {
    if (!bookmaker) return null;

    return {
        id: bookmaker.id,
        label: bookmaker.name.toUpperCase(),
        affiliate_link: bookmaker.affiliate_link || bookmaker.affiliate_url,
        text_color: bookmaker.text_color || "#FFFFFF",
        color_primary: bookmaker.color_primary || "#000000",
        color_secondary: bookmaker.color_secondary || "#666666",
        active: bookmaker.is_active
    };
};

/**
 * Resolve bookmaker logo
 */
const resolveBookmakerLogo = async (bookmaker) => {
    if (!bookmaker) return bookmaker;

    // Find local logo
    if (!bookmaker.logo_url) {
        try {
            const mediaPath = path.join(__dirname, "../../public/media");
            console.log("Looking for logos in:", mediaPath);

            if (fs.existsSync(mediaPath)) {
                const mediaFiles = fs.readdirSync(mediaPath);
                console.log("Files in media folder:", mediaFiles);

                const matchedFile = mediaFiles.find(file => {
                    const ext = path.extname(file);
                    const baseName = path.basename(file, ext);
                    return (baseName.toLowerCase() === bookmaker.name.toLowerCase());
                });

                if (matchedFile) {
                    console.log("Found matching file:", matchedFile);
                    const filePath = path.join(mediaPath, matchedFile);
                    const fileBuffer = fs.readFileSync(filePath);
                    const fileExt = path.extname(matchedFile).toLowerCase().replace(".", "");
                    let mimeType = `image/${fileExt}`;
                    switch (fileExt) {
                        case "svg":
                            mimeType = "image/svg+xml";
                            break;
                        case "jpg":
                            mimeType = "image/jpeg";
                            break;
                        case "ico":
                            mimeType = "image/x-icon";
                            break;
                    }
                    bookmaker.logo_url = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;
                    console.log("Logo loaded successfully");
                } else {
                    console.log("No matching file found for:", bookmaker.name);
                }
            } else {
                console.log("Media path does not exist:", mediaPath);
            }
        } catch (error) {
            console.error(`Failed loading logo for ${bookmaker.name}`, error);
        }
    }

    // Extract colors
    if (bookmaker.logo_url) {
        const colors = await getImageColors(bookmaker.logo_url);
        bookmaker.color_primary = colors.color_primary;
        bookmaker.color_secondary = colors.color_secondary;
        bookmaker.text_color = colors.text_color;
        console.log("Colors extracted:", {
            primary: colors.color_primary,
            secondary: colors.color_secondary,
            text: colors.text_color
        });
    } else {
        // Set default colors if no logo
        console.log("No logo found, using default colors");
        bookmaker.color_primary = "#000000";
        bookmaker.color_secondary = "#666666";
        bookmaker.text_color = "#FFFFFF";
    }

    return bookmaker;
};

// Export all functions
module.exports = {
    rgbToHex,
    getContrastText,
    getDominantColorFromBuffer,
    getImageColors,
    resolveBookmakerLogo,
    formatBookmakerResponse
};