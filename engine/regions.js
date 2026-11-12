import Photon from "./vendor/photon-4.4.0.js";

// Measure the SDK's WebSocket round trip, without authenticating probe clients
// or joining rooms. Every probe is bounded and closed on completion/cancellation.
export function measureRegion(address, appId, signal, timeoutMs = 3500) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(null); return; }
    const peer = new Photon.PhotonPeer(Photon.ConnectionProtocol.Wss, address);
    peer.setLogLevel(Photon.LogLevel.OFF); peer.keepAliveTimeoutMs = 0;
    let finished = false, poll;
    const finish = rtt => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearInterval(poll);
      signal?.removeEventListener("abort", abort);
      try { peer.disconnect(); } catch { /* A socket can fail before opening. */ }
      resolve(rtt);
    };
    const abort = () => finish(null), timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    for (const state of ["error", "timeout", "connectFailed", "connectClosed", "disconnect"]) {
      peer.addPeerStatusListener(Photon.PhotonPeer.StatusCodes[state], abort);
    }
    peer.addPeerStatusListener(Photon.PhotonPeer.StatusCodes.connect, () => {
      poll = setInterval(() => { const rtt = peer.getRtt(); if (Number.isFinite(rtt) && rtt > 0) finish(rtt); }, 25);
    });
    try { peer.connect(appId); } catch { abort(); }
  });
}

export async function selectRegion(available, photon, signal, measure = measureRegion) {
  if (signal?.aborted) return null;
  const regions = Object.keys(photon.regions).filter(region => typeof available?.[region] === "string" && available[region]);
  if (!regions.length) throw new Error("No supported regions are available. Choose another region above.");
  if (regions.length === 1) return regions[0];
  const measurements = await Promise.all(regions.map(async region => ({ region,
    rtt: await measure(available[region], photon.appId, signal) })));
  if (signal?.aborted) return null;
  const fastest = measurements.filter(item => Number.isFinite(item.rtt) && item.rtt > 0).sort((a, b) => a.rtt - b.rtt)[0];
  // Restricted networks can block probes. A known enabled region is still a
  // useful fallback, and the player can override it with the region selector.
  return fastest?.region || (regions.includes(photon.defaultRegion) ? photon.defaultRegion : regions[0]);
}
