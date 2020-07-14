/*
 * Scailable webnode
 * 
 * Run sclbl WASI models in browser (or remotely)
 * See https://github.com/scailable/sclbl-webnode for details
 *
 * All rights reserved, Scailable b.v.
 *
 */
"use strict";
let sclblRuntime = (function() {

  /* Instantiate */
  let sclbl = {};
  sclbl.cf = null;

  /* Constants */
  const CDN_LOCATION = "https://cdn.sclbl.net:8000/file/";
  const TASKMAKANGER_LOCATION = "https://taskmanager.sclbl.net:8080/task/";

  /* Settings */
  sclbl.settings = {
    "cfid": "",  // compute-function id of the task
    "location": "local",  // local or remote
    "strict": false,  // if true, run only local and else fail
    "inputType": "string",  // type of the input data (string, numVec, strVec, mixVec, image, file, ...)
    "outputType": "string",  // desired type of the output data
    "debug": true, // console logging in debug
  };

  /* Set options; only overwrite those that are given */
  sclbl.options = function(options){
    const settings = Object.keys(sclbl.settings);
    for (const key of settings){
      if(key in options){
        sclbl.settings[key] = options[key];
      }
    }
    sclbl.log("Settings set to:" + JSON.stringify(sclbl.settings)); 
  };

  /* Check settings */
  sclbl.checkSettings = function(){

    // See if cfid is specified:
    if(!sclbl.settings.cfid){
      throw new Error("No compute function ID found");
    }

    // Remove .wasm from cfid if present
    if(sclbl.settings.cfid.substring(sclbl.settings.cfid.length - 5) === ".wasm"){
      sclbl.settings.cfid = sclbl.settings.cfid.slice(0,-5);
      sclbl.log("Removed .wasm from cfid.");
    }

    if(!("location" in sclbl.settings)){throw new Error("location missing from settings.");}
    if(!("strict" in sclbl.settings)){throw new Error("fallback missing from settings.");}
    if(!("inputType" in sclbl.settings)){throw new Error("inputType missing from settings.");}
    if(!("outputType" in sclbl.settings)){throw new Error("outputType missing from settings.");}
  };

  /* Convert input from inputType to Uint8Array */
  sclbl.convertLocalInput = function(input, type){

    let bArr;
    switch(type){
      case "string":
        bArr = new TextEncoder("utf-8").encode(input);
        console.log(bArr)
        break;
      case "numVec":
        let str = JSON.stringify(input);
        bArr = new TextEncoder("utf-8").encode(str);
        break;
      // more cases...

      default:
        throw new Error("Unable to find the specified inputType / type not yet implemented.");
    }
    return bArr;
  };

  /* Convert input from inputType to string */
  sclbl.convertRemoteInput = function(input, type){

    let str;
    switch(type){
      case "string":
        str = JSON.parse(input);
        break;
      case "numVec":
        str = JSON.parse(input);
        break;
      // more cases...

      default:
        throw new Error("Unable to find the specified inputType / type not yet implemented.");
    }
    return str;
  };

  /* Convert output from json to result */
  sclbl.convertRemoteOutput = function(raw){

    let response = JSON.parse(raw);
    let result = JSON.parse(response.result);
    return result.output;

  };

  /* Convert output from json to result */
  sclbl.convertLocalOutput = function(raw){
    
    let result = JSON.parse(raw);
    return result.output;

  };

  /* Run the task: the main workhorse */
  sclbl.run = function(rawInput) {

    // Return a new promise.
    return new Promise(async function(resolve, reject) {

      // Check settings:
      try {
        sclbl.checkSettings();
      } catch (err){
        sclbl.log("Error checking settings: " + err);
        return reject(err);
      }

      let location = sclbl.settings.location;
      let input; // input to the task
      let output; // task result
      
      // if locally running:
      if(sclbl.settings.location === "local"){

        // convert rawData to byteArray using convertLocalInput()
        try {
          input = sclbl.convertLocalInput(rawInput, sclbl.settings.inputType);
        } catch (err) {
          return reject(err);
        }

        // Run the task locally:
        try {
          output = await sclbl.runLocal(input, sclbl.settings.cfid);
        } catch (err) {
          sclbl.log("Error running locally: " + err);
          if(!sclbl.settings.strict){ // fallback to remote if !strict
            try {
              input = sclbl.convertRemoteInput(rawInput, sclbl.settings.inputType);
              output = await sclbl.runRemote(input, sclbl.settings.cfid);
              location = "remote"; // store change of location.
            } catch (err) {
              return reject(err);
            }
          } else {
            return reject (err);
          }

        }
      } 

      // if running remotely:
      if (sclbl.settings.location === "remote"){

        // convert rawData to string using convertRemoteInput()
        try {
          input = await sclbl.convertRemoteInput(rawInput, sclbl.settings.inputType);
          sclbl.log("Input converted to: " + input);
        } catch (err) {
          return reject(err);
        }

        // Run the task remotely:
        try {
          output = await sclbl.runRemote(input, sclbl.settings.cfid);
        } catch (err) {
          return reject(err);
        }

      }

      // Process output:
      let result;
      if(location === "local"){
        sclbl.log(output)
        result = sclbl.convertLocalOutput(output);
        sclbl.log(result)
      } else if (location === "remote"){
        result = sclbl.convertRemoteOutput(output);  
      } else {
         return reject(new Error("Unable to parse task output."));
      }
      
      resolve(result);

    });
  };

  /* Run a task locally */
  sclbl.runLocal = async function(inputData, cfid){

    sclbl.log("Running task locally...")

    // Instantiate polyFill:
    let polyFill
    try {
      polyFill = new WASI();
    } catch (err) {
      sclbl.log("Unable to instantiate WASI polyfill: " + err)
      throw new Error("Unable to instantiate WASI polyfill")
    }

    /* Import the module to sclbl.cf */
    try {
      await sclbl.import(cfid, polyFill)
    } catch (err) {
      sclbl.log("Unable to import WASI module: " + err)
      throw new Error("Unable to import WASI module.");
    }

    /* Run predict */
    let output;
    try {
      output = sclbl.predict(inputData);
    } catch (err) {
      sclbl.log("Unable to generate prediction: " + err)
      throw new Error("Unable to generate prediction.");
    }

    return output;

  };

  /* Import sclbl-WASI */
  sclbl.import = async function(cfid, polyFill) {

    let moduleName = CDN_LOCATION + cfid + ".wasm";
    let memory = new WebAssembly.Memory({ initial: 10, maximum: 100 });  // No clue how big this should be...
    const moduleImports = { wasi_unstable: polyFill, env : {}, js: { mem: memory } };

    let module = null;

    if (WebAssembly.compileStreaming) {
      module = await WebAssembly.compileStreaming(fetch(moduleName));
    }
    else {
      const response = await fetch(moduleName);
      const buffer = await response.arrayBuffer();
      module = await WebAssembly.compile(buffer);
    }

    const instance = await WebAssembly.instantiate(module, moduleImports);
                      
    polyFill.setModuleInstance(instance);
    //polyFill.fd_read();
    //polyFill.getModuleMemoryDataView();

    // Run start:
    instance.exports._start();

    /* set the instance */
    sclbl.cf = instance;

  }

  sclbl.predict = function(bArray){

    // Copy to linear memory
    let wasmMemory = new Uint8Array(sclbl.cf.exports.memory.buffer);
    let p_input = sclbl.cf.exports.malloc_buffer();
    wasmMemory.set(bArray, p_input);

    // Run function
    sclbl.cf.exports.pred();

    // Get output:
    let p_output = sclbl.cf.exports.get_out_loc();
    sclbl.cf.exports.free_buffer();

    let outputLen = sclbl.cf.exports.get_out_len();
    wasmMemory = new Uint8Array(sclbl.cf.exports.memory.buffer);
    let uint8array = wasmMemory.slice(p_output, p_output + outputLen);
    let result = new TextDecoder().decode(uint8array);
    sclbl.cf.exports.free_buffer();
    console.log("result : " + JSON.stringify(result))

    return result;

  };

  /* minimal polyFill */
  var WASI = function() {

    var moduleInstanceExports = null;

    var WASI_ESUCCESS = 0;
    var WASI_EBADF = 8;
    var WASI_EINVAL = 28;
    var WASI_ENOSYS = 52;

    var WASI_STDOUT_FILENO = 1;

    function setModuleInstance(instance) {
        
        moduleInstanceExports = instance.exports;
    }

    function getModuleMemoryDataView() {
        // call this any time you'll be reading or writing to a module's memory 
        // the returned DataView tends to be dissaociated with the module's memory buffer at the will of the WebAssembly engine 
        // cache the returned DataView at your own peril!!
        return new DataView(moduleInstanceExports.memory.buffer);
    }

    function fd_prestat_get(fd, bufPtr) {
        
        return WASI_EBADF;
    }

    function fd_prestat_dir_name(fd, pathPtr, pathLen) {
         
         return WASI_EINVAL;
    }

    function environ_sizes_get(environCount, environBufSize) {
        
        var view = getModuleMemoryDataView();

        view.setUint32(environCount, 0, !0);
        view.setUint32(environBufSize, 0, !0);
        
        return WASI_ESUCCESS;
    }

    function environ_get(environ, environBuf) {
        
        return WASI_ESUCCESS;
    }

    function args_sizes_get(argc, argvBufSize) {
        
        var view = getModuleMemoryDataView();

        view.setUint32(argc, 0, !0);
        view.setUint32(argvBufSize, 0, !0);

        return WASI_ESUCCESS;
    }

     function args_get(argv, argvBuf) {
        
        return WASI_ESUCCESS;
    }

    function fd_fdstat_get(fd, bufPtr) {

        var view = getModuleMemoryDataView();

        view.setUint8(bufPtr, fd);
        view.setUint16(bufPtr + 2, 0, !0);
        view.setUint16(bufPtr + 4, 0, !0);
        
        function setBigUint64(byteOffset, value, littleEndian) {

            var lowWord = value;
            var highWord = 0;

            view.setUint32(littleEndian ? 0 : 4, lowWord, littleEndian);
            view.setUint32(littleEndian ? 4 : 0, highWord, littleEndian);
       }
        
        setBigUint64(bufPtr + 8, 0, !0);
        setBigUint64(bufPtr + 8 + 8, 0, !0);
        
        return WASI_ESUCCESS;
    }

    function fd_write(fd, iovs, iovsLen, nwritten) {
        
      var view = getModuleMemoryDataView();
      var written = 0;
      var bufferBytes = [];                   

      function getiovs(iovs, iovsLen) {
        var buffers = Array.from({ length: iovsLen }, function (_, i) {
           var ptr = iovs + i * 8;
           var buf = view.getUint32(ptr, !0);
           var bufLen = view.getUint32(ptr + 4, !0);
            
           return new Uint8Array(moduleInstanceExports.memory.buffer, buf, bufLen);
        });
        return buffers;
      }

      var buffers = getiovs(iovs, iovsLen);
      
      function writev(iov) {
        for (var b = 0; b < iov.byteLength; b++) {
           bufferBytes.push(iov[b]);
        }
        written += b;
      }

      buffers.forEach(writev);
      if (fd === WASI_STDOUT_FILENO) console.log(String.fromCharCode.apply(null, bufferBytes));                            
      view.setUint32(nwritten, written, !0);
      return WASI_ESUCCESS;
    }

    function poll_oneoff(sin, sout, nsubscriptions, nevents) {
      return WASI_ENOSYS;
    }

    function proc_exit(rval) {
      return WASI_ENOSYS;
    }

    function fd_close(fd) {
      return WASI_ENOSYS;
    }

    function fd_seek(fd, offset, whence, newOffsetPtr) {}

    function fd_close(fd) {
      return WASI_ENOSYS;
    }

    /* added stubs */
    function fd_fdstat_set_flags(){console.log("check")}
    function path_open(){console.log("check")}
    function fd_read(){console.log("check")}
    function fd_datasync(){console.log("check")}
    function random_get(){console.log("check")}
    function clock_res_get(){console.log("check")}
    function clock_time_get(){console.log("check")}
    /* end */

    return {
        setModuleInstance : setModuleInstance,
        environ_sizes_get : environ_sizes_get,
        args_sizes_get : args_sizes_get,
        fd_prestat_get : fd_prestat_get,
        fd_fdstat_get : fd_fdstat_get,
        fd_write : fd_write,
        fd_prestat_dir_name : fd_prestat_dir_name,
        environ_get : environ_get,
        args_get : args_get,
        poll_oneoff : poll_oneoff,
        proc_exit : proc_exit,
        fd_close : fd_close,
        fd_seek : fd_seek,
        fd_fdstat_set_flags : fd_fdstat_set_flags,
        path_open : path_open,
        fd_read : fd_read,
        fd_datasync : fd_datasync,
        random_get : random_get,
        clock_res_get : clock_res_get,
        clock_time_get : clock_time_get,
        getModuleMemoryDataView : getModuleMemoryDataView,
    }               
  }

  /* Run a task remotely */
  sclbl.runRemote = async function(inputData, cfid){

    sclbl.log("Running task remotely...");

    let myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/x-www-form-urlencoded");

    let data = {
      "input": inputData
    };

    let input = {
        "content-type": "json",
        "location": "embedded",
        "data": JSON.stringify(data),
    };

    let output = {
      "content-type":"json",
      "location": "echo",
    };

    let properties = {"language":"WASM"};

    let raw = {
      "input":input,
      "output":output,
      "control":1,
      "properties":properties,
    };

    console.log(JSON.stringify(raw))

    let requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: JSON.stringify(raw),
      redirect: 'follow'
    };

    let result = await fetch(TASKMAKANGER_LOCATION + cfid, requestOptions)
      .then(response => response.text())
      .then(function(result){
        return result;
      })
      .catch(function(error){
        sclbl.log("Unable to generate remote prediction: " + err)
        throw new Error("Unable to generate remote prediction.")
      });

    return result;

  };

  /* Simple logger */
  sclbl.log = function(str){
    if(sclbl.settings.debug){
      console.log(str);
    }
  };

  /* Log debug mode */
  sclbl.log("Running sclblRuntime in debug mode.")

  /* Return for possible extensions */
  return sclbl;

}());
