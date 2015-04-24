'use strict';
var assert = require('assert');
var url = require('url');

var axios = require('axios');
require('promise.prototype.finally');

var Promise = require('bluebird');
var generators = require('annogenerate');
var schema2object = require('schema2object');
var waterfall = require('promise-waterfall');
var extend = require('xtend');
var fp = require('annofp');
var swaggerClient = require('swagger2client');

var config = require('../config');

config.database.test.logging = noop;

var models = require('../models')(config.database.test);
var createServer = require('../server');


module.exports = function(resourceName) {
    execute(resourceName, [
        getTests,
        postTests,
        putTests,
        sortTests,
        countTests,
        paginationTests,
        searchTests,
    ]);
};

function execute(resourceName, tests) {
    var urlRoot = 'http://localhost';
    var port = 3456;

    describe(resourceName, function() {
        connect(urlRoot, port, resourceName);

        tests.forEach(function(test) {
            test(resourceName);
        });

    });
}
module.exports.execute = execute;

function connect(urlRoot, port, resourceName) {
    var root = urlRoot + ':' + port;
    var server = null;

    beforeEach(function(done) {
        var that = this;

        // set up server
        createServer({
            config: config,
            models: models,
            silent: true,
        }, function(app) {
            server = app.listen(port);

            // construct client
            Promise.join(
                getData(url.resolve(root, 'v1/schema')),
                getToken(url.resolve(root, 'authenticate')),
            function(schema, token) {
                // nuke possible db
                models.sequelize.sync({force: true}).finally(function() {
                    var client = swaggerClient({
                        url: root,
                        schema: schema,
                        headers: {
                            'Authorization': 'Bearer ' + token
                        }
                    });

                    that.resource = client[resourceName + 's'];

                    done();
                });
            });
        });
    });

    afterEach(function(done) {
        server.close(done);
    });
}

function getTests(resourceName) {
    it('should GET', function(done) {
        this.resource.get().then(function(res) {
            assert(res.data.length === 0, 'Failed to get ' + resourceName + 's as expected');
        }).catch(function() {
            assert(true, 'Failed to get ' + resourceName + 's as expected');
        }).finally(done);
    });
}
module.exports.getTests = getTests;

function postTests(resourceName) {
    it('should deal with invalid POST', function(done) {
        this.resource.post().then(function() {
            assert(false, 'Posted ' + resourceName + ' even though shouldn\'t');
        }).catch(function(res) {
            var data = res.data;

            assert(true, 'Failed to post ' + resourceName + ' as expected');

            assert.equal(res.status, 422);
            assert(data.message, 'Error message exists');
            assert(data.errors, 'Errors exist');
            assert(data.warnings, 'Warnings exist');
        }).finally(done);
    });

    it('should be able to POST', function(done) {
        var resource = this.resource;
        var postSchema = resource.post.parameters[0].schema;

        resource.post(getParameters(postSchema)).then(function() {
            assert(true, 'Posted ' + resourceName + ' as expected');
        }).catch(function(err) {
            assert(false, 'Failed to post ' + resourceName, err);
        }).finally(done);
    });
}
module.exports.postTests = postTests;

function putTests(resourceName) {
    it('should be able to PUT', function(done) {
        this.resource.put().then(function() {
            assert(false, 'Updated ' + resourceName + ' even though shouldn\'t');
        }).catch(function() {
            assert(true, 'Failed to update ' + resourceName + ' as expected');
        }).finally(done);
    });

    it('should be able to POST and PUT', function(done) {
        var resource = this.resource;
        var postSchema = resource.post.parameters[0].schema;
        var putParameters = getParameters(postSchema);

        waterfall([
            resource.post.bind(null, getParameters(postSchema)),
            attachData.bind(null, putParameters),
            resource.put.bind(null),
            resource.get.bind(null)
        ]).then(function(res) {
            var item = res.data[0];

            fp.each(function(k, v) {
                assert.equal(v, item[k], k + ' fields are equal');
            }, putParameters);

            assert(true, 'Updated ' + resourceName + ' as expected');
        }).catch(function() {
            assert(false, 'Didn\'t update ' + resourceName + ' even though should have');
        }).finally(done);
    });
}
module.exports.putTests = putTests;

