require! './egs'
require! fs
require! path
require! os

let optimist = require 'optimist'
  .usage '$0 [OPTIONS] path/to/template.egs', {
    help: { +boolean, desc: "Show this help screen" }
    v: { alias: "version", +boolean, desc: "EGS v$(egs.version)" }
    p: { alias: "package", +boolean, desc: "Compile an EGS package to JavaScript and save as a .js file" }
    o: { alias: "output", +string, desc: "Set the file for compiled JavaScript, otherwise use stdout" }
    s: { alias: "stdin", +boolean, desc: "Listen for and compile EGS from stdin" }
    u: { alias: "uglify", +boolean, desc: "Uglify compiled code with UglifyJS2" }
    m: { alias: "map", +string, desc: "Build a SourceMap" }
    e: { alias: "export", +string, desc: "The global exported to the browser when compiling a package, defaults to 'EGSTemplates'" }
    "source-root": { +string, desc: "Specify a sourceRoot in a SourceMap, defaults to ''" }
    options: { +string, desc: "a JSON object of options to pass into the compiler" }
    context: { +string, desc: "a JSON object to pass as the context to an executed template" }
    coverage: { +boolean, desc: "Instrument with _\$jscoverage support" }
    tokens: { +string, desc: "Default to '<%'-style tokens, can specify '{{' as an alternative" }
  }

optimist.check #(argv)
  let exclusive(...opts)!
    let mutable found = null
    for opt in opts
      if opt == \_
        if argv._.length
          if not found
            found := "filenames"
          else
            throw "Cannot specify both $found and filenames"
      else
        if argv[opt]
          if not found
            found := "--$opt"
          else
            throw "Cannot specify both $found and --$opt"
  let depend(main-opt, ...opts)!
    if argv[main-opt]
      for opt in opts
        if not argv[opt]
          throw "Must specify --$opt if specifying --$main-opt"
  if argv._.length > 1
    throw "Can only specify one filename or directory"
  exclusive \nodes, \cov
  exclusive \stdin, \package
  exclusive \context, \package
  depend \output, \_
  depend \package, \_
  depend \map, \output, \package
  depend "source-root", \map
  depend \uglify, \package
  exclusive \stdin, \_
  if argv.map and not is-string! argv.map
    throw "Must specify a filename with --map"
  if argv.tokens and argv.tokens not in ["<%", "{{"]
    throw "Unknown token: '$(argv.tokens)', can only specify '<%' or '{{'"
  if argv.options
    try
      if not is-object! JSON.parse(argv.options)
        throw "Expected --options to provide an object"
    catch e as SyntaxError
      throw "Unable to parse options: $(e.message)"
  if argv.context
    try
      if not is-object! JSON.parse(argv.context)
        throw "Expected --context to provide an object"
    catch e as SyntaxError
      throw "Unable to parse context: $(e.message)"

let argv = optimist.argv

let read-stdin = #
  let defer = __defer()
  let mutable buffer = ""
  process.stdin.on 'data', #(chunk)
    buffer &= chunk.to-string()
  process.stdin.on 'end', #
    defer.fulfill buffer
  process.stdin.resume()
  defer.promise

let read-file(filename)
  to-promise! fs.read-file filename, "utf8"

let write-file(filename, text)
  to-promise! fs.write-file filename, text, "utf8"

let filenames = argv._
let main = promise!
  if argv.help or (not argv.package and not argv.stdin and not argv._.length and not argv.version)
    return optimist.show-help(console.log)
  
  let gorilla = require('gorillascript')
  if argv.version
    return console.log "EGS v$(egs.version) on GorillaScript v$(gorilla.version)"
  
  let options = {}
  if argv.options
    options <<< JSON.parse(argv.options)
  if argv.uglify
    options.undefined-name := \undefined
    options.uglify := true
  if argv.coverage
    options.coverage := true
  switch argv.tokens
  case '{{'
    options.open := "{%"
    options.close := "%}"
    options.open-write := "{{"
    options.close-write := "}}"
    options.open-comment := "{#"
    options.close-comment := "#}"
  default
    void
  
  if argv.export
    options.global-export := argv.export
  
  yield gorilla.init()
  
  if not argv.package
    let context = {}
    if argv.context
      context <<< JSON.parse(argv.context)
    let code = if argv.stdin
      yield read-stdin()
    else if argv._.length
      yield read-file(argv._[0])
    else
      throw Error "Expected at least one filename by this point"
    
    let result = yield egs.render code, options, context
    if argv.output
      yield write-file argv.output, result
    else
      process.stdout.write result
      unless result.match r'\n$'
        process.stdout.write "\n"
  else
    let source-directory = argv._[0]
    let stat = try
      yield to-promise! fs.stat source-directory
    catch e
      return console.error "Unable to open $(source-directory): $(String e)"
    if not stat.is-directory()
      return console.error "Must provide a directory when using --package"
    
    if argv.output
      process.stdout.write "Compiling $(path.basename source-directory) ..."
    let start-time = Date.now()
    let output = argv.output or path.join os.tmpdir(), "egs-$(Math.random().to-string(36).slice(2)).js"
    if argv.map
      options.source-map := {
        file: argv.map
        source-root: argv["source-root"] or ""
      }
    yield egs.compile-package source-directory, output, options
    if argv.output
      process.stdout.write " $(((Date.now() - start-time) / 1000_ms).to-fixed(3)) s\n"
    else
      let text = yield read-file output
      yield to-promise! fs.unlink output
      process.stdout.write text
  /*
  if not argv.compile
    let input = yield to-promise! fs.read-file filenames[0]

    options.filename := filenames[0]
    let new-argv = ["gorilla"]
    for item, i in process.argv
      if item == filenames[0]
        new-argv.push ...process.argv[i to -1]
        break
    process.argv := new-argv
    return yield handle-code String input
  
  if argv.map
    options.source-map := {
      file: argv.map
      source-root: argv["source-root"] or ""
    }

  let get-js-output-path(filename)
    if argv.output and filenames.length == 1
      argv.output
    else
      let base-dir = path.dirname filename
      let dir = if argv.output
        path.join argv.output, base-dir
      else
        base-dir
      path.join dir, path.basename(filename, path.extname(filename)) & ".js"

  if filenames.length > 1 and argv.join
    let base-filenames = for filename in filenames
      path.basename filename
    process.stdout.write "Compiling $(base-filenames.join ', ') ... "
    let compile-time = timer!
      yield gorilla.compile-file {} <<< options <<< {
        input: filenames
        output: argv.output
      }
    process.stdout.write "$((compile-time / 1000_ms).to-fixed(3)) seconds\n"
  else
    for filename in filenames
      process.stdout.write "Compiling $(path.basename filename) ... "
      let compile-time = timer!
        yield gorilla.compile-file {} <<< options <<< {
          input: filename
          output: get-js-output-path filename
        }
      process.stdout.write "$((compile-time / 1000_ms).to-fixed(3)) seconds\n"
  */

main.then null, #(e)
  console.error e?.stack or e
  process.exit(1)
