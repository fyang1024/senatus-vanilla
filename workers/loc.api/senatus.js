'use strict'

const _ = require('lodash')
const uuid = require('uuid')
const sendmail = require('sendmail')()

const { Api } = require('bfx-wrk-api')

class Senatus extends Api {
  _space (service, msg) {
    return super._space(service, msg)
  }

  getWhitelist (space, cb) {
    const wasteland = this.ctx.wasteland
    const whitelistKey = this.ctx.whitelistKey
    wasteland.get(whitelistKey, {}, function (err, res) {
      if (err) return cb(err)
      return cb(null, res)
    })
  }

  getPayload (space, hash, cb) {
    if (!cb) {
      cb = hash
      return cb(new Error('ERROR_PROVIDE_HASH'))
    }
    const wasteland = this.ctx.wasteland
    wasteland.get(hash, {}, function (err, res) {
      if (err) return cb(err)
      cb(null, res)
    })
  }

  addSig (space, payload, sig, cb) {
    if (!cb || !sig) {
      cb = sig || payload
      return cb(new Error('ERROR_PROVIDE_PAYLOAD_SIG'))
    }
    const validate = this._validate
    const verifySigs = this._verifySigs
    const notify = this._notify
    const wasteland = this.ctx.wasteland
    this.getWhitelist(space, function (err, res) {
      if (err) return cb(err)
      const whitelist = new Map()
      res.forEach(function (user) {
        whitelist.set(user.username, user)
      })

      if (!payload.uuid) {
        payload.uuid = uuid.v4()
      }
      if (!payload.sigs) {
        payload.sigs = []
      }
      sig.timestamp = Date.now()
      payload.sigs.push(sig)
      const errors = validate(payload, whitelist)
      if (errors.length) return cb(new Error(JSON.stringify(errors)))
      if (payload.sigs.length === payload.sigsRequired) {
        payload.completed = true
      }

      if (!verifySigs(payload, whitelist)) return cb(new Error('Signatures are not matched'))

      const opts = {seq: payload.sigs.length, salt: payload.uuid}
      wasteland.put(payload, opts, function (err, res) {
        if (err) return cb(err)
        notify(payload, res, whitelist)
        cb(null, res)
      })
    })
  }

  _validate (payload, whitelist) {
    const errors = []

    if (!payload.msg) {
      errors.push(new Error('Message required'))
    }

    if (!payload.signers || !Array.isArray(payload.signers)) {
      errors.push(new Error('Signer array not specified'))
    } else if (payload.signers.length === 0) {
      errors.push(new Error('At least one signer required'))
    } else {
      payload.signers.forEach(function (signer) {
        if (!whitelist.get(signer)) {
          errors.push(new Error(signer + ' not found in the whitelist'))
        }
      })
    }

    if (!payload.sigsRequired || !Number.isInteger(payload.sigsRequired)) {
      errors.push(new Error('sigsRequired not specified'))
    } else if (payload.sigsRequired > payload.signers.length) {
      errors.push(new Error('sigsRequired cannot exceed number of signers'))
    }

    if (!Array.isArray(payload.sigs)) {
      errors.push(new Error('signatures should be an array'))
    } else if (Array.isArray(payload.signers)) {
      payload.sigs.forEach(function (sig) {
        if (!_.includes(payload.signers, sig.signer)) {
          errors.push(new Error(sig.signer + ' not in signer list'))
        }
      })
    }

    return errors
  }

  _verifySigs (payload, whitelist) {
    return false
  }

  _notify (payload, hash, whitelist) {
    if (payload.completed) {
      payload.signers.forEach(function (signer) {
        const user = whitelist.get(signer)
        sendmail({
          from: 'fei@bitfinex.com',
          to: user.email,
          subject: hash + ' has been signed',
          text: 'The following has been signed\n\n' + JSON.stringify(payload)
        }, function (err, reply) {
          console.log(err && err.stack)
          console.dir(reply)
        })
      })
    } else {
      payload.signers.forEach(function (signer) {
        if (!_.includes(payload.sigs, {signer: signer})) {
          const user = whitelist.get(signer)
          sendmail({
            from: 'fei@bitfinex.com',
            to: user.email,
            subject: hash + ' requires your signature',
            text: 'Your signature is required for ' + hash
          }, function (err, reply) {
            console.log(err && err.stack)
            console.dir(reply)
          })
        }
      })
    }
  }
}

module.exports = Senatus
