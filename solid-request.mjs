import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            file: { type: 'string' },
            type: { type: 'string' },
            accept: { type: 'string', default: 'application/json' },
            header: { type: 'string', multiple: true, default: [] },
        },
    });
    if (positionals.length !== 2) {
        throw new Error('Usage: node solid-request.mjs METHOD URL [--file FILE] [--type MIME] [--accept MIME] [--header "Name: value"]');
    }
    const method = positionals[0].toUpperCase();
    const url = new URL(positionals[1]);
    const base = new URL(process.env.SIETCH_BASE);
    const clientId = process.env.SIETCH_CLIENT_ID;
    const clientSecret = process.env.SIETCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Set SIETCH_CLIENT_ID and SIETCH_CLIENT_SECRET in hackathon.env.');
    if (base.protocol !== 'https:' || url.origin !== base.origin) {
        throw new Error('Use an HTTPS URL on the same server as SIETCH_BASE.');
    }
    url.hash = '';
    if (values.file && ['GET', 'HEAD'].includes(method)) {
        throw new Error('GET and HEAD do not take --file.');
    }
    const body = values.file ? await readFile(values.file) : undefined;
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const hash = value => createHash('sha256').update(value).digest('base64url');

    function proof(target, verb, accessToken, nonce) {
        const targetUrl = new URL(target);
        const claims = {
            htu: targetUrl.origin + targetUrl.pathname,
            htm: verb,
            iat: Math.floor(Date.now() / 1000),
            jti: randomUUID(),
        };
        if (accessToken) claims.ath = hash(accessToken);
        if (nonce) claims.nonce = nonce;
        const input = `${encode({ typ: 'dpop+jwt', alg: 'ES256', jwk })}.${encode(claims)}`;
        const signature = sign('sha256', Buffer.from(input), {
            key: privateKey,
            dsaEncoding: 'ieee-p1363',
        });
        return `${input}.${signature.toString('base64url')}`;
    }

    async function request(target, verb, headers, requestBody, accessToken) {
        let nonce;
        for (let attempt = 0; attempt < 2; attempt++) {
            const signedHeaders = new Headers(headers);
            signedHeaders.set('DPoP', proof(target, verb, accessToken, nonce));
            if (accessToken) signedHeaders.set('Authorization', `DPoP ${accessToken}`);
            const response = await fetch(target, {
                method: verb,
                headers: signedHeaders,
                body: requestBody,
                redirect: 'manual',
                signal: AbortSignal.timeout(60000),
            });
            nonce = response.headers.get('DPoP-Nonce');
            if (attempt === 0 && nonce && [400, 401].includes(response.status)) {
                await response.arrayBuffer();
                continue;
            }
            return response;
        }
    }

    const tokenUrl = new URL('/.oidc/token', base);
    const tokenResponse = await request(tokenUrl, 'POST', {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
    }, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'webid',
    }));
    if (!tokenResponse.ok) {
        throw new Error(`Token endpoint HTTP ${tokenResponse.status}: ${await tokenResponse.text()}`);
    }
    const token = await tokenResponse.json();
    if (token.token_type !== 'DPoP' || !token.access_token) {
        throw new Error('Expected a DPoP access token from the server.');
    }
    const headers = new Headers({ Accept: values.accept });
    if (values.type) headers.set('Content-Type', values.type);
    for (const header of values.header) {
        const colon = header.indexOf(':');
        if (colon < 1) throw new Error('Use --header "Name: value".');
        headers.set(header.slice(0, colon).trim(), header.slice(colon + 1).trim());
    }
    const response = await request(url, method, headers, body, token.access_token);
    console.error(`HTTP ${response.status}`);
    for (const name of ['content-type', 'etag', 'location', 'retry-after']) {
        const value = response.headers.get(name);
        if (value) console.error(`${name}: ${value}`);
    }
    process.stdout.write(await response.text());
    if (!response.ok) process.exitCode = 1;
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
