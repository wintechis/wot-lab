import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createLoggers } from '../utils/debug.js';

const { debug, warn } = createLoggers('solid');

// Namespaced under `solid` so one DEBUG filter covers the pod traffic and the
// authentication that carries it — a refused record and an unobtainable token
// are the same symptom to whoever is watching a run.

/**
 * A `fetch`, narrowed to what this module and the sink need.
 *
 * Narrow enough that the global `fetch` satisfies it, so an unauthenticated pod
 * stays the default and costs no wrapper.
 */
// eslint-disable-next-line no-unused-vars
export type SolidFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface DpopFetchOptions {
  /**
   * The Solid server, as an origin — both the OIDC issuer tokens are minted at
   * and the only origin requests may be sent to. One value rather than two
   * because a Community Solid Server is its own identity provider; a deployment
   * that separates them needs a second option, and should say so here.
   */
  server: string;
  /** A client credentials token's id, from the server's account page. */
  clientId: string;
  clientSecret: string;
}

// Where the issuer advertises its endpoints. Discovery rather than a fixed
// `/.oidc/token` because that path is one server's current choice, not a
// protocol constant, and a pod upgrade must not silently stop authenticating.
const discoveryPath = '.well-known/openid-configuration';

// What CSS uses today, for when discovery is unreachable. A guess is better than
// a refusal here: the lab's job is to keep recording, and a wrong guess costs one
// failed POST that is reported like any other.
const fallbackTokenPath = '/.oidc/token';

// Token and discovery requests are not in anyone's path — they happen behind a
// queued snapshot — but a black-holed identity provider must not hold a lane.
const tokenRequestTimeoutMs = 10_000;

// Renew this long before the server would reject the token. A token that expires
// between the check and the pod reading it costs a round-trip and a retry, which
// the retry below handles; this is what keeps that rare.
const renewalMarginMs = 30_000;

// What to assume when the token endpoint names no lifetime. Short, because the
// cost of renewing too often is one request every few minutes, and the cost of
// holding a dead token is a failed record.
const assumedTokenLifetimeMs = 300_000;

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const hash = (value: string): string => createHash('sha256').update(value).digest('base64url');

/**
 * Is this body safe to send twice?
 *
 * A DPoP exchange is built on retries — a server's first answer is often only a
 * nonce — and a stream, once read, has nothing left to send. Everything else a
 * caller passes (a string, a buffer, a form) can be replayed, so only a stream
 * is ruled out, and a streamed body simply forfeits the retry rather than the
 * request.
 */
function replayable(body: RequestInit['body']): boolean {
  return !(body instanceof ReadableStream);
}

/**
 * A `fetch` that authenticates to one Solid server with Solid-OIDC.
 *
 * The flow is the one a Community Solid Server offers a script: `client_credentials`
 * at the issuer's token endpoint, answered with a token bound to a key this
 * process holds, and every request proving possession of that key (RFC 9449).
 *
 * The state that makes this a service rather than a script lives in the closure:
 * one key pair for the process, one token held until it nears expiry, and the
 * server's current nonce. A caller that minted a key and a token per request
 * would pay three round-trips for every record the lab writes.
 *
 * Failure is a thrown error or a non-ok `Response`, both of which the sink
 * already reports per snapshot — authentication going down degrades a run's
 * provenance, and must not take the lab with it.
 */
