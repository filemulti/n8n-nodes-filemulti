// packages/client/src/ftl.ts
var PLACEABLE = /\{[^}]*\}/g;
var VARIABLE = /^\{ \$([a-zA-Z]+) \}$/;
function filled(pattern, name, value) {
  return pattern.replaceAll(`{ $${name} }`, () => value);
}
function fillAppName(pattern, appName) {
  if (typeof pattern === "string")
    return filled(pattern, "appName", appName);
  return {
    ...pattern,
    variants: Object.fromEntries(Object.entries(pattern.variants).map(([name, words]) => [
      name,
      filled(words, "appName", appName)
    ]))
  };
}
var tenths = (value) => Math.round(value * 10) / 10;
function numberShown(value, locale) {
  const language = locale.toLowerCase().split(/[-_]/)[0] || "en";
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(tenths(value));
}
function variantOf(selector, language, args) {
  const value = args[selector.on];
  if (typeof value !== "number") {
    throw new Error(`$${selector.on} is not a number`);
  }
  const category = new Intl.PluralRules(language).select(tenths(value));
  return selector.variants[category] ?? selector.variants[selector.other];
}
function formatPattern(pattern, language, args = {}) {
  const words = typeof pattern === "string" ? pattern : variantOf(pattern, language, args);
  return words.replace(PLACEABLE, (placeable) => {
    const name = VARIABLE.exec(placeable)?.[1] ?? "";
    const value = args[name];
    if (value === undefined)
      throw new Error(`$${name} is not given`);
    return typeof value === "number" ? numberShown(value, language) : value;
  });
}

// packages/client/src/catalog.ts
var LANGUAGES = ["en", "ru", "es"];
function catalogLanguage(locale) {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return LANGUAGES.find((known) => known === language) ?? "en";
}
function rateOf(price, locale) {
  const credits = numberShown(price.credits ?? 0, locale);
  if (price.class === "heavy") {
    return `${credits} / ${price.block} ${price.unit}`;
  }
  if (price.class === "utility")
    return `${credits} / ${price.calls_per_charge}`;
  return;
}
function quoteBodyOf(price, body, bytes) {
  if (price.class === "heavy")
    return body;
  if (price.class === "utility")
    return;
  return { tool: body.tool, input_bytes: [bytes] };
}
function ceilingFrom(price, quoted) {
  if (quoted !== undefined)
    return quoted.credits_at_most ?? quoted.credits;
  if (price.credits === undefined) {
    throw new Error(`a ${price.class} price names no credits`);
  }
  return price.credits;
}
function quoteLines(quoted, say) {
  const most = quoted.credits_at_most ?? quoted.credits;
  const ranged = most > quoted.credits;
  const lines = [
    ranged ? say("channel-run-price-range", {
      minCredits: quoted.credits,
      maxCredits: most
    }) : say("channel-run-price", { credits: quoted.credits })
  ];
  const funds = quoted.funds;
  if (funds === undefined || funds === null)
    return lines;
  const short = funds.shortfall ?? 0;
  lines.push(short > 0 ? say("channel-credits-short-by", { credits: short }) : say(ranged ? "channel-run-balance-after-least" : "channel-run-balance-after", { credits: funds.remaining_after }));
  return lines;
}

// packages/client/src/disposition.ts
function fileNameOf(disposition) {
  const plain = disposition?.match(/filename="([^"]*)"/i)?.[1];
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded === undefined)
    return plain;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return plain;
  }
}

// packages/client/src/generated/core/bodySerializer.gen.ts
var serializeFormDataPair = (data, key, value) => {
  if (typeof value === "string" || value instanceof Blob) {
    data.append(key, value);
  } else if (value instanceof Date) {
    data.append(key, value.toISOString());
  } else {
    data.append(key, JSON.stringify(value));
  }
};
var formDataBodySerializer = {
  bodySerializer: (body) => {
    const data = new FormData;
    Object.entries(body).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v) => serializeFormDataPair(data, key, v));
      } else {
        serializeFormDataPair(data, key, value);
      }
    });
    return data;
  }
};
var jsonBodySerializer = {
  bodySerializer: (body) => JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value)
};
// packages/client/src/generated/core/params.gen.ts
var extraPrefixesMap = {
  $body_: "body",
  $headers_: "headers",
  $path_: "path",
  $query_: "query"
};
var extraPrefixes = Object.entries(extraPrefixesMap);
// packages/client/src/generated/core/serverSentEvents.gen.ts
function createSseClient({
  onRequest,
  onSseError,
  onSseEvent,
  responseTransformer,
  responseValidator,
  sseDefaultRetryDelay,
  sseMaxRetryAttempts,
  sseMaxRetryDelay,
  sseSleepFn,
  url,
  ...options
}) {
  let lastEventId;
  const sleep = sseSleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const createStream = async function* () {
    let retryDelay = sseDefaultRetryDelay ?? 3000;
    let attempt = 0;
    const signal = options.signal ?? new AbortController().signal;
    while (true) {
      if (signal.aborted)
        break;
      attempt++;
      const headers = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
      if (lastEventId !== undefined) {
        headers.set("Last-Event-ID", lastEventId);
      }
      try {
        const requestInit = {
          redirect: "follow",
          ...options,
          body: options.serializedBody,
          headers,
          signal
        };
        let request = new Request(url, requestInit);
        if (onRequest) {
          request = await onRequest(url, requestInit);
        }
        const _fetch = options.fetch ?? globalThis.fetch;
        const response = await _fetch(request);
        if (!response.ok)
          throw new Error(`SSE failed: ${response.status} ${response.statusText}`);
        if (!response.body)
          throw new Error("No body in SSE response");
        const reader = response.body.pipeThrough(new TextDecoderStream).getReader();
        let buffer = "";
        const abortHandler = () => {
          try {
            reader.cancel();
          } catch {}
        };
        signal.addEventListener("abort", abortHandler);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            buffer += value;
            buffer = buffer.replace(/\r\n?/g, `
`);
            const chunks = buffer.split(`

`);
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) {
              const lines = chunk.split(`
`);
              const dataLines = [];
              let eventName;
              for (const line of lines) {
                if (line.startsWith("data:")) {
                  dataLines.push(line.replace(/^data:\s*/, ""));
                } else if (line.startsWith("event:")) {
                  eventName = line.replace(/^event:\s*/, "");
                } else if (line.startsWith("id:")) {
                  lastEventId = line.replace(/^id:\s*/, "");
                } else if (line.startsWith("retry:")) {
                  const parsed = Number.parseInt(line.replace(/^retry:\s*/, ""), 10);
                  if (!Number.isNaN(parsed)) {
                    retryDelay = parsed;
                  }
                }
              }
              let data;
              let parsedJson = false;
              if (dataLines.length) {
                const rawData = dataLines.join(`
`);
                try {
                  data = JSON.parse(rawData);
                  parsedJson = true;
                } catch {
                  data = rawData;
                }
              }
              if (parsedJson) {
                if (responseValidator) {
                  await responseValidator(data);
                }
                if (responseTransformer) {
                  data = await responseTransformer(data);
                }
              }
              onSseEvent?.({
                data,
                event: eventName,
                id: lastEventId,
                retry: retryDelay
              });
              if (dataLines.length) {
                yield data;
              }
            }
          }
        } finally {
          signal.removeEventListener("abort", abortHandler);
          reader.releaseLock();
        }
        break;
      } catch (error) {
        onSseError?.(error);
        if (sseMaxRetryAttempts !== undefined && attempt >= sseMaxRetryAttempts) {
          break;
        }
        const backoff = Math.min(retryDelay * 2 ** (attempt - 1), sseMaxRetryDelay ?? 30000);
        await sleep(backoff);
      }
    }
  };
  const stream = createStream();
  return { stream };
}

// packages/client/src/generated/core/pathSerializer.gen.ts
var separatorArrayExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var separatorArrayNoExplode = (style) => {
  switch (style) {
    case "form":
      return ",";
    case "pipeDelimited":
      return "|";
    case "spaceDelimited":
      return "%20";
    default:
      return ",";
  }
};
var separatorObjectExplode = (style) => {
  switch (style) {
    case "label":
      return ".";
    case "matrix":
      return ";";
    case "simple":
      return ",";
    default:
      return "&";
  }
};
var serializeArrayParam = ({
  allowReserved,
  explode,
  name,
  style,
  value
}) => {
  if (!explode) {
    const joinedValues = (allowReserved ? value : value.map((v) => encodeURIComponent(v))).join(separatorArrayNoExplode(style));
    switch (style) {
      case "label":
        return `.${joinedValues}`;
      case "matrix":
        return `;${name}=${joinedValues}`;
      case "simple":
        return joinedValues;
      default:
        return `${name}=${joinedValues}`;
    }
  }
  const separator = separatorArrayExplode(style);
  const joinedValues = value.map((v) => {
    if (style === "label" || style === "simple") {
      return allowReserved ? v : encodeURIComponent(v);
    }
    return serializePrimitiveParam({
      allowReserved,
      name,
      value: v
    });
  }).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};
