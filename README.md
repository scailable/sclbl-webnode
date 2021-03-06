# sclbl-webnode

> V0.01, 27-07-2020
> By: Scailable Core team

The `sclbl-webnode` allows users to run Scailable tasks (WASI's) both locally (in the browser) or remotely (using our REST API). Usage is relatively simple. First include the WebNode JavaScript library itself:

````html
<script src="min/sclbl-webnode-min.js"></script> <!-- provides sclblRuntime object -->
````

Or include the CDN version: 

````html
<script src="https://d1avtuace03wir.cloudfront.net/sclbl-webnode-min.js"></script>
````

Next, we set the desired settings:

````js
// Set task uptions:
sclblRuntime.options({
	"cfid": "XXXX-XXX-XXXX", // Required; the cfid of the task
	"location": "local",  // Optional, default local
	"strict": false,  // Optional, default false implying fallback to remote when local fails
	"inputType": "string", // Optional, default string (alternatively: "numVec", "exact")
	"outputType": "string", // Optional default resultString (alternatively: "numVec", "exact")
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
> See [source/sclbl-webnode.js](source/sclbl-webnode.js) for the (annotated) vanilla JavaScript source code. Feel free to make changes!

> See our [Using the Scailable Webnode](https://github.com/scailable/sclbl-tutorials/tree/master/sclbl-using-the-webnode) tutorial for a fully annotated example.
