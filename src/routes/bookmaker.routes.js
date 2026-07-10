const express = require('express');
const multer = require('multer');
const path = require('path');
const bookmakersController = require('../controllers/bookmakers.controller');
const router = express.Router();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/media');
    },
    filename: function (req, file, cb) {
        // Grabs the exact string sent from the frontend
        const exactName = req.body.name;

        // Appends the original file extension (e.g., .png, .jpg)
        cb(null, exactName + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

router.get('/bookmakers', bookmakersController.getBookmakersData)

router.get('/inuse-regions', bookmakersController.getInUseRegions)

router.post('/affiliate-link', bookmakersController.changeAffiliateLink)

router.post('/set-default', bookmakersController.changeDefault)

router.post('/change-active-status', bookmakersController.changeStatus)

router.post('/change-bookmaker-region', bookmakersController.changeBookmakerRegion)

router.post('/remove-bookmaker-region', bookmakersController.removeBookmakerRegion)

router.post('/add-bookmaker', upload.single('logo'), bookmakersController.addBookmaker)

router.post('/delete-bookmaker/:id', bookmakersController.deleteBookmaker)

module.exports = router;