/// //////////////////////////
/// ////    HELPERS    ///////
/// //////////////////////////

var Promise = require('promise')
var parser = require('./xmlParser.js')
var parser2 = require('xml-js')
var utf8 = require('utf8')
var fileInfo = require('./fileInfo.js')

/**
 * @class helpers
 * @classdesc
 * <b><i>This is a class for helper functions, dont mess with this until sure!</i></b><br><br>
 *
 * @author Noveen Sachdeva
 * @version 1.0.0
 */
function helpers () {
  this.OCS_BASEPATH = 'ocs/v1.php/'
  this.OCS_SERVICE_SHARE = 'apps/files_sharing/api/v1'
  this.OCS_SERVICE_PRIVATEDATA = 'privatedata'
  this.OCS_SERVICE_CLOUD = 'cloud'

  // constants from lib/public/constants.php
  this.OCS_PERMISSION_READ = 1
  this.OCS_PERMISSION_UPDATE = 2
  this.OCS_PERMISSION_CREATE = 4
  this.OCS_PERMISSION_DELETE = 8
  this.OCS_PERMISSION_SHARE = 16
  this.OCS_PERMISSION_ALL = 31

  // constants from lib/public/share.php
  this.OCS_SHARE_TYPE_USER = 0
  this.OCS_SHARE_TYPE_GROUP = 1
  this.OCS_SHARE_TYPE_LINK = 3
  this.OCS_SHARE_TYPE_REMOTE = 6

  this.instance = null
  this._authHeader = null
  this._version = null
  this._capabilities = null
  this._currentUser = null
}

/**
 * sets the OC instance
 * @param   {string}    instance    instance to be used for communication
 */
helpers.prototype.setInstance = function (instance) {
  this.instance = instance
  this._webdavUrl = this.instance + 'remote.php/webdav'
  this._davPath = this.instance + 'remote.php/dav'
}

helpers.prototype.getInstance = function () {
  return this.instance
}

/**
 * sets the username
 * @param   {string}    authHeader    authorization header; either basic or bearer or what ever
 */
helpers.prototype.setAuthorization = function (authHeader) {
  this._authHeader = authHeader
}

helpers.prototype.getAuthorization = function () {
  return this._authHeader
}

helpers.prototype.logout = function () {
  this._authHeader = null
  this._version = null
  this._capabilities = null
  this._currentUser = null
}

/**
 * gets the OC version
 * @returns {string}    OC version
 */
helpers.prototype.getVersion = function () {
  return this._version
}

/**
 * Gets all capabilities of the logged in user
 * @returns {object}    all capabilities
 */
helpers.prototype.getCapabilities = function () {
  return this._capabilities
}

/**
 * Gets the logged in user
 * @returns {object}    user info
 */
helpers.prototype.getCurrentUser = function () {
  return this._currentUser
}

/**
 * Updates the capabilities of user logging in.
 * @returns {Promise.<capabilities>}    object: all capabilities
 * @returns {Promise.<error>}           string: error message, if any.
 */
helpers.prototype._updateCapabilities = function () {
  var self = this
  return new Promise((resolve, reject) => {
    self._makeOCSrequest('GET', self.OCS_SERVICE_CLOUD, 'capabilities')
      .then(data => {
        var body = data.data.ocs.data

        self._capabilities = body.capabilities
        self._version = body.version.string + '-' + body.version.edition

        resolve(self._capabilities)
      }).catch(error => {
        reject(error)
      })
  })
}

/**
 * Updates the user logging in.
 * @returns {Promise.<_currentUser>}    object: _currentUser
 * @returns {Promise.<error>}           string: error message, if any.
 */
helpers.prototype._updateCurrentUser = function () {
  var self = this
  return new Promise((resolve, reject) => {
    self._makeOCSrequest('GET', self.OCS_SERVICE_CLOUD, 'user')
      .then(data => {
        var body = data.data.ocs.data

        self._currentUser = body

        resolve(self._currentUser)
      }).catch(error => {
        reject(error)
      })
  })
}

/**
 * Makes an OCS API request.
 * @param   {string} method     method of request (GET, POST etc.)
 * @param   {string} service    service (cloud, privatedata etc.)
 * @param   {string} action     action (apps?filter=enabled, capabilities etc.)
 * @param   {string} [data]     formData for POST and PUT requests
 * @returns {Promise.<data>}    object: {response: response, body: request body}
 * @returns {Promise.<error>}   string: error message, if any.
 */
