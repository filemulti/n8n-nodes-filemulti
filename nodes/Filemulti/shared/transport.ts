import {
  type Api,
  ApiRefusal,
  connectionRevoked,
  createApi,
  defineChannelConfig,
  type FetchLike,
} from '@convertator/client'
import {
  type IExecuteFunctions,
  type IHttpRequestMethods,
  type IHttpRequestOptions,
  type ILoadOptionsFunctions,
  type INode,
  type JsonObject,
  NodeApiError,
  NodeOperationError,
} from 'n8n-workflow'

import { CREDENTIAL_NAME } from '../../../credentials/FileMultiOAuth2Api.credentials'

type FullResponse = {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: ArrayBuffer | Uint8Array | undefined
}

function isUnauthorized(error: unknown): boolean {
  const seen = error as {
    httpCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  return [seen?.httpCode, seen?.status, seen?.response?.status].some(
    (code) => String(code) === '401',
  )
}

// WHY: the editor asks for a tool's list and fields outside an execution, with the same
// credential and the same helpers.
type Caller = IExecuteFunctions | ILoadOptionsFunctions

// WHY: n8n owns the tokens — its helper signs the request and renews the token on a 401 — so
// the client's own bearer header is dropped. A request the client sent unsigned is an upload to
// object storage, which must not see the token at all.
export function n8nFetch(ctx: Caller): FetchLike {
  return async (request) => {
    const headers = Object.fromEntries(request.headers)
    const signed = 'authorization' in headers
    delete headers.authorization
    const options: IHttpRequestOptions = {
      url: request.url,
      method: request.method as IHttpRequestMethods,
      headers,
      encoding: 'arraybuffer',
      returnFullResponse: true,
      // WHY: n8n renews the token only when the signed request throws its 401; every other
      // status stays an answer, because it is what tells a money refusal from a schema one.
      ignoreHttpStatusErrors: signed ? { ignore: true, except: [401] } : true,
      json: false,
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      options.body = Buffer.from(await request.arrayBuffer())
    }
    let response: FullResponse
    try {
      response = (await (signed
        ? ctx.helpers.httpRequestWithAuthentication.call(
            ctx,
            CREDENTIAL_NAME,
            options,
          )
        : ctx.helpers.httpRequest(options))) as FullResponse
    } catch (error) {
      if (!signed || !isUnauthorized(error)) {
        throw new NodeApiError(ctx.getNode(), error as JsonObject)
      }
      // WHY: a 401 thrown here has outlived the renewal n8n just tried.
      return Response.json(
        { code: 'unauthorized', message: 'unauthorized' },
        { status: 401 },
      )
    }
    const status = response.statusCode
    const answer = new Headers()
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) answer.set(name, [value].flat().join(', '))
    }
    const empty =
      status === 204 || status === 304 || response.body === undefined
    return new Response(
      empty ? null : new Uint8Array(response.body as ArrayBuffer),
      {
        status,
        headers: answer,
      },
    )
  }
}

export async function n8nApi(ctx: Caller): Promise<Api> {
  const credentials = await ctx.getCredentials(CREDENTIAL_NAME)
  return createApi({
    config: defineChannelConfig({
      apiBaseUrl: String(credentials.baseUrl ?? ''),
      oauthClientId: String(credentials.clientId ?? ''),
    }),
    fetch: n8nFetch(ctx),
    tokens: {
      accessToken: async () => '',
      // WHY: a 401 that reaches the client has already survived n8n's own renewal.
      refresh: async () => {
        throw connectionRevoked('The FileMulti connection is no longer valid')
      },
    },
  })
}

// WHY: the server's message already names the cause; the page that clears a money refusal is
// the one the server sent, shown as the description under the error.
export function asNodeError(
  node: INode,
  error: unknown,
  itemIndex: number,
): Error {
  if (!(error instanceof ApiRefusal)) return error as Error
  return new NodeOperationError(node, error.message, {
    itemIndex,
    description: error.actionUrl ?? error.reason ?? error.code,
  })
}
