import httpContext from "express-http-context";
// @ts-expect-error we don't have type defs for this package
import SC2 from "sparql-client-2";
import env from "env-var";

const { SparqlClient, SPARQL } = SC2;

const LOG_SPARQL_QUERIES =
  process.env.LOG_SPARQL_QUERIES != undefined
    ? env.get("LOG_SPARQL_QUERIES").asBool()
    : env.get("LOG_SPARQL_ALL").asBool();
const LOG_SPARQL_UPDATES =
  process.env.LOG_SPARQL_UPDATES != undefined
    ? env.get("LOG_SPARQL_UPDATES").asBool()
    : env.get("LOG_SPARQL_ALL").asBool();
const DEBUG_AUTH_HEADERS = env.get("DEBUG_AUTH_HEADERS").asBool();

type UserOptions = {
  sudo?: boolean;
  scope?: string;
  endpoint?: string;
};
//==-- logic --==//

// builds a new sparqlClient
function newSparqlClient(userOptions: UserOptions) {
  let options: { requestDefaults: { headers: Record<string, string> } } = {
    requestDefaults: { headers: {} },
  };
  if (userOptions.sudo === true) {
    if (env.get("ALLOW_MU_AUTH_SUDO").asBool()) {
      options.requestDefaults.headers["mu-auth-sudo"] = "true";
    } else {
      throw "Error, sudo request but service lacks ALLOW_MU_AUTH_SUDO header";
    }
  }

  if (userOptions.scope) {
    options.requestDefaults.headers["mu-auth-scope"] = userOptions.scope;
  } else if (process.env.DEFAULT_MU_AUTH_SCOPE) {
    options.requestDefaults.headers["mu-auth-scope"] =
      process.env.DEFAULT_MU_AUTH_SCOPE;
  }

  if (httpContext.get("request")) {
    options.requestDefaults.headers["mu-session-id"] = httpContext
      .get("request")
      .get("mu-session-id");
    options.requestDefaults.headers["mu-call-id"] = httpContext
      .get("request")
      .get("mu-call-id");
    options.requestDefaults.headers["mu-auth-allowed-groups"] = httpContext
      .get("request")
      .get("mu-auth-allowed-groups"); // groups of incoming request
  }

  if (httpContext.get("response")) {
    const allowedGroups = httpContext
      .get("response")
      .get("mu-auth-allowed-groups"); // groups returned by a previous SPARQL query
    if (allowedGroups)
      options.requestDefaults.headers["mu-auth-allowed-groups"] = allowedGroups;
  }

  if (DEBUG_AUTH_HEADERS) {
    console.log(`Headers set on SPARQL client: ${JSON.stringify(options)}`);
  }

  return new SparqlClient(userOptions.endpoint ?? process.env.MU_SPARQL_ENDPOINT, options);
}

/**
 * @typedef {Object} QueryOptions
 * @property {boolean?} sudo Execute the query as sudo
 * @property {string?} scope URI of the scope with whith the query is executed.  Use the environment variable `DEFAULT_MU_AUTH_SCOPE` if possible.
 */

/**
 * Execute a sparql QUERY.  Intended for use with QUERY and ASK.
 *
 * See environment variables for logging: `LOG_SPARQL_ALL`, `LOG_SPARQL_QUERIES`, `DEBUG_AUTH_HEADERS`
 *
 */
function query(queryString: string, options?: UserOptions) {
  if (LOG_SPARQL_QUERIES) {
    console.log(queryString);
  }
  return executeQuery(queryString, options);
}

/**
 * Execute a sparql QUERY.
 * Intended for use with `DELETE {} INSERT {} WHERE {}`, `INSERT DATA` and `DELETE DATA`.
 *
 * See environment variables for logging: `LOG_SPARQL_ALL`, `LOG_SPARQL_UPDATES`, `DEBUG_AUTH_HEADERS`
 *
 * */
function update(queryString: string, options?: UserOptions) {
  if (LOG_SPARQL_UPDATES) {
    console.log(queryString);
  }
  return executeQuery(queryString, options);
}

function executeQuery(queryString: string, options?: UserOptions) {
  return newSparqlClient(options || {})
    .query(queryString)
    .executeRaw()
    .then((response: Response) => {
      const temp = httpContext;

      if (
        httpContext.get("response") &&
        !httpContext.get("response").headersSent
      ) {
        // set mu-auth-allowed-groups on outgoing response
        // @ts-expect-error we should probably access this header with `.get`
        const allowedGroups = response.headers["mu-auth-allowed-groups"];
        if (allowedGroups) {
          httpContext
            .get("response")
            .setHeader("mu-auth-allowed-groups", allowedGroups);
          if (DEBUG_AUTH_HEADERS) {
            console.log(`Update mu-auth-allowed-groups to ${allowedGroups}`);
          }
        } else {
          httpContext.get("response").removeHeader("mu-auth-allowed-groups");
          if (DEBUG_AUTH_HEADERS) {
            console.log("Remove mu-auth-allowed-groups");
          }
        }

        // set mu-auth-used-groups on outgoing response
        // @ts-expect-error we should probably access this header with `.get`
        const usedGroups = response.headers["mu-auth-used-groups"];
        if (usedGroups) {
          httpContext
            .get("response")
            .setHeader("mu-auth-used-groups", usedGroups);
          if (DEBUG_AUTH_HEADERS) {
            console.log(`Update mu-auth-used-groups to ${usedGroups}`);
          }
        } else {
          httpContext.get("response").removeHeader("mu-auth-used-groups");
          if (DEBUG_AUTH_HEADERS) {
            console.log("Remove mu-auth-used-groups");
          }
        }
      }

      function maybeParseJSON(body: Response["body"]) {
        // Catch invalid JSON
        try {
          // @ts-expect-error parse expects a string
          return JSON.parse(body);
        } catch (ex) {
          return null;
        }
      }

      return maybeParseJSON(response.body);
    });
}

