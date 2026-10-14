// Only /api/* invokes this function; static game assets stay on Pages.
export async function onRequest({ request, env }) {
  try {
    if (!env.STATS) throw new Error('Statistics binding is not configured');
    return await env.STATS.fetch(request);
  } catch {
    return Response.json({ error: 'Statistics temporarily unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
}
