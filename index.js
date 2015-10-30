var fs = require('fs');
var Hapi = require('hapi');
var Boom = require('boom');
var async = require('async');
var Path = require('path');
var requestLib = require('request');
var NzbGrabber = require('nzb-grabber-js');
var slug = require('slug');
var tvDB  = require("thetvdb-api");
var tvkey = "AB3F98CFDDF1DB64";
var Datastore = require('nedb');
var mkdirp = require('mkdirp');
var ini = require('ini');
var nzbclient = null;
var parseString = require('xml2js').parseString;
var temp = require("temp").track();
var glob = require("glob");
var exec = require('child_process').exec;
var async = require('async');
var ffmpeg = require('fluent-ffmpeg');

var streamArray = [];

var config = {};
function getUserHome() {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}
function saveConfig(){
  fs.writeFileSync(process.argv[2], ini.stringify(config));
}
try {
    // Query the entry
    stats = fs.lstatSync(process.argv[2]);
    config = ini.parse(fs.readFileSync(process.argv[2], 'utf-8'))
}
catch (e) {
  console.log("Configuration file does not exists, creating it with defaults");
  config.dataDir = Path.normalize(getUserHome() + "/.cheesecake");
  config.downloadDir = Path.normalize(getUserHome() + "/.cheesecake/downloads");
  saveConfig();
}

Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};

mkdirp.sync(config.dataDir);
mkdirp.sync(config.downloadDir);
var db = {};
db.media = new Datastore(config.dataDir + "/media.db");
db.config = new Datastore(config.dataDir + "/config.db");

// You need to load each database (here we do it asynchronously)
db.media.loadDatabase();
db.config.loadDatabase();

function setupUsetnet(){
  delete nzbclient;
  if(
    config.usenetConnections &&
    config.usenetPort &&
    config.usenetServer &&
    config.usenetUsername &&
    config.usenetPassword
  ) {
    nzbclient = new NzbGrabber({
      "host": config.usenetServer,
      "port": parseInt(config.usenetPort),
      "conn": parseInt(config.usenetConnections),
      "user": config.usenetUsername,
      "pass": config.usenetPassword
    });
  }

}

setupUsetnet();

var server = new Hapi.Server();
server.connection(
  {
    port: 9595,
    routes: {
      files: {
        relativeTo: Path.join(__dirname, 'assets')
      }
    }
  }
);
server.register(require('inert'), function () {});
server.register(require('vision'), function (err) {
    if (err) {
        console.log("Failed to load vision.");
    }
});
server.views({
    engines: {
        html: require('handlebars')
    },
    path: Path.join(__dirname, '/views/layouts'),
    partialsPath: Path.join(__dirname, '/views/partials'),
    isCached: false
});

server.route({
    method: 'GET',
    path: '/assets/{filename*}',
    handler: function (request, reply) {
        return reply.file(request.params.filename);
    }
});

server.route({
    method: 'GET',
    path: '/ddir/{filename*}',
    handler: function (request, reply) {
      return reply.file(config.dataDir + "/" + request.params.filename);
    }
});
server.route({
    method: 'GET',
    path: '/',
    handler: function (request, reply) {

        reply.view("index");


    }
});

