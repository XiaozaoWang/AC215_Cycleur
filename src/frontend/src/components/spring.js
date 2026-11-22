// Spring motion shared by the map (canvas cells, route lines) and CSS.
// Apple-style parameters: damping ratio (1 = settles without overshoot, below 1 = bounces) and response (seconds,
// roughly how long one swing takes; smaller is snappier). A spring has no fixed duration: it settles when it settles.

// Position of a spring released at 0 toward 1, t seconds later
export function spring(t, damping = 1, response = 0.5) {
    if (t <= 0) return 0;
    const w = (2 * Math.PI) / response;
    if (damping >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
    const wd = w * Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
}

// Seconds until the spring stays within eps of 1
export function settleTime(damping, response, eps = 0.002) {
    let last = 0;
    for (let t = 0; t < 4; t += 0.005) if (Math.abs(1 - spring(t, damping, response)) >= eps) last = t;
    return last + 0.005;
}

let linearSupport;
const cache = new Map();

// {easing, duration} for the Web Animations API: the spring sampled into a CSS linear() curve.
// Browsers without linear() get a strong ease-out of the same length.
export function springEasing(damping = 1, response = 0.5) {
    const key = `${damping}/${response}`;
    if (cache.has(key)) return cache.get(key);
    if (linearSupport === undefined) {
        linearSupport = typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 1)');
    }
    const seconds = settleTime(damping, response);
    const steps = 40;
    const points = Array.from({ length: steps + 1 }, (_, i) => (i === steps ? 1 : spring((i / steps) * seconds, damping, response)));
    const easing = linearSupport ? `linear(${points.map(p => Math.round(p * 10000) / 10000).join(', ')})` : 'cubic-bezier(0.23, 1, 0.32, 1)';
    const value = { easing, duration: Math.round(seconds * 1000) };
    cache.set(key, value);
    return value;
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