function sortTests() {
    it('should be able to perform an ascending sort', function(done) {
        var resource = this.resource;
        var postSchema = resource.post.parameters[0].schema;
        var firstItem = getParameters(postSchema);
        var secondItem = getParameters(postSchema);

        firstItem.name = 'b';
        secondItem.name = 'a';

        waterfall([
            resource.post.bind(null, firstItem),
            resource.post.bind(null, secondItem),
            resource.get.bind(null, {
                sortBy: 'name'
            })
        ]).then(function(res) {
            var data = res.data;

            assert.equal(data.length, 2, 'Received the right amount of items');
            assert.equal(data[0].name, secondItem.name, 'Received the right first name');
            assert.equal(data[1].name, firstItem.name, 'Received the right second name');
        }).catch(function() {
            assert(false, 'Didn\'t get ascending sort');
        }).finally(done);
    });

    it('should be able to perform a descending sort', function(done) {
        var resource = this.resource;
        var postSchema = resource.post.parameters[0].schema;
        var firstItem = getParameters(postSchema);
        var secondItem = getParameters(postSchema);

        firstItem.name = 'a';
        secondItem.name = 'b';

        waterfall([
            resource.post.bind(null, firstItem),
            resource.post.bind(null, secondItem),
            resource.get.bind(null, {
                sortBy: '-name'
            })
        ]).then(function(res) {
            var data = res.data;

            assert.equal(data.length, 2, 'Received the right amount of items');
            assert.equal(data[0].name, secondItem.name, 'Received the right first name');
            assert.equal(data[1].name, firstItem.name, 'Received the right second name');
        }).catch(function() {
            assert(false, 'Didn\'t get descending sort');
        }).finally(done);
    });
}
module.exports.sortTests = sortTests;

function countTests() {
    it('should be able to return a count in header', function(done) {
        this.resource.get().then(function(res) {
            assert.equal(res.headers['total-count'], 0, 'Received the right count');
        }).catch(function() {
            assert(false, 'Didn\'t get count');
        }).finally(done);
    });

    it('should be able to count multiple', function(done) {
        var resource = this.resource;
        var postSchema = resource.post.parameters[0].schema;

        waterfall([
            resource.post.bind(null, getParameters(postSchema)),
            resource.post.bind(null, getParameters(postSchema)),
            resource.get.bind(null)
        ]).then(function(res) {
            assert.equal(res.headers['total-count'], 2, 'Received the right count');
        }).catch(function() {
            assert(false, 'Didn\'t get count');
        }).finally(done);
    });
}
module.exports.countTests = countTests;

function paginationTests() {
    it('should be able to paginate', function(done) {
        var resource = this.resource;
        var postSchema = resource.post.parameters[0].schema;
        var firstItem = getParameters(postSchema);
        var secondItem = getParameters(postSchema);

        firstItem.name = 'b';
        secondItem.name = 'a';

        waterfall([
            resource.post.bind(null, firstItem),
            resource.post.bind(null, secondItem),
            resource.get.bind(null, {
                page: 0,
                perPage: 1
            })
        ]).then(function(res) {
            var data = res.data;

            assert.equal(data.length, 1, 'Received the right amount of items');
            assert.equal(data[0].name, firstItem.name, 'Received the right first name');
        }).catch(function() {
            assert(false, 'Didn\'t get paginated items');
        }).finally(done);
    });
}
module.exports.paginationTests = paginationTests;

function searchTests() {
    it('should be able to search all', function(done) {
        done();
    });

    it('should be able to search by field', function(done) {
        done();
    });
}
module.exports.searchTests = searchTests;

function attachData(initialData, res) {
    return new Promise(function(resolve) {
        resolve(extend({
            id: res.data.id
        }, initialData));
    });
}

function getParameters(schema) {
    return schema2object.properties2object({
        generators: generators,
        properties: schema2object.getRequiredProperties(schema)
    });
}

function getData(u, o) {
    return new Promise(function(resolve, reject) {
        axios.get(u, o).then(function(res) {
            resolve(res.data);
        }).catch(reject);
    });
}

function getToken(u) {
    return new Promise(function(resolve, reject) {
        axios.post(u).then(function(res) {
            resolve(res.data.token);
        }).catch(reject);
    });
}

function noop() {}