server.route({
    method: 'GET',
    path: '/libraries',
    handler: function (request, reply) {
        reply.view("libraries");

    }
});
server.route({
    method: 'GET',
    path: '/add-media',
    handler: function (request, reply) {
      reply.view("add-media");
    }
});
server.route({
    method: 'GET',
    path: '/play/{key}',
    handler: function (request, reply) {
      client.query("/library/metadata/" + request.params.key).then(function (result) {
        console.log(result);
        reply.view("play", result);
      }, function (err) {
          throw new Error("Could not connect to server");
      });


    }
});
server.route({
    method: 'GET',
    path: '/media/search/new',
    handler: function (request, reply) {
      tvDB(tvkey).getSeries(request.query.term, function(err, res) {
        if (!err){
          if(!res.Data.Series){
            reply(Boom.notFound("No media found"));
            return;
          }
          if(res.Data.Series.length){

            async.forEach(res.Data.Series, function(show, callback) {
              tvDB(tvkey).getSeriesById(show.id, function(err, res2){
                  res.Data.Series[res.Data.Series.indexOf(show)] = res2.Data.Series;
                  if(err){
                    return callback(err);
                  } else {
                    callback();
                  }
              });
            }, function(err) {
                if (err) return next(err);
                reply(res)
              }
            );
          } else {
            console.log(res.Data.Series)
            tvDB(tvkey).getSeriesById(res.Data.Series.id, function(err, res2){
                res.Data.Series = []
                res.Data.Series[0] = res2.Data.Series;
                if(err){
                  reply(err);
                } else {
                  console.log(res)
                  reply(res)
                }
            });
          }
        } else {
          reply(err);
        }
      });
    }
});
server.route({
    method: 'POST',
    path: '/api/media/tv/{key}',
    handler: function (request, reply) {
      tvDB(tvkey).getSeriesAllById(request.params.key, function(err, res) {
        if (!err){
          if(!res.Data.Series){
            reply(Boom.notFound("No media found"));
            return;
          }
          var series_info = {};
          series_info = res.Data.Series;
          series_info.CheesecakeType = "tv";
          series_info.CheesecakeInsertDate = new Date();
          series_info.Episodes = res.Data.Episode;

          db.media.insert(series_info, function (err, newDoc) {
            if(err) {
              reply(err);
              return;
            }
            reply({
              "statusCode": 202,
              "id": request.params.key
            }).code(202);

            var resourcePath = Path.normalize(config.dataDir + "/episodes/" + series_info.id);
            mkdirp.sync(resourcePath);

            async.each(series_info.Episodes, function(episode, callback){
              if(typeof episode["filename"] !== "string"){
                return;

              }
              var filename = Path.basename(episode["filename"]);

              requestLib('http://thetvdb.com/banners/' + episode["filename"])
                .pipe(fs.createWriteStream(resourcePath + "/" + filename))
                .on('end', function(){
                  callback();
                });

            }, function (err){
                var bannerExt = Path.extname(series_info.banner);

                var posterExt = Path.extname(series_info.poster);
                var fanartExt = Path.extname(series_info.fanart);

                requestLib('http://thetvdb.com/banners/' + series_info.banner)
                  .pipe(fs.createWriteStream(resourcePath + "/banner" + bannerExt))
                requestLib('http://thetvdb.com/banners/' + series_info.poster)
                  .pipe(fs.createWriteStream(resourcePath + "/poster" + posterExt))
                requestLib('http://thetvdb.com/banners/' + series_info.fanart)
                  .pipe(fs.createWriteStream(resourcePath +  "/fanart" + fanartExt))
              }(series_info)
            );
          });

        } else {
          reply(err);
        }
      });
    }
});
server.route({
    method: 'GET',
    path: '/api/media/tv/{key}',
    handler: function (request, reply) {
      var query = {};
      query.id = parseInt(request.params.key);
      query.CheesecakeType = "tv";

      db.media.find(query, function (err, docs) {
        if(err) reply(Boom.badImplementation());
        if(docs.length == 0){
          reply({
            "statusCode": 404,
            "message": "Media not found"
          }).code(404);
        } else {
          var seasons = {};
          for(var i = 0; i < docs[0].Episodes.length; i++){
            seasons[docs[0].Episodes[i].SeasonNumber] = 1;
          }
          docs[0]["CheesecakeSeasonCount"] = Object.keys(seasons).length - 1;

          reply({
            "statusCode": 200,
            data: docs[0]
          });
        }
      });
    }
});
server.route({
    method: 'GET',
    path: '/api/media/tv/{key}/meta',
    handler: function (request, reply) {
      var query = {};
      query.id = parseInt(request.params.key);
      query.CheesecakeType = "tv";

      db.media.find(query, function (err, docs) {
        if(err) reply(Boom.badImplementation());
        if(docs.length == 0){
          reply({
            "statusCode": 404,
            "message": "Media not found"
          }).code(404);
        } else {
          var seasons = {};
          for(var i = 0; i < docs[0].Episodes.length; i++){
            if(docs[0].Episodes[i].SeasonNumber != 0){
              seasons[docs[0].Episodes[i].SeasonNumber] = 1;
            }
          }
          docs[0]["CheesecakeSeasonCount"] = Object.keys(seasons).length;
          delete docs[0].Episodes;
          reply({
            "statusCode": 200,
            data: docs[0]
          });
        }
      });
    }
});
server.route({
    method: 'GET',
    path: '/api/media/tv/{key}/season/{season}',
    handler: function (request, reply) {
      var query = {};
      query.id = parseInt(request.params.key);
      query.CheesecakeType = "tv";

      db.media.find(query, function (err, docs) {
        if(err) reply(Boom.badImplementation());
        if(docs.length == 0){
          reply({
            "statusCode": 404,
            "message": "Media not found"
          }).code(404);
        } else {
          var seasons = {};
          for(var i = 0; i < docs[0].Episodes.length; i++){
            if(docs[0].Episodes[i].SeasonNumber != parseInt(request.params.season)){
              delete docs[0].Episodes[i];
            }
          }
          docs[0].Episodes = docs[0].Episodes.filter(function(n){ return n != undefined });
          reply({
            "statusCode": 200,
            data: docs[0]
          });
        }
      });
    }
});
server.route({
    method: 'GET',
    path: '/media/tv',
    handler: function (request, reply) {
      var query = {};
      query.CheesecakeType = "tv";

      db.media.find(query, {"Epispodes": 0}, function (err, docs) {
        if(err) reply(Boom.badImplementation());
        console.log(docs)
        var data = {}
        data.isSomeShows = docs.length ? true : false;
        data.shows = docs;
        reply.view("all-media", data);

      });

    }
});