var serializePrimitiveParam = ({
  allowReserved,
  name,
  value
}) => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    throw new Error("Deeply-nested arrays/objects aren’t supported. Provide your own `querySerializer()` to handle these.");
  }
  return `${name}=${allowReserved ? value : encodeURIComponent(value)}`;
};
var serializeObjectParam = ({
  allowReserved,
  explode,
  name,
  style,
  value,
  valueOnly
}) => {
  if (value instanceof Date) {
    return valueOnly ? value.toISOString() : `${name}=${value.toISOString()}`;
  }
  if (style !== "deepObject" && !explode) {
    let values = [];
    Object.entries(value).forEach(([key, v]) => {
      values = [...values, key, allowReserved ? v : encodeURIComponent(v)];
    });
    const joinedValues = values.join(",");
    switch (style) {
      case "form":
        return `${name}=${joinedValues}`;
      case "label":
        return `.${joinedValues}`;
      case "matrix":
        return `;${name}=${joinedValues}`;
      default:
        return joinedValues;
    }
  }
  const separator = separatorObjectExplode(style);
  const joinedValues = Object.entries(value).map(([key, v]) => serializePrimitiveParam({
    allowReserved,
    name: style === "deepObject" ? `${name}[${key}]` : key,
    value: v
  })).join(separator);
  return style === "label" || style === "matrix" ? separator + joinedValues : joinedValues;
};

// packages/client/src/generated/core/utils.gen.ts
var PATH_PARAM_RE = /\{[^{}]+\}/g;
var defaultPathSerializer = ({ path, url: _url }) => {
  let url = _url;
  const matches = _url.match(PATH_PARAM_RE);
  if (matches) {
    for (const match of matches) {
      let explode = false;
      let name = match.substring(1, match.length - 1);
      let style = "simple";
      if (name.endsWith("*")) {
        explode = true;
        name = name.substring(0, name.length - 1);
      }
      if (name.startsWith(".")) {
        name = name.substring(1);
        style = "label";
      } else if (name.startsWith(";")) {
        name = name.substring(1);
        style = "matrix";
      }
      const value = path[name];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        url = url.replace(match, serializeArrayParam({ explode, name, style, value }));
        continue;
      }
      if (typeof value === "object") {
        url = url.replace(match, serializeObjectParam({
          explode,
          name,
          style,
          value,
          valueOnly: true
        }));
        continue;
      }
      if (style === "matrix") {
        url = url.replace(match, `;${serializePrimitiveParam({
          name,
          value
        })}`);
        continue;
      }
      const replaceValue = encodeURIComponent(style === "label" ? `.${value}` : value);
      url = url.replace(match, replaceValue);
    }
  }
  return url;
};
var getUrl = ({
  baseUrl,
  path,
  query,
  querySerializer,
  url: _url
}) => {
  const pathUrl = _url.startsWith("/") ? _url : `/${_url}`;
  let url = (baseUrl ?? "") + pathUrl;
  if (path) {
    url = defaultPathSerializer({ path, url });
  }
  let search = query ? querySerializer(query) : "";
  if (search.startsWith("?")) {
    search = search.substring(1);
  }
  if (search) {
    url += `?${search}`;
  }
  return url;
};
function getValidRequestBody(options) {
  const hasBody = options.body !== undefined;
  const isSerializedBody = hasBody && options.bodySerializer;
  if (isSerializedBody) {
    if ("serializedBody" in options) {
      const hasSerializedBody = options.serializedBody !== undefined && options.serializedBody !== "";
      return hasSerializedBody ? options.serializedBody : null;
    }
    return options.body !== "" ? options.body : null;
  }
  if (hasBody) {
    return options.body;
  }
  return;
}

// packages/client/src/generated/core/auth.gen.ts
var getAuthToken = async (auth, callback) => {
  const token = typeof callback === "function" ? await callback(auth) : callback;
  if (!token) {
    return;
  }
  if (auth.scheme === "bearer") {
    return `Bearer ${token}`;
  }
  if (auth.scheme === "basic") {
    return `Basic ${btoa(token)}`;
  }
  return token;
};

// packages/client/src/generated/client/utils.gen.ts
var createQuerySerializer = ({
  parameters = {},
  ...args
} = {}) => {
  const querySerializer = (queryParams) => {
    const search = [];
    if (queryParams && typeof queryParams === "object") {
      for (const name in queryParams) {
        const value = queryParams[name];
        if (value === undefined || value === null) {
          continue;
        }
        const options = parameters[name] || args;
        if (Array.isArray(value)) {
          const serializedArray = serializeArrayParam({
            allowReserved: options.allowReserved,
            explode: true,
            name,
            style: "form",
            value,
            ...options.array
          });
          if (serializedArray)
            search.push(serializedArray);
        } else if (typeof value === "object") {
          const serializedObject = serializeObjectParam({
            allowReserved: options.allowReserved,
            explode: true,
            name,
            style: "deepObject",
            value,
            ...options.object
          });
          if (serializedObject)
            search.push(serializedObject);
        } else {
          const serializedPrimitive = serializePrimitiveParam({
            allowReserved: options.allowReserved,
            name,
            value
          });
          if (serializedPrimitive)
            search.push(serializedPrimitive);
        }
      }
    }
    return search.join("&");
  };
  return querySerializer;
};
var getParseAs = (contentType) => {
  if (!contentType) {
    return "stream";
  }
  const cleanContent = contentType.split(";")[0]?.trim();
  if (!cleanContent) {
    return;
  }
  if (cleanContent.startsWith("application/json") || cleanContent.endsWith("+json")) {
    return "json";
  }
  if (cleanContent === "multipart/form-data") {
    return "formData";
  }
  if (["application/", "audio/", "image/", "video/"].some((type) => cleanContent.startsWith(type))) {
    return "blob";
  }
  if (cleanContent.startsWith("text/")) {
    return "text";
  }
  return;
};
var checkForExistence = (options, name) => {
  if (!name) {
    return false;
  }
  if (options.headers.has(name) || options.query?.[name] || options.headers.get("Cookie")?.includes(`${name}=`)) {
    return true;
  }
  return false;
};
async function setAuthParams(options) {
  for (const auth of options.security ?? []) {
    if (checkForExistence(options, auth.name)) {
      continue;
    }
    const token = await getAuthToken(auth, options.auth);
    if (!token) {
      continue;
    }
    const name = auth.name ?? "Authorization";
    switch (auth.in) {
      case "query":
        if (!options.query) {
          options.query = {};
        }
        options.query[name] = token;
        break;
      case "cookie":
        options.headers.append("Cookie", `${name}=${token}`);
        break;
      case "header":
      default:
        options.headers.set(name, token);
        break;
    }
  }
}
var buildUrl = (options) => getUrl({
  baseUrl: options.baseUrl,
  path: options.path,
  query: options.query,
  querySerializer: typeof options.querySerializer === "function" ? options.querySerializer : createQuerySerializer(options.querySerializer),
  url: options.url
});
var mergeConfigs = (a, b) => {
  const config = { ...a, ...b };
  if (config.baseUrl?.endsWith("/")) {
    config.baseUrl = config.baseUrl.substring(0, config.baseUrl.length - 1);
  }
  config.headers = mergeHeaders(a.headers, b.headers);
  return config;
};
var headersEntries = (headers) => {
  const entries = [];
  headers.forEach((value, key) => {
    entries.push([key, value]);
  });
  return entries;
};
var mergeHeaders = (...headers) => {
  const mergedHeaders = new Headers;
  for (const header of headers) {
    if (!header) {
      continue;
    }
    const iterator = header instanceof Headers ? headersEntries(header) : Object.entries(header);
    for (const [key, value] of iterator) {
      if (value === null) {
        mergedHeaders.delete(key);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          mergedHeaders.append(key, v);
        }
      } else if (value !== undefined) {
        mergedHeaders.set(key, typeof value === "object" ? JSON.stringify(value) : value);
      }
    }
  }
  return mergedHeaders;
};

