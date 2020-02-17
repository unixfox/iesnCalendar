'use strict';

const express = require('express');
const app = express();
const axios = require("axios");
const iconv = require('iconv-lite');
const fs = require('fs');
const https = require('https');
const queryString = require('query-string');
const rp = require('request-promise');
const rax = require('retry-axios');
const fsPromises = require("fs").promises;
const moment = require('moment');

function getFileUpdatedDate(path) {
    const stats = fs.statSync(path)
    return stats.mtime
}

function checkFileExist(path) {
    if (fs.existsSync(path))
        return (true);
    else
        return (false);
}

async function getBearerToken() {
    console.log("login page");
    const requestSessionDataKey = axios.create({
        method: 'get',
        timeout: 1000,
        url: 'https://portail.henallux.be/login',
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.132 Safari/537.36'
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        }),
        raxConfig: {
            // Retry 3 times on requests that return a response (500, etc) before giving up.  Defaults to 3.
            retry: 5,

            // Retry twice on errors that don't return a response (ENOTFOUND, ETIMEDOUT, etc).
            noResponseRetries: 9999,

            // Milliseconds to delay at first.  Defaults to 100.
            retryDelay: 100,

            // HTTP methods to automatically retry.  Defaults to:
            // ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT']
            httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT'],

            // The response status codes to retry.  Supports a double
            // array with a list of ranges.  Defaults to:
            // [[100, 199], [429, 429], [500, 599]]
            statusCodesToRetry: [[100, 199], [429, 429], [500, 599]],

            // You can detect when a retry is happening, and figure out how many
            // retry attempts have been made
            onRetryAttempt: (err) => {
                const cfg = rax.getConfig(err);
                console.log(`Retry attempt #${cfg.currentRetryAttempt}`);
            }
        }
    });
    const interceptorId = rax.attach(requestSessionDataKey);
    const requestSessionDataKeyParams = await queryString.parse(requestSessionDataKey.get().request.res.responseUrl);
    console.log("requesting id");
    const options = {
        method: 'POST',
        uri: 'https://auth.henallux.be/commonauth',
        form: {
            username: process.env.PORTAL_USERNAME,
            password: process.env.PORTAL_PASSWORD,
            sessionDataKey: requestSessionDataKeyParams["sessionDataKey"]
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.132 Safari/537.36'
        },
        rejectUnauthorized: false,
        followAllRedirects: true,
        jar: true
    };
    console.log("done");
    const portalHTMLCode = await rp(options);
    const bearerRegex = /window\['auth_user_token'] = \'(.+)\';/;
    const bearerToken = bearerRegex.exec(portalHTMLCode)[1];
    return bearerToken;
}

let bearerToken;
if (checkFileExist("./credentials.json")) {
    fsPromises.readFile("./credentials.json").then(body => {
        bearerToken = (JSON.parse(body)).bearerToken;
    });
}
else {
    bearerToken = getBearerToken();
}

app.get(['/'], async (req, res) => {
    console.log("request");
    const year = req.query.year;
    let group = req.query.group;
    const orientation = (req.query.orientation.toUpperCase() || 'TI');
    const timeoutBeforeRefresh = 1800000;
    const nameICS = orientation + '-' + year + "-" + group;
    const filename = nameICS + ".ics";
    if (group.includes(".ics"))
        group = group.replace(".ics", "");


    if (!year) {
        res.status(400).send("L'année est invalide ou manquante.");
        return;
    }
    else if (!group) {
        res.status(400).send("Le groupe est invalide ou manquant.");
        return;
    }

    res.set({
        'content-type': 'text/Calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="' + filename + '"'
    });

    const instance = axios.create({
        baseURL: 'https://portail.henallux.be/api/',
        timeout: 10000,
        headers: {
            'Authorization': 'Bearer ' + bearerToken,
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.132 Safari/537.36',
        },
        validateStatus: function (status) {
            return status < 500;
        }
    });
    try {
        if (!checkFileExist("./" + filename) || Math.abs(new Date(new Date().toUTCString()) - getFileUpdatedDate("./" + filename)) >= timeoutBeforeRefresh) {
            const requestOrientations = await (instance.get('/orientations'));
            const implantationCode = await requestOrientations.data.data.filter(d => d.code == orientation)[0].id_implantation;
            const requestOrientationCode = await (instance.get('/orientations/implantation/' + implantationCode));
            const orientationCode = await requestOrientationCode.data.data.filter(d => d.code == orientation)[0].key;
            const requestYearCode = await (instance.get('/classes/orientation_and_implantation/' + orientationCode + '/' + implantationCode));
            const yearCode = requestYearCode.data.data.filter(d => d.annee.includes(year))[0].key;
            const requestGroupCode = await (instance.get('/classes/classe_and_orientation_and_implantation/' + yearCode + '/' + orientationCode + '/' + implantationCode));
            let groupCode;
            if (requestGroupCode.data.count == 1) {
                groupCode = requestGroupCode.data.data[0].key;
            }
            else {
                groupCode = requestGroupCode.data.data.filter(d => d.classe == group)[0].key;
            }
            const requestIcalFile = await (instance.get('/plannings/promotion/[%22' + groupCode + '%22]/ical'));
            let icalFile = requestIcalFile.data;
            const getEndDate = icalFile.match(/X-CALEND:(?<date>\d{4}\d{2}\d{2}T\d{2}\d{2}\d{2}Z)/).groups.date;
            const parsedEndDate = moment(getEndDate).format("X");
            const timestampNow = moment().format("X");
            if (parsedEndDate > timestampNow) {
                icalFile = icalFile.replace(/METHOD:PUBLISH/g, "METHOD:PUBLISH\nX-WR-TIMEZONE:Europe/Brussels");
                fs.writeFile("./" + filename, icalFile, function (err) {
                    if (err) {
                        return console.log(err);
                    }
                    icalFile = iconv.decode(new Buffer(icalFile), "ISO-8859-1");
                    res.send(new Buffer(icalFile, 'binary'));
                });
            }
            else {
                fs.readFile("./" + filename, 'utf8', function (err, contents) {
                    contents = iconv.decode(new Buffer(contents), "ISO-8859-1");
                    res.send(new Buffer(contents, 'binary'));
                });
            }
        }
        else {
            fs.readFile("./" + filename, 'utf8', function (err, contents) {
                contents = iconv.decode(new Buffer(contents), "ISO-8859-1");
                res.send(new Buffer(contents, 'binary'));
            });
        }
    }
    catch (error) {
        res.status(500);
        res.set({
            'content-type': 'text/html; charset=utf-8'
        });
        res.send("Un problème est survenu, veuillez réessayer plus tard et partager le lien ainsi que l'erreur suivante : <br>" + String(error));
    }
});

app.all('*', function (req, res) {
    const response = "Route not found!";
    res.status(400).send(response);
});

app.listen(process.env.PORT || 3000);
