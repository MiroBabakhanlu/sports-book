const clicksService = require("../../services/main/clicks.service");

const clicksController = {

    // Fire-and-forget by design (per spec): validate synchronously so obvious
    // bad requests still get a 400, but once the payload looks sane we respond
    // immediately and let the DB write happen in the background - a slow or
    // failed click-log write must never block/fail the user's click.
    logClick: async (req, res, next) => {
        try {
            clicksService.validateClickPayload(req.body);
        } catch (error) {
            return next(error);
        }

        res.status(202).json({
            success: true,
            data: { logged: true }
        });

        clicksService.logClick(req.body);
    }

};

module.exports = clicksController;
