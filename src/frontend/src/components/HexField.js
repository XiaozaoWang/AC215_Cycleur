// The H3 cells on the map, drawn on one canvas that is repainted every animation frame (a Leaflet renderer, so it pans
// and zooms with the map). Drawing the cells ourselves is what lets the scan move smoothly:
//
//   scan    every cell that will be predicted appears as frosted glass, rippling out from the shortest route, with a band
//           of light sweeping outward over it. A "front" travels outward from the route as predictions come back; each
//           predicted cell it passes turns into its colour with a small springy lift, so the colour rolls out like a wave.
//   settle  the routes are in: the front finishes, then the cells fade away from the outside in.
//   shown / hidden   the heatmap toggle: cells rise in from the route outward, and fade from the outside in.
import L from 'leaflet';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import { spring, settleTime, reducedMotion } from './spring';
import { matchColor } from './palette';

const COLOR_ALPHA = 0.66;
const GLASS_RIPPLE = 0.45;       // seconds for the glass to ripple from the route to the farthest cell
const SHEEN_PERIOD = 2.2;        // seconds for one band of light to cross the field
const WAVE_SPREAD = 0.32;        // seconds between the nearest and the farthest cell when showing or hiding
const HOLD_AFTER_SCAN = 0.7;     // seconds the finished heatmap stays before it fades
const FADE_TIME = WAVE_SPREAD + settleTime(1, 0.45);
const SHOW_TIME = WAVE_SPREAD + settleTime(0.62, 0.5);

const KY = 110540;               // metres per degree of latitude

