import httpContext from "express-http-context";
import bodyParser from "body-parser";
import express from "express";
var app = express();
var bodySizeLimit = process.env.MAX_BODY_SIZE || "100kb";
// parse JSONAPI content type
app.use(bodyParser.json({
    type: function (req) {
        // @ts-expect-error types do not define a .get method
        return /^application\/vnd\.api\+json/.test(req.get("content-type"));
    },
    limit: bodySizeLimit,
}));
app.use(bodyParser.urlencoded({ extended: false }));
// set JSONAPI content type
app.use("/", function (req, res, next) {
    res.type("application/vnd.api+json");
    next();
});
app.use(httpContext.middleware);
app.use(function (req, res, next) {
    httpContext.set("request", req);
    httpContext.set("response", res);
    next();
});
const errorHandler = function (err, _req, res, _next) {
    res.status(err.status || 400);
    res.json({
        errors: [{ title: err.message }],
    });
};
const beforeExitCallbacks = [];
function beforeExit(callback) {
    beforeExitCallbacks.push(callback);
}
// managing server cleanup
let exitHandler = async function (server) {
    console.debug("Shutting down server");
    if (beforeExitCallbacks.length) {
        for (let callback of beforeExitCallbacks) {
            await callback(server);
        }
    }
    await new Promise((acc) => {
        server.close(() => {
            console.debug("Shut down complete");
            acc(null);
        });
    });
};
/**
 * Sets a new handler for shutting down the server.
 *
 * @arg functor Function taking one argument (the result of app.listen
 * when starting the server) which should gracefully stop the server.
 */
function setExitHandler(functor) {
    exitHandler = functor;
}
export default app;
export { app, errorHandler, beforeExit, setExitHandler, exitHandler };
