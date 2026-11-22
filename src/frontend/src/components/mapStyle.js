// The "Map" basemap: OpenFreeMap's Liberty vector style (free, no key, OpenStreetMap data) repainted with calm,
// Google-like colours. Every colour here can be changed in Settings > Map colours; each entry lists which layers of the
// style it paints (matched by layer type and id). Place names are text layers, so they can be hidden completely.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const MAP_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> '
    + '© <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
    + 'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const ROAD = '^(road|bridge|tunnel)_';
export const MAP_COLOURS = [
    { key: 'land', name: 'Land', value: '#f1f3f4', targets: [['background', /^background$/, 'background-color']] },
    { key: 'builtUp', name: 'Built-up areas', value: '#eceef0', targets: [['fill', /^landuse_residential$/, 'fill-color']] },
    { key: 'parks', name: 'Parks', value: '#c8e6cd', targets: [
        ['fill', /^(park|landcover_(grass|wood)|landuse_(cemetery|pitch|track))$/, 'fill-color'],
        ['line', /^park_outline$/, 'line-color']] },
    { key: 'water', name: 'Water', value: '#9fd8ef', targets: [
        ['fill', /^water$/, 'fill-color'],
        ['line', /^waterway_(river|other|tunnel)$/, 'line-color']] },
    { key: 'buildings', name: 'Buildings', value: '#e3e5e8', targets: [['fill', /^building$/, 'fill-color']] },
    { key: 'streets', name: 'Streets', value: '#ffffff', targets: [['line', new RegExp(`${ROAD}(minor|service_track|street|path_pedestrian|link)$`), 'line-color']] },
    { key: 'mainRoads', name: 'Main roads', value: '#ffffff', targets: [['line', new RegExp(`${ROAD}(secondary_tertiary|trunk_primary)$`), 'line-color']] },
    { key: 'roadEdges', name: 'Road edges', value: '#d6dae0', targets: [['line', new RegExp(`${ROAD}(?!motorway).*_casing$`), 'line-color']] },
    { key: 'highways', name: 'Highways', value: '#b8c4d6', targets: [['line', new RegExp(`${ROAD}motorway(_link)?$`), 'line-color']] },
    { key: 'highwayEdges', name: 'Highway edges', value: '#9fadc2', targets: [['line', new RegExp(`${ROAD}motorway(_link)?_casing$`), 'line-color']] },
    { key: 'rail', name: 'Railways', value: '#cfd3d8', targets: [['line', /rail/, 'line-color']] },
    { key: 'labels', name: 'Place names', value: '#6f7378', targets: [['symbol', /^(poi_|airport|highway-name|label_)/, 'text-color']] },
    { key: 'waterLabels', name: 'Water names', value: '#5b88c4', targets: [['symbol', /^(water_name|waterway_line_label)/, 'text-color']] },
];
export const DEFAULT_MAP_COLOURS = Object.fromEntries(MAP_COLOURS.map(c => [c.key, c.value]));

// Layers left out: the shaded-relief raster, one-way arrows, 3D buildings
const HIDDEN = /^(natural_earth|road_one_way_arrow.*|building-3d)$/;

// Each layer's colour from the palette, or undefined when no entry paints it
function paintFor(layer, colours) {
    const out = [];
    for (const entry of MAP_COLOURS) {
        for (const [type, match, prop] of entry.targets) {
            if (layer.type === type && match.test(layer.id)) out.push([prop, colours[entry.key] || entry.value]);
        }
    }
    return out;
}
const visibility = (layer, labels) => (HIDDEN.test(layer.id) || (!labels && layer.type === 'symbol') ? 'none' : 'visible');

let stylePromise = null;
// The Liberty style, fetched once
export function loadMapStyle() {
    stylePromise ??= fetch(MAP_STYLE_URL).then(r => {
        if (!r.ok) throw new Error(`Map style ${r.status}`);
        return r.json();
    }).catch(error => { stylePromise = null; throw error; });
    return stylePromise;
}

// A painted copy of the style, for creating the map
export function paintStyle(style, colours = DEFAULT_MAP_COLOURS, labels = true) {
    const copy = structuredClone(style);
    for (const layer of copy.layers) {
        for (const [prop, value] of paintFor(layer, colours)) layer.paint = { ...layer.paint, [prop]: value };
        layer.layout = { ...layer.layout, visibility: visibility(layer, labels) };
    }
    return copy;
}

// Repaint a live MapLibre map (new colours, or place names switched on or off)
export function paintMap(glMap, colours = DEFAULT_MAP_COLOURS, labels = true) {
    if (!glMap) return;
    if (!glMap.isStyleLoaded()) { glMap.once('load', () => paintMap(glMap, colours, labels)); return; }
    for (const layer of glMap.getStyle().layers) {
        for (const [prop, value] of paintFor(layer, colours)) glMap.setPaintProperty(layer.id, prop, value);
        glMap.setLayoutProperty(layer.id, 'visibility', visibility(layer, labels));
    }
}
