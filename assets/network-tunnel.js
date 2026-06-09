(function () {
  const originalFetch = window.fetch.bind(window);

  function getRuntimeConfig() {
    return window.PICOTRACK_RUNTIME_CONFIG || {};
  }

  function isSupabaseTarget(url) {
    const cfg = getRuntimeConfig();
    if (!cfg.supabaseUrl) return false;
    try {
      const target = new URL(url, window.location.href);
      const supa = new URL(cfg.supabaseUrl);
      return target.origin === supa.origin;
    } catch (_) {
      return false;
    }
  }

  function getPath(url) {
    const target = new URL(url, window.location.href);
    return target.pathname + target.search;
  }

  function mergeHeaders(input, init) {
    const headers = new Headers();
    try {
      if (input && input.headers) new Headers(input.headers).forEach((v, k) => headers.set(k, v));
      if (init && init.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    } catch (_) {}
    return headers;
  }

  async function cloneBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) return init.body;
    if (input && typeof input.clone === 'function') {
      const clone = input.clone();
      return await clone.arrayBuffer();
    }
    return undefined;
  }

  window.fetch = async function patchedPicoTrackFetch(input, init) {
    const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    if (!rawUrl || !isSupabaseTarget(rawUrl)) {
      return originalFetch(input, init);
    }

    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const headers = mergeHeaders(input, init);
    const body = await cloneBody(input, init);

    const tunnelHeaders = new Headers();
    const auth = headers.get('authorization');
    if (auth) tunnelHeaders.set('Authorization', auth);
    const contentType = headers.get('content-type');
    if (contentType) tunnelHeaders.set('Content-Type', contentType);
    const prefer = headers.get('prefer');
    if (prefer) tunnelHeaders.set('Prefer', prefer);
    const range = headers.get('range');
    if (range) tunnelHeaders.set('Range', range);
    tunnelHeaders.set('X-PicoTrack-Path', getPath(rawUrl));
    tunnelHeaders.set('X-PicoTrack-Method', method);

    return originalFetch('/api/tunnel', {
      method: ['GET', 'HEAD'].includes(method) ? 'GET' : 'POST',
      headers: tunnelHeaders,
      body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      credentials: 'same-origin',
      cache: 'no-store'
    });
  };
})();