/**
 * Escapes a string for use in SPARQL.
 *
 * Wraps the string in quotes and escapes necessary characters.

 */
function sparqlEscapeString(value: string) {
  return (
    '"""' +
    value.replace(/[\\"]/g, function (match) {
      return "\\" + match;
    }) +
    '"""'
  );
}

/**
 * Escapes a URI for use in SPARQL.
 *
 * Wraps the URI in < and > and escapes necessary characters.
 */
function sparqlEscapeUri(value: string) {
  return (
    "<" +
    value.replace(/[\\"<>]/g, function (match) {
      return "\\" + match;
    }) +
    ">"
  );
}

/**
 * Escapes a float for use in SPARQL as xsd:decimal.
 *
 */
function sparqlEscapeDecimal(value: string) {
  return '"' + Number.parseFloat(value) + '"^^xsd:decimal';
}

/**
 * Escapes an integer for use in SPARQL as xsd:integer.
 *
 */
function sparqlEscapeInt(value: string) {
  return '"' + Number.parseInt(value) + '"^^xsd:integer';
}

/**
 * Escapes a number for use in SPARQL as xsd:float.
 *
 */
function sparqlEscapeFloat(value: string) {
  return '"' + Number.parseFloat(value) + '"^^xsd:float';
}

/**
 * Escapes a date string or date object into an xsd:date for use in SPARQL.

 */
function sparqlEscapeDate(value: string | number | Date) {
  return '"' + new Date(value).toISOString().substring(0, 10) + '"^^xsd:date'; // only keep 'YYYY-MM-DD' portion of the string
}

/**
 * Escapes a date string or date object into an xsd:dateTime for use in a SPARQL.
 */
function sparqlEscapeDateTime(value: string | number | Date) {
  return '"' + new Date(value).toISOString() + '"^^xsd:dateTime';
}

/**
 * Escape boolean-like value into xsd:boolean for use in a SPARQL string.
 *
 */
function sparqlEscapeBool(value: unknown) {
  return value ? '"true"^^xsd:boolean' : '"false"^^xsd:boolean';
}

/**
 * Escapes a value based on the supplide type rather than the separately published functions.  Prefer to use the
 * functions.
 *
 */
function sparqlEscape(
  value: any,
  type:
    | "string"
    | "uri"
    | "bool"
    | "decimal"
    | "int"
    | "float"
    | "date"
    | "dateTime"
) {
  switch (type) {
    case "string":
      return sparqlEscapeString(value);
    case "uri":
      return sparqlEscapeUri(value);
    case "bool":
      return sparqlEscapeBool(value);
    case "decimal":
      return sparqlEscapeDecimal(value);
    case "int":
      return sparqlEscapeInt(value);
    case "float":
      return sparqlEscapeFloat(value);
    case "date":
      return sparqlEscapeDate(value);
    case "dateTime":
      return sparqlEscapeDateTime(value);
    default:
      console.error(`WARN: Unknown escape type '${type}'. Escaping as string`);
      return sparqlEscapeString(value);
  }
}

//==-- exports --==//
const exports = {
  newSparqlClient: newSparqlClient,
  SPARQL: SPARQL,
  sparql: SPARQL,
  query: query,
  update: update,
  sparqlEscape: sparqlEscape,
  sparqlEscapeString: sparqlEscapeString,
  sparqlEscapeUri: sparqlEscapeUri,
  sparqlEscapeDecimal: sparqlEscapeDecimal,
  sparqlEscapeInt: sparqlEscapeInt,
  sparqlEscapeFloat: sparqlEscapeFloat,
  sparqlEscapeDate: sparqlEscapeDate,
  sparqlEscapeDateTime: sparqlEscapeDateTime,
  sparqlEscapeBool: sparqlEscapeBool,
};
export default exports;

export {
  newSparqlClient,
  SPARQL as SPARQL,
  SPARQL as sparql,
  query,
  update,
  sparqlEscape,
  sparqlEscapeString,
  sparqlEscapeUri,
  sparqlEscapeDecimal,
  sparqlEscapeInt,
  sparqlEscapeFloat,
  sparqlEscapeDate,
  sparqlEscapeDateTime,
  sparqlEscapeBool,
};
