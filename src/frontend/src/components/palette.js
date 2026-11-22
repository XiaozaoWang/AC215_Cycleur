// The app's colours: pink and blue, the same family as the aurora behind the conversation.

// Route lines on the map. The shortest route is the neutral base (drawn dashed); the others go from pale to deep pink
// the more closely they follow the wish. Satellite imagery is dark, so lines there are light; the street and plain maps
// are light, so lines there are deeper.
export const ROUTE_LINES = {
    dark: { shortest: '#ffffff', efficient: '#ffe0ec', balanced: '#ffb8d6', preferred: '#ff8dbf' },
    light: { shortest: '#7c7c84', efficient: '#f2a3c6', balanced: '#e5679f', preferred: '#cc2f78' },
};
// The edge drawn under each line on the dark imagery: a deeper, more saturated shade of the line's own colour (the
// shortest route, white and dashed, gets a dark grey edge)
export const ROUTE_EDGES = { shortest: '#2a2c31', efficient: '#e2599a', balanced: '#cc3a82', preferred: '#b3175f' };
// Route colours in the interface (card swatches, the list in the conversation): readable on white
export const ROUTE_COLORS = ROUTE_LINES.light;
export const ROUTE_LABELS = { shortest: 'Shortest', efficient: 'Efficient', balanced: 'Balanced', preferred: 'Best match' };

// ---- Cell colours (poor match -> good match) -------------------------------------------------------------------
// Two built-in schemes and a custom one:
//   aurora   blue -> lavender -> pink, the app's own colours
//   viridis  purple -> teal -> yellow, the classic scale the first version used (and the data-labeler still uses)
//   custom   any three colours for poor, middle and good, blended in between
// makeScale(scheme) turns a scheme into {color(value), gradient}; value is the match in [0, 1], null means no score.

// Viridis: 256 colours from purple (0) to yellow (1), the same table as the data-labeler's label map
const VIRIDIS = ['#440154', '#440256', '#450457', '#450559', '#46075a', '#46085c', '#460a5d', '#460b5e', '#470d60', '#470e61', '#471063', '#471164', '#471365', '#481467', '#481668', '#481769', '#48186a', '#481a6c', '#481b6d', '#481c6e', '#481d6f', '#481f70', '#482071', '#482173', '#482374', '#482475', '#482576', '#482677', '#482878', '#482979', '#472a7a', '#472c7a', '#472d7b', '#472e7c', '#472f7d', '#46307e', '#46327e', '#46337f', '#463480', '#453581', '#453781', '#453882', '#443983', '#443a83', '#443b84', '#433d84', '#433e85', '#423f85', '#424086', '#424186', '#414287', '#414487', '#404588', '#404688', '#3f4788', '#3f4889', '#3e4989', '#3e4a89', '#3e4c8a', '#3d4d8a', '#3d4e8a', '#3c4f8a', '#3c508b', '#3b518b', '#3b528b', '#3a538b', '#3a548c', '#39558c', '#39568c', '#38588c', '#38598c', '#375a8c', '#375b8d', '#365c8d', '#365d8d', '#355e8d', '#355f8d', '#34608d', '#34618d', '#33628d', '#33638d', '#32648e', '#32658e', '#31668e', '#31678e', '#31688e', '#30698e', '#306a8e', '#2f6b8e', '#2f6c8e', '#2e6d8e', '#2e6e8e', '#2e6f8e', '#2d708e', '#2d718e', '#2c718e', '#2c728e', '#2c738e', '#2b748e', '#2b758e', '#2a768e', '#2a778e', '#2a788e', '#29798e', '#297a8e', '#297b8e', '#287c8e', '#287d8e', '#277e8e', '#277f8e', '#27808e', '#26818e', '#26828e', '#26828e', '#25838e', '#25848e', '#25858e', '#24868e', '#24878e', '#23888e', '#23898e', '#238a8d', '#228b8d', '#228c8d', '#228d8d', '#218e8d', '#218f8d', '#21908d', '#21918c', '#20928c', '#20928c', '#20938c', '#1f948c', '#1f958b', '#1f968b', '#1f978b', '#1f988b', '#1f998a', '#1f9a8a', '#1e9b8a', '#1e9c89', '#1e9d89', '#1f9e89', '#1f9f88', '#1fa088', '#1fa188', '#1fa187', '#1fa287', '#20a386', '#20a486', '#21a585', '#21a685', '#22a785', '#22a884', '#23a983', '#24aa83', '#25ab82', '#25ac82', '#26ad81', '#27ad81', '#28ae80', '#29af7f', '#2ab07f', '#2cb17e', '#2db27d', '#2eb37c', '#2fb47c', '#31b57b', '#32b67a', '#34b679', '#35b779', '#37b878', '#38b977', '#3aba76', '#3bbb75', '#3dbc74', '#3fbc73', '#40bd72', '#42be71', '#44bf70', '#46c06f', '#48c16e', '#4ac16d', '#4cc26c', '#4ec36b', '#50c46a', '#52c569', '#54c568', '#56c667', '#58c765', '#5ac864', '#5cc863', '#5ec962', '#60ca60', '#63cb5f', '#65cb5e', '#67cc5c', '#69cd5b', '#6ccd5a', '#6ece58', '#70cf57', '#73d056', '#75d054', '#77d153', '#7ad151', '#7cd250', '#7fd34e', '#81d34d', '#84d44b', '#86d549', '#89d548', '#8bd646', '#8ed645', '#90d743', '#93d741', '#95d840', '#98d83e', '#9bd93c', '#9dd93b', '#a0da39', '#a2da37', '#a5db36', '#a8db34', '#aadc32', '#addc30', '#b0dd2f', '#b2dd2d', '#b5de2b', '#b8de29', '#bade28', '#bddf26', '#c0df25', '#c2df23', '#c5e021', '#c8e020', '#cae11f', '#cde11d', '#d0e11c', '#d2e21b', '#d5e21a', '#d8e219', '#dae319', '#dde318', '#dfe318', '#e2e418', '#e5e419', '#e7e419', '#eae51a', '#ece51b', '#efe51c', '#f1e51d', '#f4e61e', '#f6e620', '#f8e621', '#fbe723', '#fde725'];

