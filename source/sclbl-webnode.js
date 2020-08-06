/*
 * Scailable webnode
 *
 * Run sclbl WASI models in browser (e.g. local) or remotely (e.g., on Scailable task server)
 * See https://github.com/scailable/sclbl-webnode/README.md for details
 *
 * All rights reserved, Scailable b.v.
 *
 * 06-08-2020
 *
 */
"use strict";
let sclblRuntime = (function () {

    /* Instantiate */
    let sclbl = {};
    sclbl.cf = null;

    /* Constants */
    const CDN_LOCATION = "https://cdn.sclbl.net:8000/file/";  // location of the CDN for retrieving the .wasm files
    const TASKMAKANGER_LOCATION = "https://taskmanager.sclbl.net:8080/task/";  // Location of the taskmanger for remote running

    /* Default settings */
    sclbl.settings = {
        "cfid": "",  // compute-function id of the task (REQUIRED)
        "location": "local",  // local or remote (OPTIONAL, default local)
        "strict": false,  // if true, run only local and else fail (OPTIONAL, default false)
        "inputType": "string",  // type of the input data ("string", "numVec", "exact", ...) (OPTIONAL, default string)
        "outputType": "string",  // type of the output data ("string", "numVec", "exact", ...) (OPTIONAL, default string)
        "debug": false, // console logging in debug (OPTIONAL, default false)
        "memoryMin": 2, // Minimal WASI memory
        "memoryMax": 16384, // Maximum WASI memory
    };

    /*
     * sclbl.options() allows users to overwrite the default options.
     * Only supplied fields will be overwritten.
     */
    sclbl.options = function (options) {
        const settings = Object.keys(sclbl.settings);
        for (const key of settings) {
            if (key in options) {
                sclbl.settings[key] = options[key];
            }
        }
        sclbl.log("Settings set to:" + JSON.stringify(sclbl.settings));
    };

    /*
     * sclbl.checkSettings() checks whether all required settings are provided.
     */
    sclbl.checkSettings = function () {

        // check cfid
        if (!sclbl.settings.cfid) {
            throw new Error("No compute function ID found");
        }

        // remove .wasm if present
        if (sclbl.settings.cfid.substring(sclbl.settings.cfid.length - 5) === ".wasm") {
            sclbl.settings.cfid = sclbl.settings.cfid.slice(0, -5);
            sclbl.log("Removed .wasm from cfid.");
        }

        // checik if all fields are present
        if (!("location" in sclbl.settings)) {
            throw new Error("location missing from settings.");
        }
        if (!("strict" in sclbl.settings)) {
            throw new Error("fallback missing from settings.");
        }
        if (!("inputType" in sclbl.settings)) {
            throw new Error("inputType missing from settings.");
        }
        if (!("outputType" in sclbl.settings)) {
            throw new Error("outputType missing from settings.");
        }
        if (!("memoryMin" in sclbl.settings)) {
            throw new Error("memoryMin missing from settings.");
        }
        if (!("memoryMax" in sclbl.settings)) {
            throw new Error("memoryMax missing from settings.");
        }
    };

    /*
     * sclbl.convertLocalInput converts the provided input of a provided type
     * (where type is specified in the sclbl.settings) to the input neccesary for the local
     * .wasm binary.
     */
    sclbl.convertLocalInput = function (input, type) {

        let bArr; // input is byteArray
        let bArrBase;

        // switch based on type
        switch (type) {
            case "string":  // input is string
                input = "{\"input\": " + input + "}";
                bArrBase = new TextEncoder().encode(input);
                bArr = new Int8Array(bArrBase.length + 1);
                bArr.set(bArrBase);
                break;
            case "numVec":  // input is a numeric vector
                input = "{\"input\": [" + JSON.stringify(input) + "]}";
                bArrBase = new TextEncoder().encode(input);
                bArr = new Int8Array(bArrBase.length + 1);
                bArr.set(bArrBase);
                break;
            case "exact":  // whatever the user provides
                bArrBase = new TextEncoder().encode(input);
                bArr = new Int8Array(bArrBase.length + 1);
                bArr.set(bArrBase);
                break;

            default:  // Not yet implemented / unkown type:
                throw new Error("Unable to find the specified inputType / type not yet implemented.");
        }
        return bArr;
    };

    /*
     * sclbl.convertRemoteInput converts the provided input of a provided type
     * (where type is specified in the sclbl.settings) to the input neccesary for the
     * call to the taskserver to run the task remotely.
     *
     * Note that the {"input": ...} is added in sclbl.runRemote().
     */
    sclbl.convertRemoteInput = function (input, type) {

        let str;  // just a string

        switch (type) {
            case "string":
            case "numVec":
            case "exact":
                str = input;
                break;

            default:  // Not yet implemented.
                throw new Error("Unable to find the specified inputType / type not yet implemented.");
        }
        return str;
    };

    /*
     * sclbl.convertLocalOutput converts the provided output of a locally ran
     * compute function to the desired output type.
     */
    sclbl.convertLocalOutput = function (raw, type) {

        let output;
        let response;

        switch (type) {
            case "string":
                response = JSON.parse(raw);
                output = response.output.toString();
                break;
            case "numVec":
                response = JSON.parse(raw);
                output = response.output;
                break;
            case "exact":
            case "raw":
                output = raw;
                break;

            default:
                throw new Error("Unable to find or parse the specified output type.");
        }
        return output;
    };

    /*
     * sclbl.convertRemoteOutput converts the provided output of a remotely ran
     * compute function to the desired output type.
     */
    sclbl.convertRemoteOutput = function (raw, type) {

        let output;
        let response;
        let result;

        switch (type) {
            case "string":
                response = JSON.parse(raw);
                result = JSON.parse(response.result);
                output = JSON.parse(result.output).toString();
                break;
            case "numVec":
                response = JSON.parse(raw);
                result = JSON.parse(response.result);
                output = result.output;
                break;
            case "exact":
                try {
                    response = JSON.parse(raw);
                    output = JSON.parse(response.result);
                } catch (e) {
                    output = raw;
                }
                break;
            case "raw":
                output = raw;
                break;

            default:
                throw new Error("Unable to find or parse the specified output type.");
        }
        return output;
    };

    /*
     * sclbl.run() is the main access point to run tasks which runs a taks with the
     * specified input (the task is provided by calling sclbl.options() with the appropriate
     * settings).
     *
     * The function relies on calling either sclbl.runLocal() or sclbl.runRemote()
     */
    sclbl.run = function (rawInput) {

        // return a promise
        return new Promise(async function (resolve, reject) {   // note, async not supported by JSHint

            // check settings
            try {
                sclbl.checkSettings();
                sclbl.log("Settings ok: " + JSON.stringify(sclbl.settings));
            } catch (err) {
                sclbl.log("Error checking settings: " + err);
                return reject(err);
            }

            let location = sclbl.settings.location; // location where the job is eventually ran
            let input; // input to the task
            let output; // task result

            // if locally running
            if (sclbl.settings.location === "local") {

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
                    sclbl.log("Failed to run task locally: " + err);
                    if (!sclbl.settings.strict) { // fallback to remote if !strict
                        try {
                            input = sclbl.convertRemoteInput(rawInput, sclbl.settings.inputType);
                            output = await sclbl.runRemote(input, sclbl.settings.cfid);
                            location = "remote"; // store change of location.
                        } catch (err) {
                            return reject(err);
                        }
                    } else {
                        return reject(err);
                    }

                }
            }

            // if running remotely
            if (sclbl.settings.location === "remote") {

                // convert rawData to string using convertRemoteInput()
                try {
                    input = await sclbl.convertRemoteInput(rawInput, sclbl.settings.inputType);
                    sclbl.log("Input converted to: " + input);
                } catch (err) {
                    return reject(err);
                }

                // run the task remotely
                try {
                    output = await sclbl.runRemote(input, sclbl.settings.cfid);
                } catch (err) {
                    return reject(err);
                }

            }

            // process output depending on where the job ran
            let result;
            if (location === "local") {
                result = sclbl.convertLocalOutput(output, sclbl.settings.outputType);
            } else if (location === "remote") {
                result = sclbl.convertRemoteOutput(output, sclbl.settings.outputType);
            } else {
                return reject(new Error("Unable to parse task output."));
            }

            sclbl.log("Converted output: " + JSON.stringify(result));

            // return
            resolve(result);
        });
    };

    /*
     * sclbl.runLocal() runs a task by downloading the WASI and running it
     * in the browser.
     */
    sclbl.runLocal = async function (inputData, cfid) {

        sclbl.log("Trying to run task locally.");

        // instantiate polyFill
        let polyFill
        try {
            polyFill = new WASI();
        } catch (err) {
            sclbl.log("Unable to instantiate WASI polyfill: " + err)
            throw new Error("Unable to instantiate WASI polyfill")
        }

        // import the WASI
        try {
            await sclbl.import(cfid, polyFill)
        } catch (err) {
            sclbl.log("Unable to import WASI module: " + err)
            throw new Error("Unable to import WASI module.");
        }

        // do prediction
        let output;
        try {
            output = sclbl.predict(inputData);
        } catch (err) {
            sclbl.log("Unable to generate prediction: " + err)
            throw new Error("Unable to generate prediction.");
        }

        sclbl.log("Local task generated output: " + JSON.stringify(output));

        return output;

    };

    /*
     * sclbl.import() retrieves the .wasi from the CDN and initalizes it
     */
    sclbl.import = async function (cfid, polyFill) {

        // basic vars
        let moduleName = CDN_LOCATION + cfid + ".wasm";
        let module;

        // compile the module
        if (WebAssembly.compileStreaming) {
            module = await WebAssembly.compileStreaming(fetch(moduleName));
        } else {
            const response = await fetch(moduleName);
            const buffer = await response.arrayBuffer();
            module = await WebAssembly.compile(buffer);
        }

        // initialize memory
        let memory = new WebAssembly.Memory({
            initial: sclbl.settings.memoryMin,
            maximum: sclbl.settings.memoryMax
        });
        // assign an empty environment and the initialized memory to imported module
        let moduleImports = {env: {}, js: {mem: memory}};
        // retrieve namespace from downloaded WASM module; for example, wasi_snapshot_preview1
        const nspace = sclbl.getImportNamespace(module);
        // and assign polyfill to namespace
        moduleImports[nspace] = polyFill;

        // instantiate
        const instance = await WebAssembly.instantiate(module, moduleImports);
        polyFill.setModuleInstance(instance);

        // run start
        instance.exports._start();

        /* set the instance to the scailable object */
        sclbl.cf = instance;

    }

    // From: https://github.com/wasmerio/wasmer-js/blob/
    // 4e660caedba56e50db0da9238a789ab0e2f989be/packages/
    // wasi/src/index.ts#L1528

    sclbl.getImportNamespace = function (module) {
        let namespace = null;
        for (let imp of WebAssembly.Module.imports(module)) {
            // We only check for the functions
            if (imp.kind !== "function") {
                continue;
            }
            // We allow functions in other namespaces other than wasi
            if (!imp.module.startsWith("wasi_")) {
                continue
            }
            if (!namespace) {
                namespace = imp.module;
            } else {
                if (namespace !== imp.module) {
                    throw new Error("Multiple namespaces detected.")
                }
            }
        }
        return namespace;
    }

    /*
     * sclbl.predict() carries out the actual prediction for a locally
     * ran task.
     */
    sclbl.predict = function (bArray) {

        let inputLength = bArray.length;  //byteLength;

        let p_input = sclbl.cf.exports.malloc_buffer(inputLength);

        // WebAssembly allows an instance's memory to grow during execution.
        // Calling malloc from JavaScript triggers a resize, invalidating wasmMemory.
        // Any attempt to read or write it will result an error, if it is not reassigned.
        let wasmMemory = new Uint8Array(sclbl.cf.exports.memory.buffer);
        wasmMemory.set(bArray, p_input);

        // run pred() function
        sclbl.cf.exports.pred();

        // get output:
        let p_output = sclbl.cf.exports.get_out_loc();
        sclbl.cf.exports.free_buffer();
        let outputLen = sclbl.cf.exports.get_out_len();
        wasmMemory = new Uint8Array(sclbl.cf.exports.memory.buffer);
        let uint8array = wasmMemory.slice(p_output, p_output + outputLen);
        let result = new TextDecoder().decode(uint8array);

        // and free buffers
        sclbl.cf.exports.free_buffer();

        return result;
    };

    /*
     * WASI is our implementaiton of a minimal WASI polyfill.
     * This was heavily inspired by http://www.wasmtutor.com/webassembly-barebones-wasi
     * with some minor tweaks
     */
    let WASI = function () {

        let moduleInstanceExports = null;
        const WASI_ESUCCESS = 0;
        const WASI_EBADF = 8;
        const WASI_EINVAL = 28;
        const WASI_ENOSYS = 52;
        const WASI_STDOUT_FILENO = 1;

        function setModuleInstance(instance) {
            moduleInstanceExports = instance.exports;
        }

        function getModuleMemoryDataView() {
            return new DataView(moduleInstanceExports.memory.buffer);
        }

        function fd_prestat_get(fd, bufPtr) {
            sclbl.log("Call to WASI.fd_prestat_get()");
            return WASI_EBADF;
        }

        function fd_prestat_dir_name(fd, pathPtr, pathLen) {
            sclbl.log("Call to WASI.fd_prestat_dir_name()");
            return WASI_EINVAL;
        }

        function environ_sizes_get(environCount, environBufSize) {
            sclbl.log("Call to WASI.environ_sizes_get()");
            const view = getModuleMemoryDataView();
            view.setUint32(environCount, 0, !0);
            view.setUint32(environBufSize, 0, !0);
            return WASI_ESUCCESS;
        }

        function environ_get(environ, environBuf) {
            sclbl.log("Call to WASI.environ_get()");
            return WASI_ESUCCESS;
        }

        function args_sizes_get(argc, argvBufSize) {
            sclbl.log("Call to WASI.args_sizes_get()");
            const view = getModuleMemoryDataView();
            view.setUint32(argc, 0, !0);
            view.setUint32(argvBufSize, 0, !0);
            return WASI_ESUCCESS;
        }

        function args_get(argv, argvBuf) {
            sclbl.log("Call to WASI.args_get()");
            return WASI_ESUCCESS;
        }

        function fd_fdstat_get(fd, bufPtr) {

            sclbl.log("Call to WASI.fd_fdstat_get()");
            const view = getModuleMemoryDataView();
            view.setUint8(bufPtr, fd);
            view.setUint16(bufPtr + 2, 0, !0);
            view.setUint16(bufPtr + 4, 0, !0);

            function setBigUint64(byteOffset, value, littleEndian) {
                const lowWord = value;
                const highWord = 0;
                view.setUint32(littleEndian ? 0 : 4, lowWord, littleEndian);
                view.setUint32(littleEndian ? 4 : 0, highWord, littleEndian);
            }

            setBigUint64(bufPtr + 8, 0, !0);
            setBigUint64(bufPtr + 8 + 8, 0, !0);
            return WASI_ESUCCESS;
        }

        function fd_write(fd, iovs, iovsLen, nwritten) {

            sclbl.log("Call to WASI.fd_write()");
            const view = getModuleMemoryDataView();
            let written = 0;
            const bufferBytes = [];

            function getiovs(iovs, iovsLen) {
                const buffers = Array.from({length: iovsLen}, function (_, i) {
                    const ptr = iovs + i * 8;
                    const buf = view.getUint32(ptr, !0);
                    const bufLen = view.getUint32(ptr + 4, !0);
                    return new Uint8Array(moduleInstanceExports.memory.buffer, buf, bufLen);
                });
                return buffers;
            }

            let buffers = getiovs(iovs, iovsLen);

            function writev(iov) {
                for (let b = 0; b < iov.byteLength; b++) {
                    bufferBytes.push(iov[b]);
                }
                written += b;
            }

            buffers.forEach(writev);
            if (fd === WASI_STDOUT_FILENO) {
                sclbl.log("Error in WASI:" + String.fromCharCode.apply(null, bufferBytes));
            }
            view.setUint32(nwritten, written, !0);

            return WASI_ESUCCESS;
        }

        function poll_oneoff(sin, sout, nsubscriptions, nevents) {
            sclbl.log("Call to WASI.poll_oneoff()");
            return WASI_ENOSYS;
        }

        function proc_exit(rval) {
            sclbl.log("Call to WASI.proc_exit()");
            return WASI_ENOSYS;
        }

        function fd_close(fd) {
            sclbl.log("Call to WASI.fd_close()");
            return WASI_ENOSYS;
        }

        function fd_seek(fd, offset, whence, newOffsetPtr) {
            sclbl.log("Call to WASI.fd_seek()");
        }

        function fd_close(fd) {
            sclbl.log("Call to WASI.fd_close()");
            return WASI_ENOSYS;
        }

        // added stubs
        function fd_fdstat_set_flags() {
            sclbl.log("WASI.stub.1");
        }

        function path_open() {
            sclbl.log("WASI.stub.2");
        }

        function fd_read() {
            sclbl.log("WASI.stub.3");
        }

        function fd_datasync() {
            sclbl.log("WASI.stub.4");
        }

        function random_get() {
            sclbl.log("WASI.stub.5");
        }

        function clock_res_get() {
            sclbl.log("WASI.stub.6");
        }

        function clock_time_get() {
            sclbl.log("WASI.stub.7");
        }

        //end

        return {
            setModuleInstance: setModuleInstance,
            environ_sizes_get: environ_sizes_get,
            args_sizes_get: args_sizes_get,
            fd_prestat_get: fd_prestat_get,
            fd_fdstat_get: fd_fdstat_get,
            fd_write: fd_write,
            fd_prestat_dir_name: fd_prestat_dir_name,
            environ_get: environ_get,
            args_get: args_get,
            poll_oneoff: poll_oneoff,
            proc_exit: proc_exit,
            fd_close: fd_close,
            fd_seek: fd_seek,
            fd_fdstat_set_flags: fd_fdstat_set_flags,
            path_open: path_open,
            fd_read: fd_read,
            fd_datasync: fd_datasync,
            random_get: random_get,
            clock_res_get: clock_res_get,
            clock_time_get: clock_time_get,
            getModuleMemoryDataView: getModuleMemoryDataView,
        };
    };


    sclbl.stringHasCorrectJSONStructure = function (str) {
        let result;
        // is this JSON?
        if (typeof str !== 'string') return false;
        try {
            result = JSON.parse(str);
            const type = Object.prototype.toString.call(result);
            return type === '[object Object]'
                || type === '[object Array]';
        } catch (err) {
            return false;
        }
        // check if the parse JSON contains an "input" key
        if ("input" in str) {
            return false;
        }
        return true
    };

    /*
     * sclbl.runRemote() runs a task remotely on the task server
     * and returns the result. It is the fallback when settings.strict = false;
     */
    sclbl.runRemote = async function (inputData, cfid) {

        sclbl.log("Trying to run task remotely.");

        let myHeaders = new Headers();
        myHeaders.append("Content-Type", "application/x-www-form-urlencoded");

        // create correctly formatted stringified JSON input data
        let data;
        //  check if inputData is a string and can itself
        //  be parsed correctly as structured JSON data
        if (sclbl.stringHasCorrectJSONStructure(inputData)) {
            data = inputData;
        } else {
            // otherwise, set inputData as JSON input and stringify
            let jsonInput = {"input": inputData};
            data = JSON.stringify(jsonInput);
        }

        let input = {
            "content-type": "json",
            "location": "embedded",
            "data": data,
        };

        let output = {
            "content-type": "json",
            "location": "echo",
        };

        let properties = {"language": "WASM"};

        let raw = {
            "input": input,
            "output": output,
            "control": 1,
            "properties": properties,
        };

        let requestOptions = {
            method: 'POST',
            headers: myHeaders,
            body: JSON.stringify(raw),
            redirect: 'follow'
        };

        let result = await fetch(TASKMAKANGER_LOCATION + cfid, requestOptions)
            .then(response => response.text())
            .then(function (result) {
                return result;
            })
            .catch(function (error) {
                sclbl.log("Unable to generate remote prediction: " + error)
                throw new Error("Unable to generate remote prediction.")
            });

        sclbl.log("Remote task generated output: " + JSON.stringify(result));

        return result;

    };

    /*
     * sclbl.log() controls logging behavior; only log to console when
     * package is in debug mode. Default is false.
     */
    sclbl.log = function (str) {
        if (sclbl.settings.debug) {
            console.log(str);
        }
    };

    // log debug mode
    sclbl.log("Running sclblRuntime in debug mode.")

    // return for possible extensions
    return sclbl;

}());