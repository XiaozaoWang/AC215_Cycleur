'use client';
// The map: satellite imagery, a calm vector street map (mapStyle.js, colours adjustable) or a plain grey map; place names
// can be hidden on all three. On top: the H3 cells (drawn and animated by HexField), the start and end points and the
// route lines. Route lines are solid colour (light on the dark imagery, deeper on the light maps), grow from start to end
// the first time they appear, and report hover and click so the page can show the route's card above the line.
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { DEFAULT_MAP_COLOURS, MAP_ATTRIBUTION, loadMapStyle, paintMap, paintStyle } from './mapStyle';
import { HexField } from './HexField';
import { ROUTE_EDGES, ROUTE_LINES } from './palette';
import { spring, settleTime, springEasing, reducedMotion } from './spring';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
// street is a vector map whose names are text layers inside it; the raster maps get names from a separate tile layer.
// fallback: the raster map shown if the vector style cannot be loaded.
const BASEMAPS = {
    satellite: { base: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, native: 19, tone: 'dark',
        labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, labelsNative: 18 },
    street: { vector: true, tone: 'light', fallback: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, native: 19 },
    plain: { base: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, native: 16, tone: 'light',
        labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, labelsNative: 16 },
};

const routeKey = r => `${r.kind}:${r.distance_m}:${r.geometry.coordinates.length}`;
const pointKey = p => (p ? `${p.lat},${p.lng}` : '');

// Grow lines from the start of a route to its end: the drawn part of the path follows a critically damped spring (no
// overshoot, so it never runs past the end) and the width settles with a little bounce. The path itself is extended
// frame by frame, so a dashed line is dashed from the first moment. While the map zooms or flies the growth waits:
// redrawing a line mid-flight would place it at the new zoom inside a layer Leaflet is still scaling, so it would
// drift off its start and end. Returns a function that stops the growth.
function grow(map, layers, path, delay) {
    if (reducedMotion() || path.length < 2) return () => {};
    const points = path.map(p => L.latLng(p));
    const along = [0];
    for (let i = 1; i < points.length; i++) along.push(along[i - 1] + points[i - 1].distanceTo(points[i]));
    const total = along[along.length - 1];
    if (!total) return () => {};
    const until = settleTime(1, 0.95) * 1000;
    const start = performance.now() + delay;
    const width = springEasing(0.5, 0.6);
    const partial = p => {
        const reach = p * total;
        let i = 1;
        while (i < points.length - 1 && along[i] < reach) i++;
        const a = points[i - 1], b = points[i], span = along[i] - along[i - 1] || 1;
        const f = Math.max(0, Math.min(1, (reach - along[i - 1]) / span));
        return [...points.slice(0, i), L.latLng(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f)];
    };
    for (const layer of layers) {
        layer.setLatLngs([points[0], points[0]]);
        layer.getElement?.()?.animate?.([{ strokeWidth: `${layer.options.weight * 0.3}px` }, { strokeWidth: `${layer.options.weight}px` }],
            { duration: width.duration, delay: delay + 120, easing: width.easing, fill: 'backwards' });
    }
    let zooming = !!map._animatingZoom, held = 0, last = performance.now();
    const hold = () => { zooming = true; };
    const release = () => { zooming = false; };
    map.on('zoomstart', hold);
    map.on('zoomend', release);
    const finish = () => { map.off('zoomstart', hold); map.off('zoomend', release); };
    let frame = requestAnimationFrame(function step(now) {
        if (zooming) held += now - last;            // time spent waiting does not count toward the growth
        last = now;
        const t = now - start - held;
        const done = t >= until;
        if (!zooming) {
            const line = done ? points : partial(spring(Math.max(0, t) / 1000, 1, 0.95));
            for (const layer of layers) layer.setLatLngs(line);
        }
        if (done && !zooming) { frame = 0; finish(); } else frame = requestAnimationFrame(step);
    });
    return () => { cancelAnimationFrame(frame); finish(); for (const layer of layers) layer.setLatLngs(points); };
}

// A start or end point pops in from a smaller size with a light bounce
function pop(layer) {
    const el = layer.getElement?.();
    if (!el?.animate || reducedMotion()) return;
    el.style.transformBox = 'fill-box';
    el.style.transformOrigin = 'center';
    const s = springEasing(0.55, 0.42);
    el.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: s.duration, easing: s.easing });
}

