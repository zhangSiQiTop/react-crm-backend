'use strict';


module.exports = function(model) {
    return function(req, res) {
        var body = req.swagger.params.body.value;
        var bodyId = body.id;

        delete body.id;

        model.update(body, {
            where: {
                id: bodyId
            }
        }).then(function(ids) {
            var id = ids[0];

            if(id) {
                model.findOne({
                    id: id
                }).then(function(result) {
                    res.json(result.dataValues);
                }).catch(function(err) {
                    res.status(403).json({
                        message: err.message,
                        errors: err.errors,
                        warnings: []
                    });
                });
            }
            else {
                // TODO: specify this case better
                res.status(403).json({
                    message: 'NOT_FOUND'
                });
            }
        }).catch(function(err) {
            res.status(403).json({
                message: err.message,
                errors: err.errors,
                warnings: []
            });
       });
    };
};
