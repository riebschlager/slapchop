// GIPHY Phase 0 request spike.
//
// Not product code. This file is never imported by the app; it is staged into
// public/ only for the duration of a spike run (scripts/giphy-spike.sh) so the
// same harness can run from all three origins named in the plan.
//
// It works two ways:
//   1. Loaded by docs/features/giphy-spike/index.html (dev server, packaged app).
//   2. Pasted into a devtools console on any origin, then called directly:
//        __giphySpike('YOUR_KEY').then(r => console.log(__giphySpikeMarkdown(r)))
//
// Key handling: the key is held in a local variable for the duration of a run.
// It is never stored, never placed in the report, and every string that could
// contain it passes through redact() before display. Do not paste a key into a
// shared console recording.

(() => {
  'use strict';

  const SEARCH_ENDPOINT = 'https://api.giphy.com/v1/gifs/search';

  // Only these are worth calling out in the write-up; the full set is reported.
  const INTERESTING_HEADERS = [
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset',
    'retry-after',
    'access-control-allow-origin',
    'access-control-expose-headers',
    'content-type',
    'content-length',
    'cache-control',
  ];

  const redact = (value, apiKey) => {
    const text = String(value);
    if (!apiKey) return text;
    return text.split(apiKey).join('<redacted-key>');
  };

  // fetch() only exposes CORS-safelisted headers plus whatever the server names
  // in Access-Control-Expose-Headers. A header missing here is not proof the
  // server omitted it -- confirm with the curl commands in the report.
  const readableHeaders = (response) => {
    const all = {};
    response.headers.forEach((value, name) => {
      all[name.toLowerCase()] = value;
    });
    const interesting = {};
    for (const name of INTERESTING_HEADERS) {
      if (name in all) interesting[name] = all[name];
    }
    return { all, interesting, readableCount: Object.keys(all).length };
  };

  const describeError = (error) => ({
    name: error && error.name ? error.name : 'Error',
    message: error && error.message ? error.message : String(error),
    // A bare TypeError from fetch carries no detail: a CORS rejection, a DNS
    // failure, and an offline network all look identical from script.
    ambiguous: error instanceof TypeError,
  });

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const environment = () => {
    const env = {
      origin: typeof location !== 'undefined' ? location.origin : '(none)',
      protocol: typeof location !== 'undefined' ? location.protocol : '(none)',
      href: typeof location !== 'undefined' ? location.href : '(none)',
      isSecureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(none)',
      // Present in a Tauri webview; distinguishes the packaged app from a browser.
      tauri: typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
    };
    env.label = env.tauri
      ? 'packaged/tauri webview'
      : env.origin.includes('localhost') || env.origin.includes('127.0.0.1')
        ? 'localhost dev server'
        : 'hosted browser origin';
    return env;
  };

  // Step 1: the API request. Costs exactly one call against the key's quota.
  async function searchStep(apiKey, options, signal) {
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('q', options.query);
    url.searchParams.set('limit', String(options.limit));
    url.searchParams.set('offset', '0');
    url.searchParams.set('rating', options.rating);
    url.searchParams.set('lang', options.lang);

    const displayUrl = redact(url.toString(), apiKey);
    const started = now();
    try {
      const response = await fetch(url.toString(), { signal, mode: 'cors' });
      const elapsedMs = Math.round(now() - started);
      const headers = readableHeaders(response);
      let body = null;
      let parseError = null;
      try {
        body = await response.json();
      } catch (error) {
        parseError = describeError(error);
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        type: response.type,
        redirected: response.redirected,
        elapsedMs,
        headers,
        parseError,
        // Provider payload is kept only long enough to pick a candidate; the
        // report stores counts and the chosen item, not the whole response.
        resultCount: body && Array.isArray(body.data) ? body.data.length : null,
        pagination: body && body.pagination ? body.pagination : null,
        meta: body && body.meta ? body.meta : null,
        displayUrl,
        _body: body,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        elapsedMs: Math.round(now() - started),
        error: describeError(error),
        displayUrl,
        _body: null,
      };
    }
  }

  // Pick the item the picker would actually import, and a smaller preview.
  function chooseCandidate(body) {
    if (!body || !Array.isArray(body.data) || body.data.length === 0) return null;
    for (const item of body.data) {
      const images = item && item.images ? item.images : {};
      const original = images.original && images.original.url ? images.original.url : null;
      if (!original) continue;
      const preview =
        (images.fixed_width && images.fixed_width.url) ||
        (images.downsized && images.downsized.url) ||
        original;
      return {
        id: item.id,
        title: item.title,
        rating: item.rating,
        pageUrl: item.url,
        username: item.username || null,
        sourceTld: item.source_tld || null,
        originalUrl: original,
        originalBytes: images.original && images.original.size ? Number(images.original.size) : null,
        originalWidth: images.original && images.original.width ? Number(images.original.width) : null,
        originalHeight: images.original && images.original.height ? Number(images.original.height) : null,
        previewUrl: preview,
      };
    }
    return null;
  }

  // Step 2: preview load through <img>, which is how the picker grid will show
  // results. An <img> without crossOrigin needs no CORS grant, so this passing
  // says nothing about whether fetch() will work.
  function imageStep(url, { crossOrigin = null, timeoutMs = 15000 } = {}) {
    return new Promise((resolve) => {
      const image = new Image();
      if (crossOrigin) image.crossOrigin = crossOrigin;
      const started = now();
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve({ crossOrigin: crossOrigin || '(none)', elapsedMs: Math.round(now() - started), ...result });
      };
      const timer = setTimeout(() => finish({ ok: false, timedOut: true }), timeoutMs);
      image.onload = () =>
        finish({ ok: true, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => finish({ ok: false, timedOut: false });
      image.src = url;
    });
  }

  const GIF_SIGNATURES = ['GIF87a', 'GIF89a'];

  const readSignature = (buffer) => {
    const bytes = new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength));
    return String.fromCharCode(...bytes);
  };

  // Step 3: the import path. This is the request that actually needs a CORS
  // grant from the media host, and the one that decides whether the feature is
  // possible without a proxy.
  async function originalFetchStep(url, signal) {
    const started = now();
    try {
      const response = await fetch(url, { signal, mode: 'cors' });
      const headers = readableHeaders(response);
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          redirected: response.redirected,
          finalUrl: response.url,
          elapsedMs: Math.round(now() - started),
          headers,
        };
      }
      const buffer = await response.arrayBuffer();
      const signature = readSignature(buffer);
      return {
        ok: true,
        status: response.status,
        type: response.type,
        redirected: response.redirected,
        finalUrl: response.url,
        elapsedMs: Math.round(now() - started),
        headers,
        byteLength: buffer.byteLength,
        signature,
        isGif: GIF_SIGNATURES.includes(signature),
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        elapsedMs: Math.round(now() - started),
        error: describeError(error),
      };
    }
  }

  // Optional. Off by default: a beta key is documented at 100 calls/hour, and
  // this deliberately spends them to observe a 429 and whether Retry-After
  // accompanies it. Only run this once the rest of the spike has passed.
  async function burstStep(apiKey, options, count, signal) {
    const attempts = [];
    for (let index = 0; index < count; index += 1) {
      if (signal && signal.aborted) break;
      const result = await searchStep(apiKey, options, signal);
      delete result._body;
      attempts.push({ index, status: result.status, interesting: result.headers ? result.headers.interesting : null });
      if (result.status === 429) {
        return { triggered: true, attempts, limitedAt: index, headers: result.headers };
      }
    }
    return { triggered: false, attempts };
  }

  async function run(apiKey, options = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('Pass your GIPHY API key as the first argument.');
    }
    const settings = {
      query: options.query || 'loop',
      limit: options.limit || 5,
      rating: options.rating || 'pg-13',
      lang: options.lang || 'en',
      burst: options.burst || 0,
    };
    const controller = new AbortController();
    const report = {
      ranAt: new Date().toISOString(),
      environment: environment(),
      settings: { query: settings.query, limit: settings.limit, rating: settings.rating, lang: settings.lang },
      steps: {},
      notes: [],
    };

    const search = await searchStep(apiKey, settings, controller.signal);
    const body = search._body;
    delete search._body;
    report.steps.search = search;

    if (!search.ok) {
      report.notes.push(
        search.error && search.error.ambiguous
          ? 'Search failed with an opaque TypeError. Script cannot tell a CORS rejection from an offline network -- read the devtools Network tab, or run the curl command below, before recording a verdict.'
          : `Search returned HTTP ${search.status}. 401/403 means the key was rejected; 429 means the quota is spent.`,
      );
      report.curl = curlCommands(null, settings);
      return report;
    }

    const candidate = chooseCandidate(body);
    report.candidate = candidate;
    if (!candidate) {
      report.notes.push('Search succeeded but no result exposed images.original.url. Try another query.');
      report.curl = curlCommands(null, settings);
      return report;
    }

    report.steps.previewImg = await imageStep(candidate.previewUrl, { crossOrigin: null });
    report.steps.previewImgCors = await imageStep(candidate.previewUrl, { crossOrigin: 'anonymous' });
    report.steps.originalFetch = await originalFetchStep(candidate.originalUrl, controller.signal);

    const original = report.steps.originalFetch;
    if (original.ok && !original.isGif) {
      report.notes.push(
        `images.original.url returned bytes whose signature is "${original.signature}", not GIF87a/GIF89a. Phase 3 rendition validation must reject this rather than import it.`,
      );
    }
    if (!original.ok && original.error && original.error.ambiguous) {
      report.notes.push(
        'The original-rendition fetch failed opaquely. This is the request the importer depends on -- confirm in devtools whether it was a CORS rejection before concluding the feature needs a different approach.',
      );
    }
    if (report.steps.previewImg.ok && !report.steps.previewImgCors.ok) {
      report.notes.push(
        'Previews load in a plain <img> but not with crossOrigin="anonymous": the media host is not sending an Access-Control-Allow-Origin for this origin. The grid still works; canvas reads and fetch() of media do not.',
      );
    }

    if (settings.burst > 0) {
      report.steps.burst = await burstStep(apiKey, settings, settings.burst, controller.signal);
      if (!report.steps.burst.triggered) {
        report.notes.push(`Burst of ${settings.burst} extra calls did not reach a 429; Retry-After behavior is still unobserved.`);
      }
    }

    report.curl = curlCommands(candidate, settings);
    return report;
  }

  // Script can only see exposed headers. These commands show the full response
  // headers, including the CORS grant. They read the key from the environment
  // so no command containing a key is ever copied out of this harness.
  function curlCommands(candidate, settings) {
    const origin = typeof location !== 'undefined' ? location.origin : 'https://example.invalid';
    // Encode exactly as the fetch above did, so curl reproduces the same request
    // byte for byte rather than a near-miss.
    const query = new URLSearchParams({ q: settings.query }).toString().slice(2);
    return {
      note: 'Run with GIPHY_KEY exported in the shell. curl is not subject to CORS; it shows what the server sends, which is what you record.',
      search: `curl -sS -D - -o /dev/null -H 'Origin: ${origin}' "https://api.giphy.com/v1/gifs/search?api_key=$GIPHY_KEY&q=${query}&limit=${settings.limit}&rating=${settings.rating}&lang=${settings.lang}"`,
      searchPreflightNote: 'A simple GET with no custom headers sends no preflight, so there is no OPTIONS request to capture.',
      original: candidate
        ? `curl -sS -D - -o /dev/null -H 'Origin: ${origin}' "${candidate.originalUrl}"`
        : '(no candidate selected)',
    };
  }

  const row = (label, value, headers) => `| ${label} | ${value} | ${headers} |`;
  const headerCell = (headers) => {
    if (!headers || !headers.interesting) return '(none readable)';
    const entries = Object.entries(headers.interesting);
    if (entries.length === 0) return `(none of the interesting headers readable; ${headers.readableCount} readable total)`;
    return entries.map(([name, value]) => `\`${name}: ${value}\``).join('<br>');
  };

  // Emits the block that gets pasted into docs/features/giphy-spike-note.md.
  function markdown(report) {
    const lines = [];
    const env = report.environment;
    lines.push(`#### ${env.label} — \`${env.origin}\``);
    lines.push('');
    lines.push(`- Run at: ${report.ranAt}`);
    lines.push(`- Query: \`${report.settings.query}\`, limit ${report.settings.limit}, rating ${report.settings.rating}, lang ${report.settings.lang}`);
    lines.push(`- Secure context: ${env.isSecureContext} · Tauri webview: ${env.tauri}`);
    lines.push(`- User agent: \`${env.userAgent}\``);
    lines.push('');
    lines.push('| Step | Result | Readable headers |');
    lines.push('| --- | --- | --- |');

    const search = report.steps.search;
    const searchSummary = search.ok
      ? `HTTP ${search.status} in ${search.elapsedMs} ms, ${search.resultCount} results`
      : search.error
        ? `FAILED (${search.error.name}: ${search.error.message})`
        : `HTTP ${search.status} ${search.statusText || ''}`;
    lines.push(row('Search API', searchSummary, headerCell(search.headers)));

    const preview = report.steps.previewImg;
    if (preview) {
      const previewSummary = preview.ok
        ? `loaded ${preview.width}x${preview.height} in ${preview.elapsedMs} ms`
        : preview.timedOut
          ? 'timed out'
          : 'failed';
      lines.push(row('Preview `<img>`', previewSummary, 'n/a (img exposes none)'));
    }
    const previewCors = report.steps.previewImgCors;
    if (previewCors) {
      lines.push(row('Preview `<img crossorigin>`', previewCors.ok ? 'loaded' : 'blocked', 'n/a'));
    }
    const original = report.steps.originalFetch;
    if (original) {
      const summary = original.ok
        ? `HTTP ${original.status}, ${original.byteLength} bytes, signature \`${original.signature}\`, isGif ${original.isGif}, redirected ${original.redirected}`
        : original.error
          ? `FAILED (${original.error.name}: ${original.error.message})`
          : `HTTP ${original.status} ${original.statusText || ''}`;
      lines.push(row('`images.original.url` fetch', summary, headerCell(original.headers)));
    }
    const burst = report.steps.burst;
    if (burst) {
      const burstSummary = burst.triggered
        ? `429 after ${burst.limitedAt + 1} extra calls`
        : `no 429 in ${burst.attempts.length} extra calls`;
      lines.push(row('Rate-limit burst', burstSummary, headerCell(burst.headers)));
    }

    lines.push('');
    if (report.candidate) {
      lines.push(`Candidate: \`${report.candidate.id}\` — ${report.candidate.title || '(untitled)'} · ${report.candidate.originalWidth}x${report.candidate.originalHeight} · reported ${report.candidate.originalBytes} bytes · creator \`${report.candidate.username || 'none'}\` · source \`${report.candidate.sourceTld || 'none'}\``);
      lines.push('');
    }
    if (report.notes.length > 0) {
      lines.push('Observations:');
      lines.push('');
      for (const note of report.notes) lines.push(`- ${note}`);
      lines.push('');
    }
    lines.push('Full headers must come from curl, not from script:');
    lines.push('');
    lines.push('```sh');
    lines.push(report.curl.search);
    lines.push(report.curl.original);
    lines.push('```');
    lines.push('');
    return lines.join('\n');
  }

  window.__giphySpike = run;
  window.__giphySpikeMarkdown = markdown;
  window.__giphySpikeRedact = redact;
})();
