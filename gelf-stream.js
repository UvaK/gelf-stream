var gelfStream = exports
var gelfling   = require('gelfling')
var util       = require('util')
var Writable   = require('stream').Writable

function GelfStream(host, port, options) {
  if (options == null && typeof port === 'object') {
    options = port
    port = null
    if (options == null && typeof host === 'object') {
      options = host
      host = null
    }
  }
  if (options == null) options = {}

  if (options.keepAlive == null) options.keepAlive = true

  Writable.call(this, {objectMode: true})

  this._options = options
  this._client = gelfling(host, port, options)

  this.once('finish', this.destroy)
}
util.inherits(GelfStream, Writable)

GelfStream.prototype._write = function(chunk, encoding, callback) {
  if (!this._options.filter || this._options.filter(chunk)) {
    this._client.send(this._options.map ? this._options.map(chunk) : chunk, callback)
  } else {
    callback()
  }
}

GelfStream.prototype.destroy = function(callback) {
  if (callback) this.once('close', callback)
  this._client.close()
  process.nextTick(function() { this.emit('close') }.bind(this))
}

function create(host, port, options) {
  return new GelfStream(host, port, options)
}

// ---------------------------
// Bole stuff
// ---------------------------

function mapBoleGelfLevel(boleLevel) {
  switch (boleLevel) {
    case 'debug': return gelfling.DEBUG
    case 'info':  return gelfling.INFO
    case 'warn':  return gelfling.WARNING
    case 'error': return gelfling.ERROR
    default:      return gelfling.EMERGENCY
  }
}

// ---------------------------
// Bunyan stuff
// ---------------------------

function mapGelfLevel(bunyanLevel) {
  switch (bunyanLevel) {
    case 10 /*bunyan.TRACE*/: return gelfling.DEBUG
    case 20 /*bunyan.DEBUG*/: return gelfling.DEBUG
    case 30 /*bunyan.INFO*/:  return gelfling.INFO
    case 40 /*bunyan.WARN*/:  return gelfling.WARNING
    case 50 /*bunyan.ERROR*/: return gelfling.ERROR
    case 60 /*bunyan.FATAL*/: return gelfling.EMERGENCY
    default:                  return gelfling.WARNING
  }
}

// ---------------------------
// Common stuff
// ---------------------------

function flatten(obj, into, prefix, sep) {
  if (into == null) into = {}
  if (prefix == null) prefix = ''
  if (sep == null) sep = '.'
  var key, prop
  for (key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue
    prop = obj[key]
    if (typeof prop === 'object' && !(prop instanceof Date) && !(prop instanceof RegExp))
      flatten(prop, into, prefix + key + sep, sep)
    else
      into[prefix + key] = prop
  }
  return into
}

function loggerToGelf(logger, addFlattened) {
  return function(log) {
    /*jshint camelcase:false */
    var errFile, key,
        ignoreFields = ['hostname', 'time', 'msg', 'name', 'level', 'v'],
        flattenedLog = addFlattened ? gelfStream.flatten(log) : {},
        gelfMsg = {
          host:          log.hostname,
          timestamp:     +new Date(log.time) / 1000,
          short_message: logger=='bunyan' ? log.msg : log.message,
          facility:      log.name,
          level:         logger=='bunyan' ? mapGelfLevel(log.level) : mapBoleGelfLevel(log.level),
          full_message:  JSON.stringify(log, null, 2)
        }

    if (logger == 'bole' && log.err)
      gelfMsg.short_message = log.err.message

    if (log.err && log.err.stack &&
        (errFile = log.err.stack.match(/\n\s+at .+ \(([^:]+)\:([0-9]+)/)) != null) {
      if (errFile[1]) gelfMsg.file = errFile[1]
      if (errFile[2]) gelfMsg.line = errFile[2]
    }

    for (key in flattenedLog) {
      if (ignoreFields.indexOf(key) < 0 && gelfMsg[key] == null)
        gelfMsg[key] = flattenedLog[key]
    }

    return gelfMsg
  }
}

function forLogger(logger) {
  return function(host, port, options) {
    if (options == null && typeof port === 'object') {
      options = port
      port = null
      if (options == null && typeof host === 'object') {
        options = host
        host = null
      }
    }
    if (options == null) options = {}

    var addFlattened = options.addFlattened == null ? true : Boolean(options.addFlattened);
    options.map = loggerToGelf(logger, addFlattened)

    return new GelfStream(host, port, options)
  }
}

gelfStream.GelfStream = GelfStream
gelfStream.create = create
gelfStream.forBunyan = forLogger('bunyan')
gelfStream.forBole = forLogger('bole')
gelfStream.flatten = flatten
