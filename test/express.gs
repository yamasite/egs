let egs = require '../index'
let request = require 'supertest'
let {expect} = require 'chai'

describe "An express application", #
  for cache in [false, true]
    describe "with$(if cache then '' else 'out') caching", #
      it "can use the egs renderer", #(cb)
        let express = require('express')
        let app = express()
        app.engine 'egs', egs.__express
    
        app.get '/', #(req, res)
          res.render "$__dirname/fixtures/hello.egs", { name: "alpha", cache }
    
        request(app)
          .get '/'
          .expect 200
          .expect("Hello, alpha!", cb)
      
      it "can use the egs renderer with an explicit context", #(cb)
        let express = require('express')
        let app = express()
        app.engine 'egs', egs.__express
    
        app.get '/', #(req, res)
          res.render "$__dirname/fixtures/hello.egs", { context: { name: "bravo" }, cache }
    
        request(app)
          .get '/'
          .expect 200
          .expect("Hello, bravo!", cb)