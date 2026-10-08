// Bro fra Netlifys nye funktionsformat til backendens gamle handlere.
// Det gamle format (Lambda-kompatibelt) maa hoejst have 4 KB miljoevariabler i alt, og med App Store-noeglen
// blev graensen ramt. Det nye format har ingen graense. Logikken i netlify/handlers/ er uaendret.
export function tilV2(handler) {
  return async (req, context) => {
    const url = new URL(req.url);
    const headers = Object.fromEntries(req.headers);
    if (!headers['x-nf-client-connection-ip'] && context && context.ip) headers['x-nf-client-connection-ip'] = context.ip;
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.text();
    const ev = { httpMethod: req.method, headers, path: url.pathname, rawUrl: req.url,
      queryStringParameters: Object.fromEntries(url.searchParams), body: body || null, isBase64Encoded: false };
    const r = (await handler(ev, context)) || { statusCode: 204 };
    const status = r.statusCode || 200;
    const krop = status === 204 || status === 304 ? null : (r.body == null ? '' : String(r.body));
    return new Response(krop, { status, headers: r.headers || {} });
  };
}