class Interceptors {
  fns = [];
  clear() {
    this.fns = [];
  }
  eject(id) {
    const index = this.getInterceptorIndex(id);
    if (this.fns[index]) {
      this.fns[index] = null;
    }
  }
  exists(id) {
    const index = this.getInterceptorIndex(id);
    return Boolean(this.fns[index]);
  }
  getInterceptorIndex(id) {
    if (typeof id === "number") {
      return this.fns[id] ? id : -1;
    }
    return this.fns.indexOf(id);
  }
  update(id, fn) {
    const index = this.getInterceptorIndex(id);
    if (this.fns[index]) {
      this.fns[index] = fn;
      return id;
    }
    return false;
  }
  use(fn) {
    this.fns.push(fn);
    return this.fns.length - 1;
  }
}
var createInterceptors = () => ({
  error: new Interceptors,
  request: new Interceptors,
  response: new Interceptors
});
var defaultQuerySerializer = createQuerySerializer({
  allowReserved: false,
  array: {
    explode: true,
    style: "form"
  },
  object: {
    explode: true,
    style: "deepObject"
  }
});
var defaultHeaders = {
  "Content-Type": "application/json"
};
var createConfig = (override = {}) => ({
  ...jsonBodySerializer,
  headers: defaultHeaders,
  parseAs: "auto",
  querySerializer: defaultQuerySerializer,
  ...override
});

// packages/client/src/generated/client/client.gen.ts
var createClient = (config = {}) => {
  let _config = mergeConfigs(createConfig(), config);
  const getConfig = () => ({ ..._config });
  const setConfig = (config) => {
    _config = mergeConfigs(_config, config);
    return getConfig();
  };
  const interceptors = createInterceptors();
  const beforeRequest = async (options) => {
    const opts = {
      ..._config,
      ...options,
      fetch: options.fetch ?? _config.fetch ?? globalThis.fetch,
      headers: mergeHeaders(_config.headers, options.headers),
      serializedBody: undefined
    };
    if (opts.security) {
      await setAuthParams(opts);
    }
    if (opts.requestValidator) {
      await opts.requestValidator(opts);
    }
    if (opts.body !== undefined && opts.bodySerializer) {
      opts.serializedBody = opts.bodySerializer(opts.body);
    }
    if (opts.body === undefined || opts.serializedBody === "") {
      opts.headers.delete("Content-Type");
    }
    const resolvedOpts = opts;
    const url = buildUrl(resolvedOpts);
    return { opts: resolvedOpts, url };
  };
  const request = async (options) => {
    const throwOnError = options.throwOnError ?? _config.throwOnError;
    const responseStyle = options.responseStyle ?? _config.responseStyle;
    let request;
    let response;
    try {
      const { opts, url } = await beforeRequest(options);
      const requestInit = {
        redirect: "follow",
        ...opts,
        body: getValidRequestBody(opts)
      };
      request = new Request(url, requestInit);
      for (const fn of interceptors.request.fns) {
        if (fn) {
          request = await fn(request, opts);
        }
      }
      const _fetch = opts.fetch;
      response = await _fetch(request);
      for (const fn of interceptors.response.fns) {
        if (fn) {
          response = await fn(response, request, opts);
        }
      }
      const result = {
        request,
        response
      };
      if (response.ok) {
        const parseAs = (opts.parseAs === "auto" ? getParseAs(response.headers.get("Content-Type")) : opts.parseAs) ?? "json";
        if (response.status === 204 || response.headers.get("Content-Length") === "0") {
          let emptyData;
          switch (parseAs) {
            case "arrayBuffer":
            case "blob":
            case "text":
              emptyData = await response[parseAs]();
              break;
            case "formData":
              emptyData = new FormData;
              break;
            case "stream":
              emptyData = response.body;
              break;
            case "json":
            default:
              emptyData = {};
              break;
          }
          return opts.responseStyle === "data" ? emptyData : {
            data: emptyData,
            ...result
          };
        }
        let data;
        switch (parseAs) {
          case "arrayBuffer":
          case "blob":
          case "formData":
          case "text":
            data = await response[parseAs]();
            break;
          case "json": {
            const text = await response.text();
            data = text ? JSON.parse(text) : {};
            break;
          }
          case "stream":
            return opts.responseStyle === "data" ? response.body : {
              data: response.body,
              ...result
            };
        }
        if (parseAs === "json") {
          if (opts.responseValidator) {
            await opts.responseValidator(data);
          }
          if (opts.responseTransformer) {
            data = await opts.responseTransformer(data);
          }
        }
        return opts.responseStyle === "data" ? data : {
          data,
          ...result
        };
      }
      const textError = await response.text();
      let jsonError;
      try {
        jsonError = JSON.parse(textError);
      } catch {}
      throw jsonError ?? textError;
    } catch (error) {
      let finalError = error;
      for (const fn of interceptors.error.fns) {
        if (fn) {
          finalError = await fn(finalError, response, request, options);
        }
      }
      finalError = finalError || {};
      if (throwOnError) {
        throw finalError;
      }
      return responseStyle === "data" ? undefined : {
        error: finalError,
        request,
        response
      };
    }
  };
  const makeMethodFn = (method) => (options) => request({ ...options, method });
  const makeSseFn = (method) => async (options) => {
    const { opts, url } = await beforeRequest(options);
    return createSseClient({
      ...opts,
      body: opts.body,
      method,
      onRequest: async (url, init) => {
        let request = new Request(url, init);
        for (const fn of interceptors.request.fns) {
          if (fn) {
            request = await fn(request, opts);
          }
        }
        return request;
      },
      serializedBody: getValidRequestBody(opts),
      url
    });
  };
  const _buildUrl = (options) => buildUrl({ ..._config, ...options });
  return {
    buildUrl: _buildUrl,
    connect: makeMethodFn("CONNECT"),
    delete: makeMethodFn("DELETE"),
    get: makeMethodFn("GET"),
    getConfig,
    head: makeMethodFn("HEAD"),
    interceptors,
    options: makeMethodFn("OPTIONS"),
    patch: makeMethodFn("PATCH"),
    post: makeMethodFn("POST"),
    put: makeMethodFn("PUT"),
    request,
    setConfig,
    sse: {
      connect: makeSseFn("CONNECT"),
      delete: makeSseFn("DELETE"),
      get: makeSseFn("GET"),
      head: makeSseFn("HEAD"),
      options: makeSseFn("OPTIONS"),
      patch: makeSseFn("PATCH"),
      post: makeSseFn("POST"),
      put: makeSseFn("PUT"),
      trace: makeSseFn("TRACE")
    },
    trace: makeMethodFn("TRACE")
  };
};
// packages/client/src/generated/client.gen.ts
var client = createClient(createConfig({ baseUrl: "/" }));

// packages/client/src/generated/sdk.gen.ts
var catalogProductPolicyGet = (options) => (options?.client ?? client).get({ url: "/api/v1/catalog/product-policy", ...options });
var catalogToolsSearch = (options) => (options?.client ?? client).get({ url: "/api/v1/catalog/tools/search", ...options });
var catalogToolsGet = (options) => (options.client ?? client).get({ url: "/api/v1/catalog/tools/{tool}", ...options });
var creditsBalance = (options) => (options?.client ?? client).get({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/credits/balance",
  ...options
});
var filesUpload = (options) => (options.client ?? client).post({
  ...formDataBodySerializer,
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/files",
  ...options,
  headers: {
    "Content-Type": null,
    ...options.headers
  }
});
var filesImport = (options) => (options.client ?? client).post({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/files/import",
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...options.headers
  }
});
var filesUploadsCreate = (options) => (options.client ?? client).post({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/files/uploads",
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...options.headers
  }
});
var filesUploadsComplete = (options) => (options.client ?? client).post({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/files/uploads/{id}/complete",
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...options.headers
  }
});
var filesGet = (options) => (options.client ?? client).get({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/files/{id}",
  ...options
});
var runsCreate = (options) => (options.client ?? client).post({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/runs",
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...options.headers
  }
});
var runsQuote = (options) => (options.client ?? client).post({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/runs/quote",
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...options.headers
  }
});
var runsGet = (options) => (options.client ?? client).get({
  security: [{ name: "X-API-Key", type: "apiKey" }],
  url: "/api/v1/runs/{run_id}",
  ...options
});

// packages/client/src/refusal.ts
var KIND_BY_CODE = {
  insufficient_credits: "money",
  credits_in_debt: "money",
  api_key_spend_limit: "connection_limit",
  rate_limited: "rate_limit",
  validation_error: "schema",
  unprocessable_entity: "schema",
  malformed_body: "schema",
  bad_request: "schema",
  unauthorized: "revoked"
};