helpers.prototype._makeOCSrequest = function (method, service, action, data) {
  var self = this

  // Set the headers
  var headers = {
    authorization: this._authHeader,
    'OCS-APIREQUEST': true
  }

  var slash = ''

  if (service) {
    slash = '/'
  }

  var path = this.OCS_BASEPATH + service + slash + action

  // Configure the request
  var options = {
    method: method,
    mode: 'cors',
    headers: headers
  }

  if (method !== 'GET' && method !== 'HEAD') {
    var serialize = function (obj) {
      var str = []
      for (var p in obj) {
        if (obj.hasOwnProperty(p)) {
          str.push(encodeURIComponent(p) + '=' + encodeURIComponent(obj[p]))
        }
      }
      return str.join('&')
    }
    options.headers['content-type'] = 'application/x-www-form-urlencoded'
    options.body = serialize(data).replace(/%20/g, '+')
  }

  return new Promise((resolve, reject) => {
    if (!self.instance) {
      reject('Please specify a server URL first')
      return
    }

    if (!self._authHeader) {
      reject('Please specify an authorization first.')
      return
    }

    fetch(this.instance + path, options)
      .then(response => {
        response.text().then(body => {
          let tree = null
          try {
            tree = parser.xml2js(body)
            var error = self._checkOCSstatus(tree)
            if (error) {
              reject(error)
              return
            }
          } catch (e) {
            try {
              tree = JSON.parse(body)
              if ('message' in tree) {
                reject(tree.message)
                return
              }
              error = self._checkOCSstatus(tree)
              if (error) {
                reject(error)
                return
              }
            } catch (e) {
              reject('Invalid response body: ' + body)
              return
            }
          }

          resolve({
            response: response,
            body: body,
            data: tree
          })
        })
      })
      .catch(error => {
        reject(error)
      })
  })
}

/**
 * performs a simple GET request
 * @param   {string}    url     url to perform GET on
 * @returns {Promise.<data>}    object: {response: response, body: request body}
 * @returns {Promise.<error>}   string: error message, if any.
 */
helpers.prototype._get = function (url) {
  var err = null

  if (!this.instance) {
    err = 'Please specify a server URL first'
  }

  if (!this._authHeader) {
    err = 'Please specify an authorization first.'
  }

  var headers = {
    authorization: this._authHeader,
    'Content-Type': 'application/x-www-form-urlencoded'
  }

  // Configure the request
  var options = {
    url: url,
    method: 'GET',
    headers: headers
  }

  return new Promise((resolve, reject) => {
    if (err) {
      reject(err)
      return
    }

    fetch(url, options)
      .then(response => {
        response.text().then(text => {
          resolve({
            response: response,
            body: text
          })
        })
      })
  })
}

/**
 * Parses a DAV response error.
 */
helpers.prototype._parseDAVerror = function (body) {
  var tree = parser.xml2js(body)

  if (tree['d:error'] && tree['d:error']['s:message']) {
    return tree['d:error']['s:message']
  }
  return 'Unknown error'
}

/**
 * Makes sure path starts with a '/'
 * @param   {string}    path    to the remote file share
 * @returns {string}            normalized path
 */
helpers.prototype._normalizePath = function (path) {
  if (!path) {
    path = ''
  }

  if (path.length === 0) {
    return '/'
  }

  if (path[0] !== '/') {
    path = '/' + path
  }

  return path
}

helpers.prototype._encodeUri = function (path) {
  path = this._normalizePath(path)
  path = encodeURIComponent(path)
  return path.split('%2F').join('/')
}

/**
 * Checks the status code of an OCS request
 * @param   {object} json                         parsed response
 * @param   {array}  [acceptedCodes = [100] ]     array containing accepted codes
 * @returns {string}                              error message or NULL
 */
helpers.prototype._checkOCSstatus = function (json, acceptedCodes) {
  if (!acceptedCodes) {
    acceptedCodes = [100]
  }

  var meta
  if (json.ocs) {
    meta = json.ocs.meta
  }
  var ret

  if (meta && acceptedCodes.indexOf(parseInt(meta.statuscode)) === -1) {
    ret = meta.message

    if (Object.keys(meta.message).length === 0) {
      // no error message returned, return the whole message
      ret = json
    }
  }

  return ret
}

/**
 * Returns the status code of the xml response
 * @param   {object}    json    parsed response
 * @return  {integer}           status-code
 */
helpers.prototype._checkOCSstatusCode = function (json) {
  if (json.ocs) {
    var meta = json.ocs.meta
    return parseInt(meta.statuscode)
  }
  return null
}

/**
 * Encodes the string according to UTF-8 standards
 * @param   {string}    path    path to be encoded
 * @returns {string}            encoded path
 */