export function createDpopFetch(options: DpopFetchOptions): SolidFetch {
  const server = new URL(options.server);
  // One key pair for the life of the process. The token is bound to it, so
  // rotating the key means re-minting the token; nothing here is long-lived
  // enough to need that, and the key never leaves memory.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });

  // The server's current nonce, per origin. Kept across requests because a nonce
  // is the server's, not a request's: holding it means the next request is
  // accepted first time, where re-learning it would make every POST a 401 and a
  // retry.
  const nonces = new Map<string, string>();
  let token: { value: string; expiresAt: number } | undefined;
  // One mint at a time. The sink drains down parallel lanes, and without this
  // every lane that found the token expired would mint one of its own.
  let minting: Promise<string> | undefined;
  let tokenEndpoint: string | undefined;
  let warnedAboutDiscovery = false;

  /**
   * A DPoP proof for one request: this key, this method, this URL, now.
   *
   * `htu` drops the query and fragment, as the RFC requires. `ath` binds the
   * proof to the token, so neither is useful without the other.
   */
  function proof(target: URL, method: string, accessToken?: string): string {
    const claims: Record<string, unknown> = {
      htu: `${target.origin}${target.pathname}`,
      htm: method,
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID()
    };
    if (accessToken) {
      claims.ath = hash(accessToken);
    }
    const nonce = nonces.get(target.origin);
    if (nonce) {
      claims.nonce = nonce;
    }
    const input = `${encode({ typ: 'dpop+jwt', alg: 'ES256', jwk })}.${encode(claims)}`;
    // `ieee-p1363` is the raw r||s ES256 asks for; Node's default DER encoding
    // would be a valid signature of the right bytes that no JWT verifier reads.
    const signature = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return `${input}.${signature.toString('base64url')}`;
  }

  /** One proven request, recording whatever nonce the answer carries. */
  async function send(target: URL, method: string, init: RequestInit, accessToken?: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('DPoP', proof(target, method, accessToken));
    if (accessToken) {
      headers.set('Authorization', `DPoP ${accessToken}`);
    }
    const response = await fetch(target, { ...init, method, headers });
    const nonce = response.headers.get('DPoP-Nonce');
    if (nonce) {
      nonces.set(target.origin, nonce);
    }
    return response;
  }

  /**
   * A request, retried once if the server answered only to hand out a nonce.
   *
   * A nonce challenge is a 400 or a 401 carrying a `DPoP-Nonce` the proof did not
   * use — the first request to a server, and again whenever the server rotates
   * it. Only a *changed* nonce is worth retrying on: a 401 that repeats the nonce
   * we already used is a real refusal, and retrying it would be a loop.
   */
  async function sendWithNonce(target: URL, method: string, init: RequestInit, accessToken?: string): Promise<Response> {
    const used = nonces.get(target.origin);
    const response = await send(target, method, init, accessToken);
    const issued = nonces.get(target.origin);
    const challenged = response.status === 400 || response.status === 401;
    if (!response.ok && challenged && issued && issued !== used && replayable(init.body)) {
      // Drain it: an unread body holds the connection open, and this one says
      // nothing the retry will not say better.
      await response.arrayBuffer().catch(() => undefined);
      return send(target, method, init, accessToken);
    }
    return response;
  }

  /**
   * Where this issuer mints tokens.
   *
   * Cached only once it is known, so a discovery that failed is retried on the
   * next mint — minutes apart — rather than fixing the fallback in place for the
   * life of the process. The endpoint must be on the issuer's own origin: the
   * client secret goes in that request, and discovery is the one part of this
   * flow the server gets to choose.
   */
  async function resolveTokenEndpoint(): Promise<string> {
    if (tokenEndpoint) {
      return tokenEndpoint;
    }
    const fallback = new URL(fallbackTokenPath, server).href;
    try {
      const response = await fetch(new URL(discoveryPath, server), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(tokenRequestTimeoutMs)
      });
      if (response.ok) {
        const document = await response.json() as { token_endpoint?: unknown };
        const advertised = typeof document.token_endpoint === 'string' ? new URL(document.token_endpoint, server) : undefined;
        if (advertised?.origin === server.origin) {
          tokenEndpoint = advertised.href;
          debug(`Token endpoint of ${server.origin} is ${tokenEndpoint}`);
          return tokenEndpoint;
        }
      }
    } catch (cause) {
      debug(`Discovery at ${server.origin} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!warnedAboutDiscovery) {
      warnedAboutDiscovery = true;
      warn(`Could not read the token endpoint of ${server.origin} from ${discoveryPath}; using ${fallback}`);
    }
    return fallback;
  }

  /** Exchange the client credentials for a key-bound access token. */
  async function mint(): Promise<string> {
    const endpoint = new URL(await resolveTokenEndpoint());
    const response = await sendWithNonce(endpoint, 'POST', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
        // The scope that asks the token to carry a WebID, which is what a pod's
        // access rules are written against.
        scope: 'webid'
      }).toString(),
      signal: AbortSignal.timeout(tokenRequestTimeoutMs)
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`Token endpoint ${endpoint.href} answered ${response.status} ${response.statusText}: ${detail}`);
    }

    const payload = await response.json() as { access_token?: unknown; token_type?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string') {
      throw new Error(`Token endpoint ${endpoint.href} returned no access token`);
    }
    // A bearer token here would be a downgrade worth refusing rather than using:
    // the proofs below would be ignored, and a token that needs no key is one a
    // pod's log cannot tell from a stolen one.
    if (String(payload.token_type).toLowerCase() !== 'dpop') {
      throw new Error(`Expected a DPoP-bound token from ${endpoint.href}, got '${String(payload.token_type)}'`);
    }

    const lifetimeMs = typeof payload.expires_in === 'number' && payload.expires_in > 0
      ? payload.expires_in * 1_000
      : assumedTokenLifetimeMs;
    // Half the lifetime when the margin would consume all of it, so a very short
    // token is still used rather than renewed before every request.
    token = { value: payload.access_token, expiresAt: Date.now() + Math.max(lifetimeMs - renewalMarginMs, lifetimeMs / 2) };
    debug(`Minted a DPoP access token at ${endpoint.href}, usable for ${Math.round((token.expiresAt - Date.now()) / 1_000)}s`);
    return token.value;
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now()) {
      return token.value;
    }
    minting ??= mint().finally(() => {
      minting = undefined;
    });
    return minting;
  }

  return async function dpopFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url);
    // The token is bound to this server, and a secret-backed credential must not
    // be offered to a host that merely appeared in a configuration string.
    if (target.origin !== server.origin) {
      throw new Error(`Refusing to send a ${server.origin} token to ${target.origin}`);
    }
    const method = (init.method ?? 'GET').toUpperCase();
    // A followed redirect would re-send the proof under the old `htu` and be
    // refused as a bad proof, which reads as an authentication failure rather
    // than as the relocation it is. Left visible to the caller instead.
    const request: RequestInit = { redirect: 'manual', ...init };

    const response = await sendWithNonce(target, method, request, await accessToken());
    if (response.status !== 401 || !replayable(request.body)) {
      return response;
    }

    // A 401 that survived the nonce retry is the token's: a pod that has the
    // token and will not honour the request answers 403. Expiry is the ordinary
    // cause — a token can die between the renewal check and the pod reading it —
    // so the token is dropped and the request proven again, once.
    debug(`${server.origin} rejected the access token; renewing it`);
    await response.arrayBuffer().catch(() => undefined);
    token = undefined;
    return sendWithNonce(target, method, request, await accessToken());
  };
}