// scan: {key, cells, route} the cells to scan around the shortest route ([[lat, lng], ...]); a new key starts afresh.
// values: {h3_index: match 0..1 or null}, growing as predictions arrive. heat: off | scan | settle | shown | hidden;
// onHeatSettled(): the scan finished and the heatmap faded by itself.
// points: {origin, destination} as {lat, lng} or null; onPick(latlng): the map was clicked.
// routes: route options (GeoJSON LineStrings, [lon, lat]); selected: the pinned route (drawn on top), chosen: the route
// the conversation is about (the others are dimmed), locked: only the selected route is shown.
// onRouteHover(kind or null, latlng), onRouteSelect(kind, latlng): the pointer is over / clicked a route line, at the
// nearest point on it. overlay(project): HTML drawn over the map; project(latlng) gives the pixel position.
// area: [[south, west], [north, east]] outline of the supported area. focus: {key, points}; the map flies to the points
// each time the key changes. inset: {top, right, bottom, left} pixels covered by panels.
export default function HexMap({
    scan, values, heat, onHeatSettled, colors, points, onPick, routes, selected, chosen, locked, onRouteHover, onRouteSelect,
    adjustable, onPointHover, faded, basemap, labels, mapColours, area, focus, inset, overlay,
}) {
    const container = useRef(null);
    const map = useRef(null);
    const layers = useRef({ base: null, labels: null });
    const field = useRef(null);
    const renderers = useRef({});
    const markers = useRef({ group: null, origin: '', destination: '' });
    const lines = useRef({ group: null, drawn: new Set(), stops: [] });
    const placed = useRef(false);               // the map has a view (set by the first fit or the first focus)
    const latest = useRef({});
    latest.current = { onPick, onHeatSettled, onRouteHover, onRouteSelect, onPointHover, values, heat, inset, colors, labels, mapColours };
    const [view, setView] = useState(0);        // bumps when the map moves, so the overlay follows
    const [zooming, setZooming] = useState(false);

    useEffect(() => {
        // inertiaMaxSpeed: Leaflet works out the fling after a drag from the last pointer moves; when a busy frame
        // squeezes those together the speed comes out huge and a short drag throws the map far away, so cap it
        const m = L.map(container.current, {
            zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, inertiaMaxSpeed: 600, inertiaDeceleration: 3400,
        });
        placed.current = false;                 // a fresh map (also after a remount in development) has no view yet
        m.attributionControl.setPrefix(false);
        // Panes keep the order labels < cells < routes < markers however late each layer is added
        m.createPane('labels').style.zIndex = 300;
        m.getPane('labels').style.pointerEvents = 'none';
        m.createPane('hexes').style.zIndex = 410;
        m.createPane('routes').style.zIndex = 420;
        m.createPane('markers').style.zIndex = 430;
        renderers.current = {
            routes: L.svg({ pane: 'routes', padding: 0.4 }),
            markers: L.svg({ pane: 'markers', padding: 0.4 }),
        };
        field.current = new HexField({ pane: 'hexes', onSettled: () => latest.current.onHeatSettled?.(), ...(latest.current.colors && { colorFor: latest.current.colors }) }).addTo(m);
        map.current = m;
        m.on('click', e => latest.current.onPick?.(e.latlng));
        let frame = 0;
        const bump = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setView(v => v + 1); }); };
        m.on('move zoom viewreset resize', bump);
        m.on('zoomanim', () => setZooming(true));
        m.on('zoomend', () => { setZooming(false); bump(); });
        // Re-measure when the window changes, and show the whole supported area the first time the map has a size
        // (unless a route was already focused)
        const observer = new ResizeObserver(() => {
            m.invalidateSize();
            if (!placed.current && area && container.current.clientWidth) {
                const i = latest.current.inset || {};
                m.fitBounds(area, { paddingTopLeft: [i.left ?? 0, i.top ?? 0], paddingBottomRight: [i.right ?? 0, i.bottom ?? 0] });
                placed.current = true;
                bump();
            }
        });
        observer.observe(container.current);
        if (area) L.rectangle(area, { color: '#ffffff', weight: 1.5, opacity: 0.7, dashArray: '6 8', fill: false, interactive: false }).addTo(m);
        return () => { cancelAnimationFrame(frame); observer.disconnect(); m.remove(); map.current = null; placed.current = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The basemap. The vector map is painted with the chosen colours before it is created (so it never flashes the
    // style's own colours); if its style cannot be loaded, the raster street map stands in.
    useEffect(() => {
        const m = map.current;
        if (!m) return undefined;
        const style = BASEMAPS[basemap] || BASEMAPS.satellite;
        let cancelled = false;
        layers.current.base?.remove();
        layers.current.base = null;
        const raster = url => {
            layers.current.base = L.tileLayer(url, { maxNativeZoom: style.native, maxZoom: 19, attribution: 'Imagery © Esri' }).addTo(m);
            layers.current.base.bringToBack();
        };
        if (!style.vector) raster(style.base);
        else {
            loadMapStyle().then(json => {
                if (cancelled || map.current !== m) return;
                const { mapColours: colours, labels: names } = latest.current;
                layers.current.base = maplibreGL({ style: paintStyle(json, colours || DEFAULT_MAP_COLOURS, !!names), attribution: MAP_ATTRIBUTION }).addTo(m);
                layers.current.base.vector = true;
            }, () => { if (!cancelled && map.current === m) raster(style.fallback); });
        }
        return () => { cancelled = true; };
    }, [basemap]);

    // Place names: the vector map hides its text layers; the raster maps add or drop a label tile layer
    useEffect(() => {
        const m = map.current;
        if (!m) return;
        layers.current.labels?.remove();
        layers.current.labels = null;
        const style = BASEMAPS[basemap] || BASEMAPS.satellite;
        const base = layers.current.base;
        if (base?.vector) paintMap(base.getMaplibreMap(), mapColours || DEFAULT_MAP_COLOURS, !!labels);
        if (!labels || !style.labels) return;
        layers.current.labels = L.tileLayer(style.labels, { pane: 'labels', maxNativeZoom: style.labelsNative, maxZoom: 19 }).addTo(m);
    }, [basemap, labels, mapColours]);

    // The cells: a new scan replaces them; predictions colour them; the heat mode drives the animation
    useEffect(() => {
        field.current?.setScan(scan);
        field.current?.setValues(latest.current.values || {});
        field.current?.setMode(latest.current.heat);
    }, [scan?.key]);  // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { field.current?.setValues(values || {}); }, [values]);
    useEffect(() => { field.current?.setMode(heat); }, [heat]);
    useEffect(() => { field.current?.setColors(colors); }, [colors]);

    // A panel opening on the left (or closing) shifts the open part of the map: slide the map by half as much, so what
    // was in the middle of the open part stays in its middle. If the same change also flies to a route (which already
    // frames it in the open part), the slide is skipped: two camera moves at once make the map judder.
    const insetLeft = inset?.left ?? 0;
    const lastLeft = useRef(insetLeft);
    const flewAt = useRef(0);
    useEffect(() => {
        const m = map.current, shift = insetLeft - lastLeft.current;
        lastLeft.current = insetLeft;
        if (!m || !placed.current || !m._loaded || Math.abs(shift) < 1) return undefined;
        const frame = requestAnimationFrame(() => {
            if (performance.now() - flewAt.current < 150) return;
            m.panBy([-shift / 2, 0], reducedMotion() ? { animate: false } : { duration: 0.6, easeLinearity: 0.2 });
        });
        return () => cancelAnimationFrame(frame);
    }, [insetLeft]);

    useEffect(() => {
        const m = map.current;
        if (!m) return;
        const previous = markers.current;
        previous.group?.remove();
        const dot = (p, color) => L.circleMarker(p, {
            pane: 'markers', renderer: renderers.current.markers, radius: 6.5, color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 1, interactive: false,
        });
        const origin = points?.origin && dot(points.origin, ROUTE_LINES.light.shortest);
        const destination = points?.destination && dot(points.destination, ROUTE_LINES.light.preferred);
        // Once both points are set, a wider invisible circle over each reports the pointer (for its "Adjust" button)
        const hits = adjustable ? [['origin', points?.origin], ['destination', points?.destination]].filter(([, p]) => p).map(([which, p]) => {
            const hit = L.circleMarker(p, { pane: 'markers', renderer: renderers.current.markers, radius: 15, stroke: false, fillOpacity: 0, interactive: true, bubblingMouseEvents: false });
            hit.on('mouseover click', () => latest.current.onPointHover?.(which, p));
            hit.on('mouseout', () => latest.current.onPointHover?.(null));
            return hit;
        }) : [];
        const group = L.layerGroup([origin, destination, ...hits].filter(Boolean)).addTo(m);
        if (origin && pointKey(points.origin) !== previous.origin) pop(origin);
        if (destination && pointKey(points.destination) !== previous.destination) pop(destination);
        markers.current = { group, origin: pointKey(points?.origin), destination: pointKey(points?.destination) };
    }, [points, adjustable]);

    // Route lines: a solid line (the shortest route dashed) and a wide invisible line on top that catches the pointer.
    // On the dark satellite imagery each line also gets a dark edge underneath so it stands out, as Google draws routes.
    // The selected route is drawn last, on top; routes not seen before grow in one after another.
    useEffect(() => {
        const m = map.current;
        if (!m) return;
        const state = lines.current;
        state.stops.forEach(stop => stop());
        state.stops = [];
        state.group?.remove();
        state.group = null;
        if (!routes?.length) { state.drawn.clear(); return; }
        const tone = (BASEMAPS[basemap] || BASEMAPS.satellite).tone;
        const palette = ROUTE_LINES[tone];
        const shown = locked ? routes.filter(r => r.kind === selected) : routes;
        const ordered = [...shown].sort((a, b) => (a.kind === selected) - (b.kind === selected));
        const group = L.layerGroup().addTo(m);
        const fresh = [];
        for (const r of ordered) {
            const path = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
            const on = r.kind === selected && !faded;
            const dim = faded || (chosen && r.kind !== chosen);
            const weight = on ? 6 : 4.25;
            const dashed = r.kind === 'shortest';     // the base route: plain square-ended dashes
            const edge = tone === 'dark' && L.polyline(path, {
                pane: 'routes', renderer: renderers.current.routes, lineCap: 'round', lineJoin: 'round', interactive: false,
                color: ROUTE_EDGES[r.kind], weight: weight + 3.5, opacity: dim ? 0.25 : r.kind === 'shortest' ? 0.6 : 0.95,
            }).addTo(group);
            const line = L.polyline(path, {
                pane: 'routes', renderer: renderers.current.routes, lineCap: dashed ? 'butt' : 'round', lineJoin: dashed ? 'miter' : 'round', interactive: false,
                color: palette[r.kind], weight, opacity: dim ? 0.35 : on ? 1 : 0.85, dashArray: dashed ? (on ? '12 7' : '9 6') : undefined,
            }).addTo(group);
            const hit = L.polyline(path, {
                pane: 'routes', renderer: renderers.current.routes, color: '#000000', weight: 22, opacity: 0, interactive: true, bubblingMouseEvents: false,
            }).addTo(group);
            const nearest = latlng => {
                const p = m.latLngToLayerPoint(latlng);
                let best = null, bestD = Infinity;
                for (let i = 1; i < path.length; i++) {
                    const q = L.LineUtil.closestPointOnSegment(p, m.latLngToLayerPoint(path[i - 1]), m.latLngToLayerPoint(path[i]));
                    const d = q.distanceTo(p);
                    if (d < bestD) { bestD = d; best = q; }
                }
                return best ? m.layerPointToLatLng(best) : latlng;
            };
            hit.on('mouseover', e => latest.current.onRouteHover?.(r.kind, nearest(e.latlng)));
            hit.on('mouseout', () => latest.current.onRouteHover?.(null));
            hit.on('click', e => latest.current.onRouteSelect?.(r.kind, nearest(e.latlng)));
            if (!state.drawn.has(routeKey(r))) fresh.push([r, path, [edge, line].filter(Boolean)]);
        }
        // Grow in route order (shortest first), a short beat apart
        const order = ['shortest', 'efficient', 'balanced', 'preferred'];
        fresh.sort((a, b) => order.indexOf(a[0].kind) - order.indexOf(b[0].kind)).forEach(([r, path, drawn], i) => {
            state.stops.push(grow(m, drawn, path, i * 110));
            state.drawn.add(routeKey(r));
        });
        state.group = group;
    }, [routes, selected, chosen, locked, basemap, faded]);

    // Fly to the routes, keeping them clear of the panels
    useEffect(() => {
        const m = map.current;
        if (!m || !focus?.points?.length) return;
        const i = latest.current.inset || {};
        const options = { paddingTopLeft: [(i.left ?? 0) + 40, (i.top ?? 0) + 40], paddingBottomRight: [(i.right ?? 0) + 40, (i.bottom ?? 0) + 40] };
        const bounds = L.latLngBounds(focus.points);
        flewAt.current = performance.now();
        // Flying needs a current view and a size; the very first placement (a ride opened while the map loads) jumps there
        const size = m.getSize();
        if (!placed.current || !m._loaded || !size.x || !size.y || reducedMotion()) m.fitBounds(bounds, { ...options, animate: false });
        else {
            // flyTo divides by the distance it travels, so for a target at the same centre it just zooms instead
            const target = m._getBoundsCenterZoom(bounds, options);
            const far = m.project(m.getCenter()).distanceTo(m.project(target.center)) > 2;
            if (far) m.flyToBounds(bounds, { ...options, duration: 0.9, easeLinearity: 0.35 });
            else m.fitBounds(bounds, { ...options, animate: true });
        }
        placed.current = true;
    }, [focus?.key]);  // eslint-disable-line react-hooks/exhaustive-deps

    // Pixel position of a point on the map, for the overlay (null until the map has a view)
    const project = useCallback(latlng => {
        if (!placed.current || !map.current || !latlng) return null;
        return map.current.latLngToContainerPoint(latlng);
    }, [view]);  // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="map-wrap">
            <div ref={container} className="map" />
            <div className={zooming ? 'map-overlay zooming' : 'map-overlay'}>{overlay?.(project)}</div>
        </div>
    );
}