export const SCHEMES = {
    aurora: { name: 'Aurora', stops: ['#3d6bff', '#b696ff', '#ff4fa0'] },
    viridis: { name: 'Viridis', stops: [VIRIDIS[0], VIRIDIS[128], VIRIDIS[255]], table: VIRIDIS },
};
export const DEFAULT_CUSTOM = { poor: '#2f6bff', middle: '#f4f1ea', good: '#ff7a3d' };
const NO_SCORE = '#c7c8d1';

const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const isHex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// 101 colours blended through three stops (poor, middle, good)
function blend(stops) {
    const [a, m, b] = stops.map(toRgb);
    return Array.from({ length: 101 }, (_, i) => {
        const t = i / 100;
        const [from, to, f] = t <= 0.5 ? [a, m, t / 0.5] : [m, b, (t - 0.5) / 0.5];
        return `rgb(${from.map((v, j) => Math.round(v + (to[j] - v) * f)).join(', ')})`;
    });
}

// scheme: {id: 'aurora' | 'viridis' | 'custom', custom: {poor, middle, good}}
export function makeScale(scheme = { id: 'aurora' }) {
    let table, stops;
    if (scheme.id === 'viridis') {
        table = SCHEMES.viridis.table;
        stops = [0, 32, 64, 96, 128, 160, 192, 224, 255].map(i => table[i]);
    } else {
        const c = { ...DEFAULT_CUSTOM, ...scheme.custom };
        stops = scheme.id === 'custom' && [c.poor, c.middle, c.good].every(isHex) ? [c.poor, c.middle, c.good] : SCHEMES.aurora.stops;
        table = blend(stops);
    }
    const last = table.length - 1;
    return {
        color: value => (value === null || value === undefined ? NO_SCORE : table[Math.round(Math.max(0, Math.min(1, value)) * last)]),
        gradient: `linear-gradient(to right, ${stops.join(', ')})`,
    };
}

// The default scale, for code that does not follow the setting
export const matchColor = makeScale().color;