helpers.prototype._encodeString = function (path) {
  return utf8.encode(path)
}

helpers.prototype._buildFullWebDAVPath = function (path) {
  return this._webdavUrl + this._encodeUri(path)
}

helpers.prototype._buildFullWebDAVPathV2 = function (path) {
  return this._davPath + this._encodeUri(path)
}

/**
 * converts all of object's "true" or "false" entries to booleans
 * @param   {object}    object  object to be typcasted
 * @return  {object}            typecasted object
 */
helpers.prototype._convertObjectToBool = function (object) {
  if (typeof (object) !== 'object') {
    return object
  }

  for (var key in object) {
    if (object[key] === 'true') {
      object[key] = true
    }
    if (object[key] === 'false') {
      object[key] = false
    }
  }

  return object
}

/**
 * Handles Provisionging API boolean response
 */
helpers.prototype._OCSuserResponseHandler = function (data, resolve, reject) {
  var statuscode = parseInt(this._checkOCSstatusCode(data.data))
  if (statuscode === 999) {
    reject('Provisioning API has been disabled at your instance')
  }

  resolve(true)
}

/**
 * performs a PUT request from a file
 * @param   {string}  source     source path of the file to move/copy
 * @param   {string}  target     target path of the file to move/copy
 * @param   {object}  headers    extra headers to add for the PUT request
 * @returns {Promise.<status>}   boolean: whether the operation was successful
 * @returns {Promise.<error>}    string: error message, if any.
 */
helpers.prototype._webdavMoveCopy = function (source, target, method) {
  var self = this
  return new Promise((resolve, reject) => {
    if (method !== 'MOVE' && method !== 'COPY') {
      reject('Please specify a valid method')
      return
    }

    source = self._normalizePath(source)

    target = self._normalizePath(target)
    target = encodeURIComponent(target)
    target = target.split('%2F').join('/')

    var headers = {
      'Destination': self._webdavUrl + target
    }

    self._makeDAVrequest(method, source, headers).then(data => {
      resolve(data)
    }).catch(error => {
      reject(error)
    })
  })
}

/**
 * gets the fileName from a path
 * @param  {string}  path  path to get fileName from
 * @return {string}        fileName
 */
helpers.prototype._getFileName = function (path) {
  var pathSplit = path.split('/')
  pathSplit = pathSplit.filter(function (n) {
    return n !== ''
  })
  return pathSplit[pathSplit.length - 1]
}

/**
 * returns all xml namespaces in an object
 * @param  {string} xml xml which has namespace
 * @return {object}     object with namespace
 */
helpers.prototype._getXMLns = function (xml) {
  var tree = parser2.xml2js(xml, {
    compact: true
  })
  var xmlns = tree['d:multistatus']._attributes
  var replacedXMLns = {}

  for (var ns in xmlns) {
    var changedKey = ns.split(':')[1]
    replacedXMLns[changedKey] = xmlns[ns]
  }

  return replacedXMLns
}

helpers.prototype._parseBody = function (responses) {
  if (!Array.isArray(responses)) {
    responses = [responses]
  }
  var self = this
  var fileInfos = []
  for (var i = 0; i < responses.length; i++) {
    var fileInfo = self._parseFileInfo(responses[i])
    if (fileInfo !== null) {
      fileInfos.push(fileInfo)
    }
  }
  return fileInfos
}

helpers.prototype._extractPath = function (path) {
  var pathSections = path.split('/')
  pathSections = pathSections.filter(function (section) { return section !== '' })

  if (decodeURIComponent(pathSections[0]) !== 'remote.php') {
    return null
  }
  if (['webdav', 'dav'].indexOf(decodeURIComponent(pathSections[1])) === -1) {
    return null
  }

  // build the sub-path from the remaining sections
  var subPath = ''
  var i = 2
  while (i < pathSections.length) {
    subPath += '/' + decodeURIComponent(pathSections[i])
    i++
  }
  return subPath
}

helpers.prototype._parseFileInfo = function (response) {
  var path = this._extractPath(response.href)
  // invalid subpath
  if (path === null) {
    return null
  }
  let name = path

  if (response.propStat.length === 0 || response.propStat[0].status !== 'HTTP/1.1 200 OK') {
    return null
  }

  var props = response.propStat[0].properties
  let fileType = 'file'
  var resType = props['{DAV:}resourcetype']
  if (resType) {
    var xmlvalue = resType[0]
    if (xmlvalue.namespaceURI === 'DAV:' && xmlvalue.nodeName.split(':')[1] === 'collection') {
      fileType = 'dir'
    }
  }

  return new fileInfo(name, fileType, props)
}

module.exports = helpers