'use strict';

const fs            = require('fs');
const path          = require('path');
const formidable    = require('formidable');
const raven         = require('raven');
const aws           = require('aws-sdk');
const Promise       = require('bluebird');

const config = {
    sentryDsn: 'TODO',
    s3: {
        accessKey: 'TODO',
        bucket: 'TODO',
        secretAccessKey: 'TODO'
    }
};
var ravenClient, onError;

// req - request {Object}
// Returns a Promise which resolves to an {Object} containing {fields} and {files}
const parseFormData = (req) => {
    return new Promise((resolve, reject) => {
        formidable.IncomingForm().parse(req, (err, fields, files) => {
            if(err){
                return reject(err);
            }
            resolve({fields: fields, files: files});
        });
    });
};

// name - {String}
// contents - {String}
// Returns a Promise which resolves to a {String} URL
const uploadDumpToS3 = (name, contents) => {
    aws.config.update({
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretAccessKey
    });
    const s3 = new aws.S3({ params: {Bucket: config.s3.bucket} });
    return new Promise((resolve, reject) => {
            s3.upload({
            ACL: 'public-read',
            Key: name,
            Body: contents
        }, (err, data) => {
            if(err){
                return reject(err);
            }
            resolve(data.Location);
        });
    });
};

// context - {Object}
// req - {Object}
// res - {Object}
// Returns a Promise
module.exports = (context, req, res) => {
    onError = (error, options) => {
        if(!ravenClient){
            ravenClient = new raven.Client(config.sentryDsn, {
                release: options._version
            });
        }

        ravenClient.captureException(error, options);
        res.end('Successfully received crash and sent event to Sentry!');
    }

    return parseFormData(req)
        .then(formData => {
            const payload = {tags: formData.fields, extra: {}};
            const dump = formData.files['upload_file_minidump'];

            if (dump) {
                const contents = fs.readFileSync(dump.path).toString('utf8');

                return uploadDumpToS3(dump.name, contents)
                    .then(url => {
                        payload.extra[dump.name] = url;
                        return payload;
                    });
            }
            else {
                return payload;
            }
        })
        .then((payload) => {
            return onError(new Error(payload.tags.process_type + ' crash'), payload);
        })
        .catch((err) => onError(err, { extra: { context: context } }));
};