server.route({
    method: 'GET',
    path: '/media/tv/{id}/{episode}',
    handler: function (request, reply) {
      var query = {};
      query.CheesecakeType = "tv";
      query.id = parseInt(request.params.id);
      query["Episodes.id"] = parseInt(request.params.episode);

      db.media.find(query, function (err, docs) {

        if(err) reply(Boom.badImplementation());
        if(docs.length == 0){
          reply({
            "statusCode": 404,
            "message": "Episode not found"
          }).code(404);
          return;
        }
        for(var i = 0; i < docs[0].Episodes.length; i++){
          if(docs[0].Episodes[i].id != parseInt(request.params.episode)){
            delete docs[0].Episodes[i];
          }
        }
        docs[0].Episodes = docs[0].Episodes.filter(function(n){ return n != undefined });

        reply.view("episode", docs[0]);

      });

    }
});

server.route({
    method: 'GET',
    path: '/media/tv/{id}/{episode}/stream',
    handler: function (request, reply) {
      var query = {};
      query.CheesecakeType = "tv";
      query.id = parseInt(request.params.id);
      query["Episodes.id"] = parseInt(request.params.episode);

      db.media.find(query, function (err, docs) {

        if(err) reply(Boom.badImplementation());
        if(docs.length == 0){
          reply({
            "statusCode": 404,
            "message": "Episode not found"
          }).code(404);
          return;
        }
        var index = docs[0].Episodes.map(function(obj, index) {
          if(obj.id == parseInt(request.params.episode)) {
            return index;
          }
        }).filter(isFinite)
        var index = index[0];
        console.log(config.downloadDir + "/" + docs[0].Episodes[index].CheescakeFilePath)
        var command = ffmpeg(config.downloadDir + "/" + docs[0].Episodes[index].CheescakeFilePath)
        .outputOptions('-speed 16')
        .videoCodec('libvpx')
        .videoBitrate('6000')
        .audioCodec('vorbis')
        .audioBitrate(128)
        .format('webm')


        .on('error', function(err, stdout, stderr) {
          reply(stderr);
        })

        var index = streamArray.push(command);
        delete command;
        reply(streamArray[index - 1].stream()).header('content-type', "video/webm");
      });

    }
});
server.route({
    method: 'POST',
    path: '/api/download',
    handler: function (request, reply) {
      var url = config.indexerSite + "/";
      url += "api?cat=5030&t=search&apikey=" + config.indexerKey;
      url += "&q=";

      var query = {};
      query.CheesecakeType = "tv";
      query.id = parseInt(request.payload.show);
      query["Episodes.id"] = parseInt(request.payload.episode);

      db.media.find(query, function (err, docs) {

        if(err) reply(Boom.badImplementation());
        if(docs.length == 0){
          reply({
            "statusCode": 404,
            "message": "Episode not found"
          }).code(404);
          return;
        }
        for(var i = 0; i < docs[0].Episodes.length; i++){
          if(docs[0].Episodes[i].id != parseInt(request.payload.episode)){
            delete docs[0].Episodes[i];
          }
        }
        docs[0].Episodes = docs[0].Episodes.filter(function(n){ return n != undefined });
        function padLeft(nr, n, str){
          return Array(n-String(nr).length+1).join(str||'0')+nr;
        }
        var seasonPad = padLeft(docs[0].Episodes[0].SeasonNumber, 2);
        var episodePad = padLeft(docs[0].Episodes[0].EpisodeNumber, 2);

        url += docs[0].SeriesName.replace(/[^\w\s]/gi, '') + " S" + seasonPad + "E" + episodePad;
        console.log(url)


        async.waterfall([
          //NewzNab Search
          function(callback) {
            requestLib('http://' + url, function (error, response, body) {
              if (!error && response.statusCode == 200) {
                callback(null, body)
              }
            });
          },
          //parse XML search results into JS Object
          function(body, callback) {
            parseString(body, function (err, result) {
                var firstResult = result['rss']["channel"][0]["item"][0];
                callback(null, firstResult);
            });
          },
          //create temp directory to download files into
          function(firstResult, callback) {
            temp.mkdir('show', function(err, dirPath) {
              callback(null, firstResult, dirPath);
            });
          },
          //download relevant NZB file and save as buffer
          function(firstResult, dirPath, outsideCallback) {
            var downloadCount = 0;
            var downloadSuccess = false;
            //continuously try the download/extraction/etc until success or we've downloaded 5 times.
            async.whilst(
              function(){ return downloadSuccess == false && downloadCount < 5; },
              function (whilstCallback){
                async.waterfall([
                  function(insideCallback){
                    requestLib(firstResult["link"][0], function(error, response, body) {
                      if (!error && response.statusCode == 200) {
                        var nzbBuffer = new Buffer(body)
                        insideCallback(null, dirPath, nzbBuffer);
                      }
                    });
                  },
                  //start download of NZB contents
                  //inform client download has started
                  function(dirPath, nzbBuffer, callback) {
                    reply({
                      "statusCode": 202,
                      "message": "Download in Progress"
                    }).code(202);

                    nzbclient.grab(nzbBuffer, function(err, filename, chunk, done) {
                      return fs.appendFile(dirPath + "/" + filename, chunk, function(err) {
                        if (done) {
                          callback(null, dirPath);
                        }
                      });
                    });
                  },
                  //find par2 and if present try to repair as a default
                  function(dirPath, callback) {
                    glob(dirPath + "/!(*sample*)*!(*vol*)*.par2", function (er, files) {
                      console.log(files)
                      exec("par2 r " + files[0], {maxBuffer: 1024 * 500}, function(error, stdout, stderr) {
                        if(error){
                          console.log(error, stderr);
                          downoadCount++
                          whilstCallback();
                          return;
                        }

                        callback(null, dirPath);
                      });
                    });
                  },
                  //unrar
                  function(dirPath, callback) {
                    glob(dirPath + "/!(*sample*)*.rar", function (er, files) {
                      exec("unrar e -y " + files[0] + " " + dirPath, {maxBuffer: 1024 * 500}, function(error, stdout, stderr) {
                        if(error){
                          console.log(error, stderr);
                          downoadCount++
                          whilstCallback();
                          return;
                        }
                        callback(null, dirPath);
                      });
                    });
                  },
                  //move to appropriate directory
                  function(dirPath, callback) {
                    mkdirp.sync(config.downloadDir + "/" + docs[0].SeriesName);
                    glob(dirPath + "/!(*sample*)*.@(mkv|avi|mp4)", function (er, files) {
                      var mv = require('mv');
                      var filename = Path.basename(files[0]);

                      var dest = config.downloadDir + "/" + docs[0].SeriesName + "/" + filename;
                      var destSubDir = docs[0].SeriesName + "/" + filename;

                      mv(
                        files[0],
                        config.downloadDir + "/" + docs[0].SeriesName + "/" + filename,
                        function(err) {
                        callback(null, destSubDir)
                      });

                    });
                  },
                  //update db
                  function(filePath, callback) {
                    console.log(filePath);

                    var query = {};
                    query.CheesecakeType = "tv";
                    query.id = parseInt(request.payload.show);
                    query["Episodes.id"] = parseInt(request.payload.episode);

                    db.media.find(query, function (err, docs) {
                      var index = docs[0].Episodes.map(function(obj, index) {
                        if(obj.id == parseInt(request.payload.episode)) {
                          return index;
                        }
                      }).filter(isFinite)
                      var index = index[0];
                      docs[0].Episodes[index].CheescakeIsDownloaded = true;
                      docs[0].Episodes[index].CheescakeFilePath = filePath;
                      docs[0].Episodes[index].CheescakeDownloadDate = new Date();

                      db.media.update({ _id: docs[0]._id }, docs[0], {}, function (err, numReplaced){
                        callback(null)
                      });
                    });
                  }
                ])

              }

            )

          }

        ], function (err, result) {
            // result now equals 'done'
        });
      });
    }
});
server.route({
    method: 'GET',
    path: '/settings',
    handler: function (request, reply) {
        reply.view("settings", config);
    }
});
server.route({
    method: 'POST',
    path: '/api/settings',
    handler: function (request, reply) {
      config.dataDir = request.payload.dataDir ? request.payload.dataDir : config.dataDir;
      config.downloadDir = request.payload.downloadDir ? request.payload.downloadDir : config.downloadDir;
      config.usenetServer = request.payload.usenetServer ? request.payload.usenetServer : config.usenetServer;
      config.usenetUsername = request.payload.usenetUsername ? request.payload.usenetUsername : config.usenetUsername;
      config.usenetPort = request.payload.usenetPort ? request.payload.usenetPort : config.usenetPort;
      config.usenetPassword = request.payload.usenetPassword ? request.payload.usenetPassword : config.usenetPassword;
      config.usenetConnections = request.payload.usenetConnections ? request.payload.usenetConnections : config.usenetConnections;
      config.indexerSite = request.payload.indexerSite ? request.payload.indexerSite : config.indexerSite;
      config.indexerKey = request.payload.indexerKey ? request.payload.indexerKey : config.indexerKey;

      config.isUsenetSSL = request.payload.isUsenetSSL ? true : false;
      config.isPasswordProtected = request.payload.isPasswordProtected ? true : false;

      for (var prop in config) {
        if(config[prop] == undefined){
          config[prop] = "";
        }
      }
      mkdirp.sync(config.dataDir);
      mkdirp.sync(config.downloadDir);
      saveConfig();
      setupUsetnet();
      console.log(config)
      reply({
        "statusCode": 200,
        "message": "Config Saved"
      });
    }
});
server.route({
    method: 'GET',
    path: '/api/settings',
    handler: function (request, reply) {

      reply({
        "statusCode": 200,
        "config": config
      });
    }
});
server.start(function () {
    console.log('Server running at:', server.info.uri);
});

function exitHandler(){
  temp.cleanupSync();
  for(var i = 0; i < streamArray.length; i++){
    streamArray[i].kill()
  }
  process.exit()
}
process.on('SIGINT', exitHandler);

//catches uncaught exceptions
process.on('uncaughtException', exitHandler);