class ApiRefusal extends Error {
  kind;
  code;
  reason;
  status;
  details;
  retryAfterSeconds;
  constructor(input) {
    super(input.message);
    this.name = "ApiRefusal";
    this.kind = input.kind ?? KIND_BY_CODE[input.code] ?? "other";
    this.code = input.code;
    this.reason = input.reason ?? undefined;
    this.status = input.status;
    this.details = input.details;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
  get actionUrl() {
    return this.details?.action_url ?? undefined;
  }
}
function connectionRevoked(message) {
  return new ApiRefusal({
    kind: "revoked",
    code: "unauthorized",
    message,
    status: 401
  });
}
function isErrorResponse(body) {
  return typeof body === "object" && body !== null && typeof body.code === "string" && typeof body.message === "string";
}
function refusalFrom(body, response) {
  const retryAfter = Number(response.headers.get("Retry-After"));
  const retryAfterSeconds = response.headers.has("Retry-After") && Number.isFinite(retryAfter) ? retryAfter : undefined;
  if (isErrorResponse(body)) {
    return new ApiRefusal({
      code: body.code,
      message: body.message,
      status: response.status,
      reason: body.reason,
      details: body.details,
      retryAfterSeconds
    });
  }
  return new ApiRefusal({
    code: "unreadable_error",
    message: `HTTP ${response.status} without an error body`,
    status: response.status,
    retryAfterSeconds
  });
}

// packages/client/src/api.ts
var LONG_POLL_MAX_SECONDS = 25;
var QUICK_ANSWER_MS = 500;
var QUICK_ANSWER_PAUSE_MS = 1000;
async function unwrap(call) {
  const { data, error, response } = await call;
  if (!response)
    throw error instanceof Error ? error : new Error(String(error));
  if (!response.ok || data === undefined)
    throw refusalFrom(error, response);
  return data;
}
function refusalOfRun(run) {
  if (run.status !== "failed" && run.status !== "cancelled")
    return;
  const code = run.error_code ?? run.job?.error ?? `run_${run.status}`;
  return new ApiRefusal({
    code,
    message: `run ${run.id} ${run.status}: ${code}`,
    status: 200
  });
}
function resultFileId(run) {
  if (run.result?.kind === "file")
    return run.result.file_id;
  return run.status === "succeeded" ? run.output_file_id ?? undefined : undefined;
}
function createApi(settings) {
  const send = settings.fetch ?? ((request) => fetch(request));
  const now = settings.now ?? Date.now;
  const sleep = settings.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const authorized = async (input, init) => {
    const request = new Request(input, init);
    const retry = request.clone();
    const token = await settings.tokens.accessToken();
    request.headers.set("Authorization", `Bearer ${token}`);
    const response = await send(request);
    if (response.status !== 401)
      return response;
    const renewed = await settings.tokens.refresh(token);
    retry.headers.set("Authorization", `Bearer ${renewed.accessToken}`);
    return send(retry);
  };
  const client = createClient(createConfig({
    baseUrl: settings.config.apiBaseUrl,
    fetch: authorized
  }));
  const replayHeaders = (key) => ({
    "Idempotency-Key": key ?? crypto.randomUUID(),
    ...settings.installationId === undefined ? {} : { "X-Installation-Id": settings.installationId }
  });
  let directCeiling;
  const directMax = () => {
    if (settings.directUploadMaxBytes !== undefined) {
      return Promise.resolve(settings.directUploadMaxBytes);
    }
    if (directCeiling)
      return directCeiling;
    const pending = unwrap(catalogProductPolicyGet({ client })).then((policy) => policy.request_body_max_bytes);
    directCeiling = pending;
    pending.catch(() => {
      if (directCeiling === pending)
        directCeiling = undefined;
    });
    return pending;
  };
  const put = async (target, body) => {
    const response = await send(new Request(target.url, { method: "PUT", headers: target.headers, body }));
    if (!response.ok) {
      throw new ApiRefusal({
        code: "upload_not_landed",
        message: `object storage refused the bytes: HTTP ${response.status}`,
        status: response.status
      });
    }
    return response.headers.get("ETag");
  };
  const uploadStaged = async (input) => {
    const opened = await unwrap(filesUploadsCreate({
      client,
      headers: replayHeaders(),
      body: {
        name: input.name,
        content_type: input.contentType || input.data.type || "application/octet-stream",
        size_bytes: input.data.size
      }
    }));
    const parts = [];
    if (opened.transfer.kind === "single") {
      await put(opened.transfer.put, input.data);
    } else {
      for (const part of opened.transfer.parts) {
        const slice = input.data.slice(part.offset, part.offset + part.size_bytes);
        const etag = await put(part.put, slice);
        if (!etag) {
          throw new ApiRefusal({
            code: "upload_not_landed",
            message: "object storage did not show the ETag of an uploaded part",
            status: 200
          });
        }
        parts.push({ part_number: part.part_number, etag });
      }
    }
    return unwrap(filesUploadsComplete({
      client,
      headers: replayHeaders(),
      path: { id: opened.upload_id },
      body: { parts }
    }));
  };
  const uploadDirect = (input) => unwrap(filesUpload({
    client,
    headers: replayHeaders(),
    body: {
      file: new File([input.data], input.name, {
        type: input.contentType || input.data.type
      })
    }
  }));
  const readRun = (runId, waitSeconds) => unwrap(runsGet({
    client,
    path: { run_id: runId },
    query: waitSeconds === undefined ? undefined : { wait: waitSeconds }
  }));
  const startRun = (body, options) => unwrap(runsCreate({
    client,
    headers: {
      ...replayHeaders(options?.idempotencyKey),
      "X-Max-Credits": options?.maxCredits
    },
    body
  }));
  const waitForRun = async (runId, ceilingMs, started) => {
    const deadline = now() + ceilingMs;
    let run = started;
    try {
      run ??= await readRun(runId);
      while (run.status === "running") {
        const leftSeconds = Math.floor((deadline - now()) / 1000);
        if (leftSeconds < 1)
          break;
        const asked = now();
        run = await readRun(runId, Math.min(LONG_POLL_MAX_SECONDS, leftSeconds));
        if (run.status === "running" && now() - asked < QUICK_ANSWER_MS) {
          await sleep(QUICK_ANSWER_PAUSE_MS);
        }
      }
    } catch (error) {
      if (error instanceof ApiRefusal && error.kind === "revoked")
        throw error;
      return { state: "pending", runId, run };
    }
    return run.status === "running" ? { state: "pending", runId, run } : { state: "finished", run };
  };
  return {
    async uploadFile(input) {
      if (input.data.size > await directMax())
        return uploadStaged(input);
      try {
        return await uploadDirect(input);
      } catch (error) {
        if (error instanceof ApiRefusal && error.reason === "body_too_large") {
          return uploadStaged(input);
        }
        throw error;
      }
    },
    importFile: (input, options) => unwrap(filesImport({
      client,
      headers: replayHeaders(options?.idempotencyKey),
      body: {
        url: input.url,
        name: input.name,
        content_type: input.contentType
      }
    })),
    startRun,
    readRun,
    waitForRun,
    async runTool(body, options) {
      const run = await startRun(body, options);
      if (run.status !== "running")
        return { state: "finished", run };
      return waitForRun(run.id, options.ceilingMs, run);
    },
    balance: () => unwrap(creditsBalance({ client })),
    quote: (body) => unwrap(runsQuote({ client, body })),
    searchTools: async (filter) => (await unwrap(catalogToolsSearch({ client, query: filter }))).tools,
    searchToolsPage: async (filter) => {
      const page = await unwrap(catalogToolsSearch({ client, query: filter }));
      return { tools: page.tools, nextCursor: page.next_cursor ?? undefined };
    },
    describeTool: (tool, locale) => unwrap(catalogToolsGet({
      client,
      path: { tool },
      query: locale === undefined ? undefined : { lang: catalogLanguage(locale) }
    })),
    fileRequest: async (fileId) => {
      let url = "";
      await filesGet({
        client,
        path: { id: fileId },
        fetch: async (request) => {
          url = request.url;
          return new Response(null);
        }
      });
      const token = await settings.tokens.accessToken();
      return { url, headers: { Authorization: `Bearer ${token}` } };
    },
    downloadFile: async (fileId) => {
      const { data, error, response } = await filesGet({
        client,
        path: { id: fileId },
        parseAs: "blob"
      });
      if (!response) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      if (!response.ok)
        throw refusalFrom(error, response);
      return {
        data,
        name: fileNameOf(response.headers.get("Content-Disposition")),
        contentType: response.headers.get("Content-Type") ?? "application/octet-stream"
      };
    }
  };
}
// packages/client/src/config.ts
var LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
function defineChannelConfig(input) {
  let url;
  try {
    url = new URL(input.apiBaseUrl);
  } catch {
    throw new Error(`apiBaseUrl is not a URL: ${input.apiBaseUrl}`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`apiBaseUrl must be https outside the local stand: ${input.apiBaseUrl}`);
  }
  if (/[?#]/.test(input.apiBaseUrl)) {
    throw new Error(`apiBaseUrl must carry no query or fragment: ${input.apiBaseUrl}`);
  }
  if (input.oauthClientId === "" || /\s/.test(input.oauthClientId)) {
    throw new Error(`oauthClientId is empty or carries whitespace: ${JSON.stringify(input.oauthClientId)}`);
  }
  return {
    apiBaseUrl: (url.origin + url.pathname).replace(/\/+$/, ""),
    oauthClientId: input.oauthClientId
  };
}
// packages/client/src/fields.ts
var typeOf = (schema) => [schema.type].flat().find((type) => type !== undefined && type !== "null");
function resolved(schema, defs) {
  if (schema.$ref !== undefined) {
    const target = defs[schema.$ref.split("/").pop() ?? ""];
    return target === undefined ? {} : resolved(target, defs);
  }
  if (schema.allOf !== undefined) {
    const parts = schema.allOf.map((part) => resolved(part, defs));
    return Object.assign({}, ...parts, schema, { allOf: undefined });
  }
  const options = (schema.oneOf ?? schema.anyOf)?.filter((option) => option.type !== "null");
  return options?.length === 1 && options[0] !== undefined ? resolved(options[0], defs) : schema;
}
function shapeOf(schema, defs) {
  if (schema.$ref !== undefined) {
    const target = defs[schema.$ref.split("/").pop() ?? ""];
    return target === undefined ? { properties: {}, required: [] } : shapeOf(target, defs);
  }
  const shape = {
    properties: { ...schema.properties },
    required: [...schema.required ?? []]
  };
  for (const part of schema.allOf ?? []) {
    const joined = shapeOf(part, defs);
    Object.assign(shape.properties, joined.properties);
    shape.required.push(...joined.required);
  }
  const modes = (schema.oneOf ?? schema.anyOf)?.map((mode) => shapeOf(mode, defs));
  if (modes === undefined || modes.length === 0)
    return shape;
  for (const mode of modes) {
    for (const [name, property] of Object.entries(mode.properties)) {
      const value = resolved(property, defs);
      const known = shape.properties[name];
      shape.properties[name] = known?.enum !== undefined && value.enum !== undefined ? { ...known, enum: [...new Set([...known.enum, ...value.enum])] } : known ?? value;
    }
  }
  shape.required.push(...(modes[0]?.required ?? []).filter((name) => modes.every((mode) => mode.required.includes(name))));
  return shape;
}
var isFileId = (schema) => typeOf(schema) === "string" && schema.format === "uuid";
function kindOf(schema, defs) {
  if (schema.enum !== undefined)
    return "choice";
  if (isFileId(schema))
    return "file";
  switch (typeOf(schema)) {
    case "string":
      return "text";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return isFileId(resolved(schema.items ?? {}, defs)) ? "files" : "json";
    default:
      return "json";
  }
}
function fieldsOf(description) {
  const schema = description.request_schema;
  const defs = schema.$defs ?? {};
  const shape = shapeOf(schema, defs);
  const required = new Set(shape.required);
  return Object.entries(shape.properties).filter(([name]) => name !== "tool").map(([name, property]) => {
    const value = resolved(property, defs);
    const kind = kindOf(value, defs);
    return {
      name,
      kind,
      required: required.has(name),
      help: property.description ?? value.description,
      choices: kind === "choice" ? value.enum?.map(String) : undefined
    };
  });
}
var blank = (value) => value === undefined || value === null || value === "";
function typed(kind, value) {
  if (kind === "files") {
    const list = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
    return list.map(String).filter((id) => id !== "");
  }
  if (typeof value !== "string")
    return value;
  if (kind === "integer" || kind === "number") {
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
  }
  if (kind === "boolean") {
    return value === "true" ? true : value === "false" ? false : value;
  }
  if (kind === "json") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
function bodyOf(tool, fields, values) {
  const body = { tool };
  for (const field of fields) {
    const value = values[field.name];
    if (!blank(value))
      body[field.name] = typed(field.kind, value);
  }
  return body;
}
// packages/client/src/generated/messages.ts
var messages = {
  en: {
    "channel-sign-in": "Sign in to { $appName }",
    "channel-sign-out": "Sign out",
    "channel-tool-choose": "Choose a tool",
    "channel-file-label": "File",
    "channel-run": "Run",
    "channel-done": "Done: open the result",
    "channel-credits-short": "You don't have enough credits for this run",
    "channel-credits-short-buy": "You don't have enough credits for this run. Buy credits on the { $appName } website and try again",
    "channel-credits-buy": "Buy credits",
    "channel-connection-revoked": "This connection has been revoked. Sign in again to keep using { $appName }",
    "channel-scope-read": "See your balance, your runs and the files in your account",
    "channel-scope-write": "Upload files, run tools and spend your account's credits",
    "channel-api-key-label": "API key",
    "channel-api-key-help": "Create a key under API keys and MCP in your { $appName } account and paste it here. The key is stored encrypted and is not shown again",
    "channel-save": "Save",
    "channel-balance-label": "Credits",
    "channel-connected": "Connected",
    "channel-not-connected": "Not connected",
    "channel-external-service-notice": "This plugin sends the images you choose and your API key to the { $appName } service, which processes the images on its server",
    "channel-optimize-saved": "Saved",
    "channel-optimize-restore": "Restore original",
    "channel-optimize-now": "Optimize",
    "channel-optimize-pending": "Queued",
    "channel-optimize-failed": "Failed",
    "channel-optimize-paused": "Queue stopped",
    "channel-optimize-all": "Optimize entire media library",
    "channel-optimize-estimate": "Estimated cost",
    "channel-optimize-saved-total": "Total saved",
    "channel-optimize-quality": "Quality",
    "channel-optimize-sizes": "Image sizes to optimize",
    "channel-optimize-size-full": "Full size",
    "channel-optimize-exclude": "Skip files whose name contains",
    "channel-tool-search": "Search tools",
    "channel-run-running": "The run is still in progress",
    "channel-run-check": "Check again",
    "channel-file-too-large": "This file is too large to send from here. Open the { $appName } website and upload it there",
    "channel-file-allow": "Allow { $appName } to open this file",
    "channel-result-saved": "The result was saved in the same folder as the file",
    "channel-add-to-design": "Add to design",
    "channel-added-to-uploads": "Added to your uploads",
    "channel-select-image": "Select an image in your design",
    "channel-listing-zapier-description": "{ $appName } is a set of online file tools that convert documents and images, read text from scans and build PDFs",
    "channel-listing-make-description": "Run { $appName } online file tools in your scenarios: convert documents and images, read text from scans and build PDFs. Runs are paid with your account's credits",
    "channel-listing-n8n-description": "Convert documents and images, read text from scans and build PDFs with { $appName } in your workflows",
    "channel-listing-n8n-readme": "This node runs { $appName } online file tools as a workflow step. Sign in with your { $appName } account: each run is paid with the account's credits, and nothing is sold inside the node",
    "channel-listing-extension-name": "{ $appName }: convert and compress files",
    "channel-listing-extension-short": "Send an image, a PDF or a link from any page to a file tool: convert it, compress it or read its text",
    "channel-listing-extension-full": "{ $appName } puts its online file tools one click away. Right-click an image, a PDF or a link on any page, choose a tool and get the result file back: convert it to another format, compress it or read the text of a scan. Sign in with your { $appName } account; each run is paid with the account's credits, and nothing is sold inside the extension",
    "channel-listing-extension-screenshot-1": "Send an image from the page to a tool",
    "channel-listing-extension-screenshot-2": "Download the result when it is ready",
    "channel-listing-wordpress-name": "{ $appName }: image compression and conversion",
    "channel-listing-wordpress-short": "Compress and convert images in your media library on the { $appName } server instead of on your own site",
    "channel-listing-wordpress-full": "The plugin sends the images you choose in the media library to { $appName } and saves smaller files, or files in a new format such as WebP, back to the library. Connect the plugin to your { $appName } account in its settings; each image is paid for with the account's credits, and nothing is sold inside the plugin",
    "channel-listing-wordpress-screenshot-1": "Choosing images in the media library",
    "channel-listing-wordpress-screenshot-2": "Connecting the plugin to your account",
    "channel-listing-drive-name": "{ $appName }: file converter",
    "channel-listing-drive-short": "Convert the selected file to another format and save the result next to it, in the same folder",
    "channel-listing-drive-full": "Select a file, choose a tool and get the result in the same folder: convert documents, images and PDFs to another format, compress them or read the text of a scan. Sign in with your { $appName } account; each run is paid with the account's credits, and nothing is sold inside the add-on",
    "channel-listing-drive-screenshot-1": "Choose a tool for the selected file",
    "channel-listing-drive-screenshot-2": "The result appears in the same folder",
    "channel-listing-canva-short": "Turn files that will not import into images, and convert your designs to formats the editor does not export",
    "channel-listing-canva-full": "Turn a file that will not import, such as a scan or a text document, into an image you can place in your design, and convert a finished design to a format the editor does not export. Sign in with your { $appName } account; each run is paid with the account's credits, and nothing is sold inside the app",
    "channel-listing-canva-screenshot-1": "Turn a file into an image for your design",
    "channel-listing-canva-screenshot-2": "Convert your design to another format",
    "channel-run-price": {
      on: "credits",
      variants: {
        one: "This run costs { $credits } credit",
        other: "This run costs { $credits } credits"
      },
      other: "other"
    },
    "channel-run-price-range": {
      on: "maxCredits",
      variants: {
        one: "This run costs { $minCredits } to { $maxCredits } credit",
        other: "This run costs { $minCredits } to { $maxCredits } credits"
      },
      other: "other"
    },
    "channel-run-balance-after": {
      on: "credits",
      variants: {
        one: "{ $credits } credit left after this run",
        other: "{ $credits } credits left after this run"
      },
      other: "other"
    },
    "channel-run-balance-after-least": {
      on: "credits",
      variants: {
        one: "At least { $credits } credit left after this run",
        other: "At least { $credits } credits left after this run"
      },
      other: "other"
    },
    "channel-credits-short-by": {
      on: "credits",
      variants: {
        one: "You need { $credits } more credit for this run. Buy credits on the { $appName } website and try again",
        other: "You need { $credits } more credits for this run. Buy credits on the { $appName } website and try again"
      },
      other: "other"
    },
    "channel-large-result": {
      on: "minutes",
      variants: {
        one: "A result larger than { $largeSize } is deleted { $minutes } minute after its first download",
        other: "A result larger than { $largeSize } is deleted { $minutes } minutes after its first download"
      },
      other: "other"
    }
  },
  es: {
    "channel-sign-in": "Iniciar sesión en { $appName }",
    "channel-sign-out": "Cerrar sesión",
    "channel-tool-choose": "Elige una herramienta",
    "channel-file-label": "Archivo",
    "channel-run": "Ejecutar",
    "channel-done": "Listo: abrir el resultado",
    "channel-credits-short": "No tienes suficientes créditos para esta ejecución",
    "channel-credits-short-buy": "No tienes suficientes créditos para esta ejecución. Compra créditos en el sitio de { $appName } y vuelve a intentarlo",
    "channel-credits-buy": "Comprar créditos",
    "channel-connection-revoked": "Esta conexión se revocó. Vuelve a iniciar sesión para seguir usando { $appName }",
    "channel-scope-read": "Ver tu saldo, tus ejecuciones y los archivos de tu cuenta",
    "channel-scope-write": "Subir archivos, ejecutar herramientas y gastar los créditos de tu cuenta",
    "channel-api-key-label": "Clave de API",
    "channel-api-key-help": "Crea una clave en la sección «Claves de API y MCP» de tu cuenta de { $appName } y pégala aquí. La clave se guarda cifrada y no se vuelve a mostrar",
    "channel-save": "Guardar",
    "channel-balance-label": "Créditos",
    "channel-connected": "Conectado",
    "channel-not-connected": "No conectado",
    "channel-external-service-notice": "Este plugin envía las imágenes que elijas y tu clave de API al servicio { $appName }, que procesa las imágenes en su servidor",
    "channel-optimize-saved": "Ahorrado",
    "channel-optimize-restore": "Restaurar el original",
    "channel-optimize-now": "Optimizar",
    "channel-optimize-pending": "En cola",
    "channel-optimize-failed": "Error",
    "channel-optimize-paused": "Cola detenida",
    "channel-optimize-all": "Optimizar toda la biblioteca de medios",
    "channel-optimize-estimate": "Costo estimado",
    "channel-optimize-saved-total": "Ahorrado en total",
    "channel-optimize-quality": "Calidad",
    "channel-optimize-sizes": "Tamaños de imagen que se van a optimizar",
    "channel-optimize-size-full": "Tamaño completo",
    "channel-optimize-exclude": "Omitir archivos cuyo nombre contenga",
    "channel-tool-search": "Buscar herramientas",
    "channel-run-running": "La ejecución sigue en curso",
    "channel-run-check": "Comprobar de nuevo",
    "channel-file-too-large": "Este archivo es demasiado grande para enviarlo desde aquí. Abre el sitio web de { $appName } y súbelo allí",
    "channel-file-allow": "Permitir que { $appName } abra este archivo",
    "channel-result-saved": "El resultado se guardó en la misma carpeta que el archivo",
    "channel-add-to-design": "Añadir al diseño",
    "channel-added-to-uploads": "Se añadió a tus archivos subidos",
    "channel-select-image": "Selecciona una imagen de tu diseño",
    "channel-listing-zapier-description": "{ $appName } es un conjunto de herramientas en línea que convierte documentos e imágenes, lee el texto de escaneos y crea PDF",
    "channel-listing-make-description": "Ejecuta las herramientas de archivos en línea de { $appName } en tus escenarios: convierte documentos e imágenes, lee el texto de escaneos y crea PDF. Las ejecuciones se pagan con los créditos de tu cuenta",
    "channel-listing-extension-name": "{ $appName }: convertir y comprimir archivos",
    "channel-listing-extension-short": "Envía una imagen, un PDF o un enlace de cualquier página a una herramienta: cambia el formato, comprímelo o lee su texto",
    "channel-listing-extension-full": "{ $appName } pone sus herramientas de archivos en línea a un clic. Haz clic derecho en una imagen, un PDF o un enlace de cualquier página, elige una herramienta y recibe el archivo del resultado: cambia el formato, comprime el archivo o lee el texto de un escaneo. Inicia sesión con tu cuenta de { $appName }: cada ejecución se paga con los créditos de la cuenta, y dentro de la extensión no se vende nada",
    "channel-listing-extension-screenshot-1": "Envía una imagen de la página a una herramienta",
    "channel-listing-extension-screenshot-2": "Descarga el resultado cuando esté listo",
    "channel-listing-wordpress-name": "{ $appName }: compresión y conversión de imágenes",
    "channel-listing-wordpress-short": "Comprime y convierte las imágenes de tu biblioteca de medios en el servidor de { $appName }, no en tu sitio",
    "channel-listing-wordpress-full": "El plugin envía a { $appName } las imágenes que eliges en la biblioteca de medios y guarda en ella archivos más pequeños o en un formato nuevo, como WebP. Conecta el plugin a tu cuenta de { $appName } en sus ajustes: cada imagen se paga con los créditos de la cuenta, y dentro del plugin no se vende nada",
    "channel-listing-wordpress-screenshot-1": "Elegir imágenes en la biblioteca de medios",
    "channel-listing-wordpress-screenshot-2": "Conectar el plugin a tu cuenta",
    "channel-listing-drive-name": "{ $appName }: conversor de archivos",
    "channel-listing-drive-short": "Convierte el archivo seleccionado a otro formato y guarda el resultado junto a él, en la misma carpeta",
    "channel-listing-drive-full": "Selecciona un archivo, elige una herramienta y recibe el resultado en la misma carpeta: cambia el formato de documentos, imágenes y PDF, comprímelos o lee el texto de un escaneo. Inicia sesión con tu cuenta de { $appName }: cada ejecución se paga con los créditos de la cuenta, y dentro del complemento no se vende nada",
    "channel-listing-drive-screenshot-1": "Elige una herramienta para el archivo seleccionado",
    "channel-listing-drive-screenshot-2": "El resultado aparece en la misma carpeta",
    "channel-listing-canva-short": "Convierte en imágenes los archivos que no se pueden importar y lleva tus diseños a formatos que el editor no exporta",
    "channel-listing-canva-full": "Convierte un archivo que no se puede importar, como un escaneo o un documento de texto, en una imagen para tu diseño, y lleva un diseño terminado a un formato que el editor no exporta. Inicia sesión con tu cuenta de { $appName }: cada ejecución se paga con los créditos de la cuenta, y dentro de la aplicación no se vende nada",
    "channel-listing-canva-screenshot-1": "Convierte un archivo en una imagen para tu diseño",
    "channel-listing-canva-screenshot-2": "Convierte tu diseño a otro formato",
    "channel-run-price": {
      on: "credits",
      variants: {
        one: "Esta ejecución cuesta { $credits } crédito",
        many: "Esta ejecución cuesta { $credits } de créditos",
        other: "Esta ejecución cuesta { $credits } créditos"
      },
      other: "other"
    },
    "channel-run-price-range": {
      on: "maxCredits",
      variants: {
        one: "Esta ejecución cuesta de { $minCredits } a { $maxCredits } crédito",
        many: "Esta ejecución cuesta de { $minCredits } a { $maxCredits } de créditos",
        other: "Esta ejecución cuesta de { $minCredits } a { $maxCredits } créditos"
      },
      other: "other"
    },
    "channel-run-balance-after": {
      on: "credits",
      variants: {
        one: "Después de esta ejecución te quedará { $credits } crédito",
        many: "Después de esta ejecución te quedarán { $credits } de créditos",
        other: "Después de esta ejecución te quedarán { $credits } créditos"
      },
      other: "other"
    },
    "channel-run-balance-after-least": {
      on: "credits",
      variants: {
        one: "Después de esta ejecución te quedará al menos { $credits } crédito",
        many: "Después de esta ejecución te quedarán al menos { $credits } de créditos",
        other: "Después de esta ejecución te quedarán al menos { $credits } créditos"
      },
      other: "other"
    },
    "channel-credits-short-by": {
      on: "credits",
      variants: {
        one: "Te falta { $credits } crédito para esta ejecución. Compra créditos en el sitio de { $appName } y vuelve a intentarlo",
        many: "Te faltan { $credits } de créditos para esta ejecución. Compra créditos en el sitio de { $appName } y vuelve a intentarlo",
        other: "Te faltan { $credits } créditos para esta ejecución. Compra créditos en el sitio de { $appName } y vuelve a intentarlo"
      },
      other: "other"
    },
    "channel-large-result": {
      on: "minutes",
      variants: {
        one: "Un resultado de más de { $largeSize } se elimina { $minutes } minuto después de su primera descarga",
        many: "Un resultado de más de { $largeSize } se elimina { $minutes } de minutos después de su primera descarga",
        other: "Un resultado de más de { $largeSize } se elimina { $minutes } minutos después de su primera descarga"
      },
      other: "other"
    }
  },
  ru: {
    "channel-sign-in": "Войти в { $appName }",
    "channel-sign-out": "Выйти",
    "channel-tool-choose": "Выберите инструмент",
    "channel-file-label": "Файл",
    "channel-run": "Запустить",
    "channel-done": "Готово — открыть результат",
    "channel-credits-short": "На этот запуск не хватает кредитов",
    "channel-credits-short-buy": "На этот запуск не хватает кредитов. Купите кредиты на сайте { $appName } и попробуйте ещё раз",
    "channel-credits-buy": "Купить кредиты",
    "channel-connection-revoked": "Это подключение отозвано. Войдите снова, чтобы продолжить пользоваться { $appName }",
    "channel-scope-read": "Видеть баланс, запуски и файлы в вашем аккаунте",
    "channel-scope-write": "Загружать файлы, запускать инструменты и тратить кредиты вашего аккаунта",
    "channel-api-key-label": "API-ключ",
    "channel-api-key-help": "Создайте ключ в разделе «API-ключи и MCP» аккаунта { $appName } и вставьте его сюда. Ключ хранится в зашифрованном виде и больше не показывается",
    "channel-save": "Сохранить",
    "channel-balance-label": "Кредиты",
    "channel-connected": "Подключено",
    "channel-not-connected": "Не подключено",
    "channel-external-service-notice": "Плагин отправляет выбранные вами изображения и ваш API-ключ в сервис { $appName }, который обрабатывает изображения на своём сервере",
    "channel-optimize-saved": "Сэкономлено",
    "channel-optimize-restore": "Вернуть исходный файл",
    "channel-optimize-now": "Оптимизировать",
    "channel-optimize-pending": "В очереди",
    "channel-optimize-failed": "Не выполнено",
    "channel-optimize-paused": "Очередь остановлена",
    "channel-optimize-all": "Оптимизировать всю медиатеку",
    "channel-optimize-estimate": "Примерная стоимость",
    "channel-optimize-saved-total": "Всего сэкономлено",
    "channel-optimize-quality": "Качество",
    "channel-optimize-sizes": "Какие размеры изображений оптимизировать",
    "channel-optimize-size-full": "Полный размер",
    "channel-optimize-exclude": "Пропускать файлы, в имени которых есть",
    "channel-tool-search": "Поиск инструментов",
    "channel-run-running": "Запуск ещё не завершён",
    "channel-run-check": "Проверить ещё раз",
    "channel-file-too-large": "Этот файл слишком большой, чтобы отправить его отсюда. Откройте сайт { $appName } и загрузите его там",
    "channel-file-allow": "Разрешить { $appName } открыть этот файл",
    "channel-result-saved": "Результат сохранён в той же папке, что и файл",
    "channel-add-to-design": "Добавить в дизайн",
    "channel-added-to-uploads": "Добавлено в «Загрузки»",
    "channel-select-image": "Выберите изображение в дизайне",
    "channel-listing-zapier-description": "{ $appName } — набор онлайн-инструментов для файлов: конвертирует документы и изображения, распознаёт текст на сканах и собирает PDF",
    "channel-listing-make-description": "Запускайте онлайн-инструменты { $appName } в своих сценариях: конвертируйте документы и изображения, распознавайте текст на сканах и собирайте PDF. Запуски оплачиваются кредитами вашего аккаунта",
    "channel-listing-extension-name": "{ $appName }: конвертация и сжатие файлов",
    "channel-listing-extension-short": "Отправьте изображение, PDF или ссылку с любой страницы в инструмент, чтобы конвертировать файл, сжать его или распознать текст",
    "channel-listing-extension-full": "{ $appName } открывает онлайн-инструменты для файлов в один клик. Щёлкните правой кнопкой по изображению, PDF или ссылке на любой странице, выберите инструмент — конвертацию в другой формат, сжатие или распознавание текста скана — и получите файл результата. Войдите в свой аккаунт { $appName }: каждый запуск оплачивается кредитами аккаунта, а внутри расширения ничего не продаётся",
    "channel-listing-extension-screenshot-1": "Отправьте изображение со страницы в инструмент",
    "channel-listing-extension-screenshot-2": "Скачайте результат, когда он будет готов",
    "channel-listing-wordpress-name": "{ $appName }: сжатие и конвертация изображений",
    "channel-listing-wordpress-short": "Сжимайте и конвертируйте изображения медиатеки на сервере { $appName }, а не на вашем сайте",
    "channel-listing-wordpress-full": "Плагин отправляет выбранные в медиатеке изображения в { $appName } и сохраняет обратно в медиатеку файлы меньшего размера или в новом формате, например WebP. В настройках плагина подключите его к аккаунту { $appName }: каждое изображение оплачивается кредитами аккаунта, а внутри плагина ничего не продаётся",
    "channel-listing-wordpress-screenshot-1": "Выбор изображений в медиатеке",
    "channel-listing-wordpress-screenshot-2": "Подключение плагина к аккаунту",
    "channel-listing-drive-name": "{ $appName }: конвертер файлов",
    "channel-listing-drive-short": "Конвертируйте выбранный файл в другой формат и сохраняйте результат рядом с ним, в той же папке",
    "channel-listing-drive-full": "Выберите файл, затем инструмент, и результат появится в той же папке: конвертируйте документы, изображения и PDF в другой формат, сжимайте их или распознавайте текст скана. Войдите в свой аккаунт { $appName }: каждый запуск оплачивается кредитами аккаунта, а внутри дополнения ничего не продаётся",
    "channel-listing-drive-screenshot-1": "Выберите инструмент для выбранного файла",
    "channel-listing-drive-screenshot-2": "Результат появляется в той же папке",
    "channel-listing-canva-short": "Превращайте в изображения файлы, которые не импортируются, а дизайны конвертируйте в форматы, недоступные при экспорте из редактора",
    "channel-listing-canva-full": "Превратите в изображение для дизайна файл, который не импортируется, например скан или текстовый документ, а готовый дизайн конвертируйте в формат, недоступный при экспорте из редактора. Войдите в свой аккаунт { $appName }: каждый запуск оплачивается кредитами аккаунта, а внутри приложения ничего не продаётся",
    "channel-listing-canva-screenshot-1": "Превратите файл в изображение для дизайна",
    "channel-listing-canva-screenshot-2": "Конвертируйте дизайн в другой формат",
    "channel-run-price": {
      on: "credits",
      variants: {
        one: "Этот запуск стоит { $credits } кредит",
        few: "Этот запуск стоит { $credits } кредита",
        many: "Этот запуск стоит { $credits } кредитов",
        other: "Этот запуск стоит { $credits } кредита"
      },
      other: "other"
    },
    "channel-run-price-range": {
      on: "maxCredits",
      variants: {
        one: "Этот запуск стоит от { $minCredits } до { $maxCredits } кредита",
        few: "Этот запуск стоит от { $minCredits } до { $maxCredits } кредитов",
        many: "Этот запуск стоит от { $minCredits } до { $maxCredits } кредитов",
        other: "Этот запуск стоит от { $minCredits } до { $maxCredits } кредита"
      },
      other: "other"
    },
    "channel-run-balance-after": {
      on: "credits",
      variants: {
        one: "После этого запуска останется { $credits } кредит",
        few: "После этого запуска останется { $credits } кредита",
        many: "После этого запуска останется { $credits } кредитов",
        other: "После этого запуска останется { $credits } кредита"
      },
      other: "other"
    },
    "channel-run-balance-after-least": {
      on: "credits",
      variants: {
        one: "После этого запуска останется не меньше { $credits } кредита",
        few: "После этого запуска останется не меньше { $credits } кредитов",
        many: "После этого запуска останется не меньше { $credits } кредитов",
        other: "После этого запуска останется не меньше { $credits } кредита"
      },
      other: "other"
    },
    "channel-credits-short-by": {
      on: "credits",
      variants: {
        one: "На этот запуск не хватает { $credits } кредита. Купите кредиты на сайте { $appName } и попробуйте ещё раз",
        few: "На этот запуск не хватает { $credits } кредитов. Купите кредиты на сайте { $appName } и попробуйте ещё раз",
        many: "На этот запуск не хватает { $credits } кредитов. Купите кредиты на сайте { $appName } и попробуйте ещё раз",
        other: "На этот запуск не хватает { $credits } кредита. Купите кредиты на сайте { $appName } и попробуйте ещё раз"
      },
      other: "other"
    },
    "channel-large-result": {
      on: "minutes",
      variants: {
        one: "Результат больше { $largeSize } удаляется через { $minutes } минуту после первого скачивания",
        few: "Результат больше { $largeSize } удаляется через { $minutes } минуты после первого скачивания",
        many: "Результат больше { $largeSize } удаляется через { $minutes } минут после первого скачивания",
        other: "Результат больше { $largeSize } удаляется через { $minutes } минуты после первого скачивания"
      },
      other: "other"
    }
  }
};

// packages/client/src/messages.ts
var APP_NAME = "FileMulti";
var dictionaries = messages;
function text(locale, key, args) {
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? "en";
  const own = dictionaries[language]?.[key];
  const [pattern, counted] = own === undefined ? [messages.en[key], "en"] : [own, language];
  return formatPattern(fillAppName(pattern, APP_NAME), counted, args);
}
function locales() {
  return Object.keys(messages);
}
// packages/client/src/oauth.ts
var METADATA_PATH = "/.well-known/oauth-authorization-server";
var EXPIRY_MARGIN_MS = 30000;
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes)
    binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}
async function s256(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}
function send(fetchLike, request) {
  return (fetchLike ?? ((r) => fetch(r)))(request);
}
async function discoverAuthorizationServer(issuer, fetchLike) {
  const url = new URL(METADATA_PATH, issuer).href;
  const response = await send(fetchLike, new Request(url));
  if (!response.ok) {
    throw new Error(`authorization server metadata: HTTP ${response.status} at ${url}`);
  }
  const meta = await response.json();
  const { authorization_endpoint, token_endpoint, revocation_endpoint } = meta;
  if (typeof authorization_endpoint !== "string" || typeof token_endpoint !== "string") {
    throw new Error(`authorization server metadata at ${url} names no endpoints`);
  }
  return {
    authorizationEndpoint: authorization_endpoint,
    tokenEndpoint: token_endpoint,
    revocationEndpoint: typeof revocation_endpoint === "string" ? revocation_endpoint : undefined
  };
}
async function beginAuthorization(settings, scopes) {
  const state = randomToken();
  const codeVerifier = randomToken();
  const url = new URL(settings.server.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    scope: scopes.join(" "),
    state,
    code_challenge: await s256(codeVerifier),
    code_challenge_method: "S256",
    resource: settings.resource
  }).toString();
  return { url: url.href, state, codeVerifier };
}
async function tokenRequest(settings, form, previous) {
  const response = await send(settings.fetch, new Request(settings.server.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      ...form,
      client_id: settings.clientId,
      resource: settings.resource
    }).toString()
  }));
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof answer.error === "string" ? answer.error : "token_request_failed";
    const message = typeof answer.error_description === "string" ? answer.error_description : `token endpoint: HTTP ${response.status}`;
    if (code === "invalid_grant")
      throw connectionRevoked(message);
    throw new ApiRefusal({ code, message, status: response.status });
  }
  if (typeof answer.access_token !== "string") {
    throw new ApiRefusal({
      code: "token_request_failed",
      message: "token endpoint answered without an access token",
      status: response.status
    });
  }
  const lifetime = typeof answer.expires_in === "number" ? answer.expires_in : undefined;
  return {
    accessToken: answer.access_token,
    refreshToken: typeof answer.refresh_token === "string" ? answer.refresh_token : previous?.refreshToken,
    expiresAtEpochMs: lifetime === undefined ? undefined : (settings.now ?? Date.now)() + lifetime * 1000,
    scope: typeof answer.scope === "string" ? answer.scope : previous?.scope
  };
}
async function completeAuthorization(settings, request, returned, deviceToken) {
  if (returned.state !== request.state) {
    throw new ApiRefusal({
      code: "state_mismatch",
      message: "the redirect does not belong to this sign-in",
      status: 400
    });
  }
  if (returned.error || !returned.code) {
    throw new ApiRefusal({
      code: returned.error || "authorization_failed",
      message: "the sign-in was not approved",
      status: 400
    });
  }
  const form = {
    grant_type: "authorization_code",
    code: returned.code,
    redirect_uri: settings.redirectUri,
    code_verifier: request.codeVerifier
  };
  if (deviceToken === undefined)
    return tokenRequest(settings, form, undefined);
  return tokenRequest(settings, { ...form, device_token: deviceToken }, undefined).catch((refusal) => {
    if (!(refusal instanceof ApiRefusal) || refusal.code !== "invalid_request") {
      throw refusal;
    }
    return tokenRequest(settings, form, undefined);
  });
}