function nearest(px, py, line) {
    let best = Infinity;
    for (let i = 2; i < line.length; i += 2) {
        const ax = line[i - 2], ay = line[i - 1], dx = line[i] - ax, dy = line[i + 1] - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
    return best;
}

export const HexField = L.Renderer.extend({
    options: { padding: 0.15, pane: 'hexes', onSettled: null, colorFor: matchColor },

    initialize(options) {
        L.Renderer.prototype.initialize.call(this, options);
        this._cells = new Map();
        this._sorted = [];
        this._arrived = 0;
        this._maxD = 1;
        this._line = null;
        this._mode = 'off';
        this._tick = this._tick.bind(this);
        // While the map is dragged the canvas moves with it; redraw now and then to fill in cells beyond its margin
        this._dragUpdate = L.Util.throttle(this._update, 120, this);
    },

    _initContainer() {
        this._container = L.DomUtil.create('canvas', 'hex-field');
        this._ctx = this._container.getContext('2d');
    },

    _destroyContainer() {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
        L.DomUtil.remove(this._container);
    },

    getEvents() {
        const events = L.Renderer.prototype.getEvents.call(this);
        events.move = this._dragUpdate;               // keep the canvas under the cells while the map is dragged
        // While the map zooms or flies, the canvas is not redrawn (re-projecting every cell at each in-between zoom is
        // what made the flight stutter): Leaflet scales the canvas along, and it is redrawn once the zoom ends
        events.zoomstart = this._zoomStart;
        events.zoomend = this._zoomEnd;
        return events;
    },

    _zoomStart() { this._zooming = true; },

    _zoomEnd() {
        this._zooming = false;
        L.Renderer.prototype._onZoomEnd.call(this);
        this._update();
    },

    _update() {
        if ((this._map._animatingZoom || this._zooming) && this._bounds) return;
        L.Renderer.prototype._update.call(this);
        const size = this._bounds.getSize();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        L.DomUtil.setPosition(this._container, this._bounds.min);
        if (size.x !== this._w || size.y !== this._h || dpr !== this._dpr) {
            this._w = size.x; this._h = size.y; this._dpr = dpr;
            this._container.width = Math.round(size.x * dpr);
            this._container.height = Math.round(size.y * dpr);
            this._container.style.width = `${size.x}px`;
            this._container.style.height = `${size.y}px`;
        }
        if (!this._raf) this._draw(performance.now());
    },

    // ---- data -------------------------------------------------------------------------------------------------------

    // The cells of a new plan (nearest to the route first) and the shortest route as [[lat, lng], ...]
    setScan(scan) {
        this._cells.clear();
        this._sorted = [];
        this._arrived = 0;
        this._line = null;
        this._mode = 'off';
        if (scan?.route?.length) {
            this._lat0 = scan.route[0][0];
            this._kx = 111320 * Math.cos((this._lat0 * Math.PI) / 180);
            this._line = scan.route.flatMap(([lat, lng]) => [lng * this._kx, lat * KY]);
        }
        for (const id of scan?.cells ?? []) this._add(id, 0);
        this._resort();
    },

    _add(id, appearAt) {
        const [lat, lng] = cellToLatLng(id);
        const d = this._line ? nearest(lng * this._kx, lat * KY, this._line) : 0;
        const cell = { id, ring: cellToBoundary(id), center: [lat, lng], d, appearAt, arrive: null, reveal: null, value: null, color: null, proj: null, z: null };
        this._cells.set(id, cell);
        return cell;
    },

    _resort() {
        this._sorted = [...this._cells.values()].map(c => c.d).sort((a, b) => a - b);
        this._maxD = Math.max(1, this._sorted[this._sorted.length - 1] ?? 1);
    },

    // values: {h3_index: match 0..1 or null}. Only grows during a scan; new cells (a wider search) are added on the fly.
    setValues(values) {
        const now = performance.now();
        let added = false;
        for (const [id, value] of Object.entries(values)) {
            let cell = this._cells.get(id);
            if (!cell) { cell = this._add(id, now); added = true; }
            if (cell.arrive === null) {
                cell.arrive = now;
                cell.value = value;
                cell.color = this.options.colorFor(value);
                this._arrived++;
            }
        }
        if (added) this._resort();
        this._kick();
    },

    // colorFor(value) -> CSS colour: a new colour scheme recolours every cell at once
    setColors(colorFor) {
        if (!colorFor || colorFor === this.options.colorFor) return;
        this.options.colorFor = colorFor;
        for (const cell of this._cells.values()) if (cell.arrive !== null) cell.color = colorFor(cell.value);
        if (!this._raf && this._map) this._draw(performance.now());
    },

    // off | scan | settle | shown | hidden
    setMode(mode) {
        const now = performance.now();
        const previous = this._mode;
        if (mode === previous || (mode === 'hidden' && (previous === 'fade' || previous === 'off'))) return;
        if (mode === 'scan') {
            this._t0 = now;
            this._front = 0;
            this._lastReveal = now;
            for (const cell of this._cells.values()) {
                cell.appearAt = now + (cell.d / this._maxD) * GLASS_RIPPLE * 1000;
                cell.reveal = null;
            }
        } else if (mode === 'hidden') {
            mode = 'fade';
            this._fadeStart = now;
        } else if (mode === 'shown') {
            this._showStart = now;
        }
        this._mode = mode;
        this._kick();
    },

    // ---- drawing ----------------------------------------------------------------------------------------------------

    _kick() {
        if (!this._raf && this._map) this._raf = requestAnimationFrame(this._tick);
    },

    _tick(now) {
        this._raf = 0;
        if (this._zooming) { this._kick(); return; }   // hold the picture while the map zooms; keep the loop alive
        if (this._draw(now)) this._kick();
    },

    // Advances the scan front and the mode, then paints. Returns true while anything is still moving.
    _advance(now) {
        const dt = Math.min(0.064, (now - (this._last ?? now)) / 1000);
        this._last = now;
        const mode = this._mode;
        if (mode === 'scan' || mode === 'settle') {
            const n = this._sorted.length;
            const target = mode === 'settle' ? this._maxD : this._arrived ? this._sorted[Math.min(this._arrived, n) - 1] : 0;
            this._front = Math.max(this._front, this._front + (target - this._front) * (1 - Math.exp(-dt / 0.3)));
            if (mode === 'settle' && this._front > this._maxD - 2) this._front = this._maxD;
            if (mode === 'settle' && this._front === this._maxD && now - (this._lastReveal ?? 0) > HOLD_AFTER_SCAN * 1000) {
                this._mode = 'fade';
                this._fadeStart = now;
            }
        } else if (mode === 'fade' && now - this._fadeStart > FADE_TIME * 1000) {
            this._mode = 'hidden';
            this.options.onSettled?.();
        }
        const settling = this._mode === 'shown' && now - this._showStart < SHOW_TIME * 1000;
        return this._mode === 'scan' || this._mode === 'settle' || this._mode === 'fade' || settling;
    },

    _draw(now) {
        const ctx = this._ctx;
        if (!ctx || !this._map || !this._w) return false;
        const moving = this._advance(now);
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.clearRect(0, 0, this._w, this._h);
        const mode = this._mode;
        if (mode === 'off' || mode === 'hidden' || !this._cells.size) return moving;

        const map = this._map;
        const zoom = map.getZoom();
        const origin = map.getPixelOrigin();
        const ox = -origin.x - this._bounds.min.x, oy = -origin.y - this._bounds.min.y;
        const scanning = mode === 'scan' || mode === 'settle';
        const still = reducedMotion();               // reduced motion: keep the fades, drop the lift and the light band
        const sheenAt = scanning ? (((now - this._t0) / 1000 / SHEEN_PERIOD) % 1) * 1.6 - 0.3 : 0;
        const t = now / 1000;

        for (const cell of this._cells.values()) {
            if (cell.z !== zoom) this._project(cell, zoom);
            const cx = cell.proj[0] + ox, cy = cell.proj[1] + oy;
            if (cx < -60 || cy < -60 || cx > this._w + 60 || cy > this._h + 60) continue;
            const dn = cell.d / this._maxD;

            // How visible the whole cell is (showing / hiding as a wave)
            let visible = 1, lift = 1;
            if (mode === 'fade') visible = 1 - spring(t - this._fadeStart / 1000 - (1 - dn) * WAVE_SPREAD, 1, 0.45);
            else if (mode === 'shown') {
                const s = t - this._showStart / 1000 - dn * WAVE_SPREAD;
                visible = spring(s, 1, 0.5);
                lift = 0.86 + 0.14 * spring(s, 0.62, 0.5);
            }
            if (visible < 0.004) continue;

            // Colour: the front reveals a cell once its prediction is back
            if (scanning && cell.reveal === null && cell.d <= this._front + 1 && (cell.arrive !== null || mode === 'settle')) {
                cell.reveal = now;
                this._lastReveal = now;
            }
            let colour = 0, glass = 0, scale = lift;
            if (scanning || (mode === 'fade' && cell.reveal !== null) || (mode === 'fade' && cell.arrive === null)) {
                const g = spring(t - cell.appearAt / 1000, 1, 0.55);
                const r = cell.reveal === null ? 0 : spring(t - cell.reveal / 1000, 1, 0.55);
                colour = cell.color ? r : 0;
                glass = g * (1 - r);
                scale = cell.reveal === null ? 0.9 + 0.1 * spring(t - cell.appearAt / 1000, 0.7, 0.5)
                    : 0.8 + 0.2 * spring(t - cell.reveal / 1000, 0.55, 0.5);
            } else if (cell.color) {
                colour = 1;
            }

            if (still) scale = 1;
            if (glass > 0.004) {
                const sheen = scanning && !still ? Math.exp(-(((dn - sheenAt) / 0.13) ** 2)) : 0;
                this._path(ctx, cell, ox, oy, scale);
                ctx.globalAlpha = (0.15 + 0.38 * sheen) * glass * visible;
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.globalAlpha = (0.5 + 0.5 * sheen) * glass * visible;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 0.9 + 0.6 * sheen;
                ctx.stroke();
            }
            if (colour > 0.004) {
                this._path(ctx, cell, ox, oy, scale);
                ctx.globalAlpha = COLOR_ALPHA * colour * visible;
                ctx.fillStyle = cell.color;
                ctx.fill();
                ctx.globalAlpha = 0.5 * colour * visible;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 0.6;
                ctx.stroke();
                const crest = 4 * colour * (1 - colour);           // a brief highlight while the colour arrives
                if (crest > 0.02) {
                    ctx.globalAlpha = 0.28 * crest * visible;
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                }
            }
        }
        ctx.globalAlpha = 1;
        return moving;
    },

    _project(cell, zoom) {
        const map = this._map;
        const points = new Float64Array(2 + cell.ring.length * 2);
        const c = map.project(cell.center, zoom);
        points[0] = c.x; points[1] = c.y;
        cell.ring.forEach((latlng, i) => {
            const p = map.project(latlng, zoom);
            points[2 + i * 2] = p.x;
            points[3 + i * 2] = p.y;
        });
        cell.proj = points;
        cell.z = zoom;
    },

    _path(ctx, cell, ox, oy, scale) {
        const p = cell.proj, cx = p[0], cy = p[1];
        ctx.beginPath();
        for (let i = 2; i < p.length; i += 2) {
            const x = cx + (p[i] - cx) * scale + ox, y = cy + (p[i + 1] - cy) * scale + oy;
            if (i === 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
    },
});
