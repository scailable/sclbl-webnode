# sclbl-webnode

> V0.01, 27-07-2020
> By: Scailable Core team

The `sclbl-webnode` allows users to run Scailable tasks (WASIs) both locally (in the browser) or remotely (using our REST API). Usage is relatively simple. First one includes the js library:

````html
<script src="min/sclbl-webnode-min.js"></script> <!-- provides sclblRuntime object -->

````

Next, we set the desired settings:

````js
// Set task uptions:
sclblRuntime.options({
	"cfid": "XXXX-XXX-XXXX", // Required; the cfid of the task
	"location": "local",  // Optional, default local
	"strict": false,  // Optional, default false implying fallback to remote
	"inputType": "string", // Optional, default string (alternatively: "numVec", "exact")
	"outputType": "resultNumVec", // Optional default resultString (alternatively: "numVec", "exact")
	"debug": false, // Optional, default false
});

````

And finally we can run tasks using:

````js

// Run the task
sclblRuntime.run(inputData).then(function(response) {
	console.log(response);
}, function(error) {
	console.log("Error: " + error);
}

````

where `inputData` is the desired input to the task.

> See [example.html](example.html) for a working example.
> See [source/sclbl-webnode.js](source/sclbl-webnode.js) for the (annotated) vanilly JavaScript source code. Feel free to make changes.