class Connection {
  #settings;
  #store;
  #refreshing;
  constructor(settings, store) {
    this.#settings = settings;
    this.#store = store;
  }
  async accessToken() {
    const tokens = await this.#store.load();
    if (!tokens)
      throw connectionRevoked("not signed in");
    const now = (this.#settings.now ?? Date.now)();
    if (tokens.expiresAtEpochMs === undefined || tokens.expiresAtEpochMs - EXPIRY_MARGIN_MS > now) {
      return tokens.accessToken;
    }
    return (await this.refresh(tokens.accessToken)).accessToken;
  }
  async refresh(staleAccessToken) {
    this.#refreshing ??= this.#renew(staleAccessToken).finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }
  async#renew(staleAccessToken) {
    const tokens = await this.#store.load();
    if (!tokens)
      throw connectionRevoked("not signed in");
    if (tokens.accessToken !== staleAccessToken)
      return tokens;
    if (!tokens.refreshToken) {
      await this.#store.save(null);
      throw connectionRevoked("the access token expired and cannot be renewed");
    }
    try {
      const renewed = await tokenRequest(this.#settings, { grant_type: "refresh_token", refresh_token: tokens.refreshToken }, tokens);
      await this.#store.save(renewed);
      return renewed;
    } catch (error) {
      if (!(error instanceof ApiRefusal && error.kind === "revoked"))
        throw error;
      const current = await this.#store.load();
      if (current && current.accessToken !== tokens.accessToken)
        return current;
      await this.#store.save(null);
      throw error;
    }
  }
  async disconnect() {
    const tokens = await this.#store.load();
    await this.#store.save(null);
    const endpoint = this.#settings.server.revocationEndpoint;
    const token = tokens?.refreshToken ?? tokens?.accessToken;
    if (!endpoint || !token)
      return;
    await send(this.#settings.fetch, new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        client_id: this.#settings.clientId
      }).toString()
    }));
  }
}
// packages/client/src/run.ts
async function shownPrice(api, described, bytes, locale) {
  const rate = rateOf(described.price, locale);
  if (rate !== undefined) {
    return [`${text(locale, "channel-optimize-estimate")}: ${rate}`];
  }
  if (bytes === undefined)
    return [];
  const quoted = await api.quote({ tool: described.tool, input_bytes: [bytes] });
  return quoteLines(quoted, (key, args) => text(locale, key, args));
}
async function ceilingOf(api, price, body, bytes) {
  const priced = quoteBodyOf(price, body, bytes);
  return ceilingFrom(price, priced === undefined ? undefined : await api.quote(priced));
}
async function runPriced(api, price, body, bytes, ceilingMs) {
  const maxCredits = await ceilingOf(api, price, body, bytes);
  return api.runTool(body, { ceilingMs, maxCredits });
}
export {
  APP_NAME,
  ApiRefusal,
  Connection,
  beginAuthorization,
  bodyOf,
  catalogLanguage,
  ceilingFrom,
  ceilingOf,
  completeAuthorization,
  connectionRevoked,
  createApi,
  defineChannelConfig,
  discoverAuthorizationServer,
  fieldsOf,
  locales,
  numberShown,
  quoteBodyOf,
  quoteLines,
  rateOf,
  refusalFrom,
  refusalOfRun,
  resultFileId,
  runPriced,
  shownPrice,
  text
};
