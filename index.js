'use strict';

const express = require('express');
const app = express();
const axios = require("axios");
const iconv = require('iconv-lite');
const fs = require('fs');
const https = require('https');
const queryString = require('query-string');
const rp = require('request-promise');

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
    const requestSessionDataKey = await axios({
        method: 'get',
        url: 'https://portail.henallux.be/login',
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.132 Safari/537.36'
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        })
    });
    const requestSessionDataKeyParams = await queryString.parse(requestSessionDataKey.request.res.responseUrl);

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

    const portalHTMLCode = await rp(options);
    const bearerRegex = /window\['auth_user_token'] = \'(.+)\';/;
    const bearerToken = bearerRegex.exec(portalHTMLCode)[1];
    return bearerToken;
}

app.get(['/'], async (req, res) => {
    const year = req.query.year;
    let group = req.query.group;
    const orientation = (req.query.orientation || 'TI');
    const timeoutBeforeRefresh = 1800000;
    if (group.includes(".ics"))
        group = group.replace(".ics", "");
    const nameICS = 'IE-' + orientation + '-' + year + "B-" + group;
    const filename = nameICS + ".ics";

    if (year == "1" &&
        !(group == "A" || group == "B" || group == "C" || group == "D" || group == "E" || group == "F" ||
            group == "G" || group == "H" || group == "I" || group == "J" || group == "K" || group == "L")) {
        res.status(400).send("Groupe invalide.");
        return;
    }
    else if (year == "2" &&
        !(group == "A" || group == "B" || group == "C" || group == "D")) {
        res.status(400).send("Groupe invalide.");
        return;
    }
    else if (year == "3" &&
        !(group == "A" || group == "B" || group == "C")) {
        res.status(400).send("Groupe invalide.");
        return;
    }
    else if (Number(year) > 3) {
        res.status(400).send("Année invalide.");
        return;
    }
    else if (!year || !group) {
        res.status(400).send("Paramètres invalides.");
        return;
    }

    res.set({
        'content-type': 'text/Calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="' + filename + '"'
    });

    const bearerToken = await getBearerToken();

    const instance = axios.create({
        baseURL: 'https://portail.henallux.be/api/',
        timeout: 1000,
        headers: {
            'Authorization': 'Bearer ' + bearerToken,
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.132 Safari/537.36',
        }
    });

    if (!checkFileExist("./" + filename) || Math.abs(new Date(new Date().toUTCString()) - getFileUpdatedDate("./" + filename)) >= timeoutBeforeRefresh) {
        const requestOrientationCode = await (instance.get('/orientations/implantation/1'));
        const orientationCode = await requestOrientationCode.data.data.filter(d => d.code == orientation)[0].key;
        const requestYearCode = await (instance.get('/classes/orientation_and_implantation/' + orientationCode + '/1'));
        const yearCode = requestYearCode.data.data.filter(d => d.annee == year + 'B')[0].key;
        const requestGroupCode = await (instance.get('/classes/classe_and_orientation_and_implantation/' + yearCode + '/' + orientationCode + '/1'));
        const groupCode = requestGroupCode.data.data.filter(d => d.classe == group)[0].key;
        const requestIcalFile = await (instance.get('/plannings/promotion/[%22' + groupCode + '%22]/ical'));
        let icalFile = requestIcalFile.data;
        icalFile = icalFile.replace(/Z/g, "");
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
});

app.all('*', function (req, res) {
    const response = "Route not found!";
    res.status(400).send(response);
});

app.listen(process.env.PORT || 3000);