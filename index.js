'use strict';

const express = require('express');
const request = require("request-promise");
const iconv = require('iconv-lite');
const fs = require('fs');

const app = express();

const PHPSessionID = Array(27).fill("0123456789abcdefghijklmnopqrstuvwxyz").map(function (x) { return x[Math.floor(Math.random() * x.length)] }).join('');

const getFileUpdatedDate = (path) => {
    const stats = fs.statSync(path)
    return stats.mtime
}

app.get(['/'], function (req, res) {
    const year = req.query.year;
    let group = req.query.group;
    if (group.includes(".ics"))
        group = group.replace(".ics", "");
    const nameICS = 'IE-TI-' + year + "B-" + group;
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
    else if (Number(year) >= 3) {
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

    const optionsGetICS = {
        method: 'GET',
        url: 'https://portail.henallux.be/horaire/ical/promotion/code_princ/' + nameICS,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36',
            'Cookie': 'PHPSESSID=' + PHPSessionID
        },
        followAllRedirects: true
    };

    const optionsAuthentificate = {
        method: 'POST',
        url: 'https://portail.henallux.be/auth/login/',
        form: {
            username: process.env.PORTAL_USERNAME,
            password: process.env.PORTAL_PASSWORD
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36',
            'Cookie': 'PHPSESSID=' + PHPSessionID
        },
        followAllRedirects: true
    };

    fs.readFile("./" + filename, 'ISO-8859-1', function (err, contents) {
        let timeoutBeforeRefresh = 14400000;
        if (err || Math.abs(new Date(new Date().toUTCString()) - getFileUpdatedDate("./" + filename)) >= timeoutBeforeRefresh) {
            request(optionsAuthentificate).then(function () {
                request(optionsGetICS).then(function (body) {
                    body = body.replace(/Z/g, "");
                    fs.writeFile("./" + filename, body, function (err) {
                        if (err) {
                            return console.log(err);
                        }
                        body = iconv.decode(new Buffer(body), "ISO-8859-1");
                        res.send(new Buffer(body, 'binary'));
                    });
                });
            });
        }
        else {
            res.send(new Buffer(contents, 'binary'));
        }
    });
});

app.all('*', function (req, res) {
    const response = "Route not found!";
    res.status(400).send(response);
});

app.listen(process.env.PORT || 3000);