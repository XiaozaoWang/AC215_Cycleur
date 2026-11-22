'use client';
// The whole page: a full-screen map. Left: the sidebar with the rides (each ride is one conversation) and settings, and
// next to it a floating panel with the ride's conversation, written as plain text over a soft aurora. Both push the
// message box and the map to the right as they open. Routes carry their own details: hover a line to see them, click it
// to pin its card, and from the pinned card lock the route or choose it.
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import DataService from '@/services/DataService';
import Composer from '@/components/Composer';
import ConversationPanel, { resultSummary } from '@/components/ConversationPanel';
import PointMenu from '@/components/PointMenu';
import RouteInfo from '@/components/RouteInfo';
import HomeScreen from '@/components/Home';
import Sidebar from '@/components/Sidebar';
import { Icon } from '@/components/icons';
import { DEFAULT_CUSTOM, ROUTE_LABELS, makeScale } from '@/components/palette';
import { DEFAULT_MAP_COLOURS } from '@/components/mapStyle';

// Leaflet needs the browser's window, so the map is only rendered in the browser
const HexMap = dynamic(() => import('@/components/HexMap'), { ssr: false });

// Outline of the supported area, [[south, west], [north, east]]: the bounding box of the Boston road graph
const AREA = [[42.3309, -71.1224], [42.3815, -71.0522]];
const inArea = ({ lat, lng }) => lat >= AREA[0][0] && lat <= AREA[1][0] && lng >= AREA[0][1] && lng <= AREA[1][1];
const toLatLng = routes => routes.flatMap(r => r.geometry.coordinates.map(([lon, lat]) => [lat, lon]));

const RIDES_KEY = 'cycleur-rides-v2';
const WIDTH_KEY = 'cycleur-sidebar-width';
const SCHEME_KEY = 'cycleur-cell-colours';
const MAP_COLOURS_KEY = 'cycleur-map-colours';
const MAX_RIDES = 20;
const SIDE_DEFAULT = 272, SIDE_MIN = 220, SIDE_MAX = 420, SIDE_RAIL = 60, SIDE_COLLAPSE = 150;   // narrower than SIDE_COLLAPSE on release: rail
const BASEMAP_NAMES = [['satellite', 'Satellite'], ['street', 'Map'], ['plain', 'Plain']];
// Past the ends of the drag range the sidebar follows less and less, like a rubber band
const rubber = (over, size = 120) => (over * size * 0.55) / (size + 0.55 * Math.abs(over));
const newId = () => `ride-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : newId());
const panelWidth = () => Math.min(420, Math.max(340, window.innerWidth * 0.28));   // matches --panel-w in the CSS
const PANEL_GAP = 12;                                                                 // the panel floats this far from the edges

// A point about halfway along a route: where its card is pinned when the results arrive
function middleOf(route) {
    const c = route.geometry.coordinates;
    const [lon, lat] = c[Math.floor(c.length / 2)];
    return { lat, lng: lon };
}

export default function Home() {
    // The ride on screen. A ride starts with two taps on the map and a description; later messages are questions.
    const [rideId, setRideId] = useState(null);
    const rideRef = useRef(null);
    rideRef.current = rideId;
    const [points, setPoints] = useState({ origin: null, destination: null });
    const [phase, setPhase] = useState('idle');              // idle (picking points) | planning | ready | running | done
    const [plan, setPlan] = useState(null);                  // {shortest, cells}
    const [values, setValues] = useState({});                // H3 cell -> match (0 poor .. 1 good, null = no score)
    const collected = useRef({});                            // the same values, readable from inside the stream callback
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [understood, setUnderstood] = useState(null);      // the preference event: what Gemini understood
    const [expand, setExpand] = useState(null);              // the latest expand event: the search allowed longer routes
    const [result, setResult] = useState(null);
    const [asked, setAsked] = useState('');                  // the description the routes were planned for
    const [thinking, setThinking] = useState(null);          // {start, end} of the route planning, for "Thought for 8s"
    const [failure, setFailure] = useState('');              // the route planning failed
    const [message, setMessage] = useState('');              // a hint shown at the top of the map (wrong tap, no route)
    const [focus, setFocus] = useState(null);
    const job = useRef({ id: 0, abort: null });

    // Route cards: the pinned (selected) route and where its card sits, the route under the pointer, and the route the
    // conversation follows. Locked: only the selected route stays on the map.
    const [selected, setSelected] = useState(null);
    const [pin, setPin] = useState(null);                    // {latlng, delay}
    const [hover, setHover] = useState(null);                // {kind, latlng}
    const [chosen, setChosen] = useState(null);
    const [locked, setLocked] = useState(false);

    // Follow-up conversation. The assistant API answers each question on its own; the chosen route is kept with the
    // ride so the coming agent can use it.
    const [messages, setMessages] = useState([]);
    // Earlier turns of this ride (a description and its result, or questions and answers), kept when the ride is
    // described again or its points are moved
    const [history, setHistory] = useState([]);
    // Moving the start or the destination: the point being moved ('origin' / 'destination'), and the point under the
    // pointer whose "Adjust" button is showing
    const [adjusting, setAdjusting] = useState(null);
    const [pointHover, setPointHover] = useState(null);
    const pointTimer = useRef(0);
    // Bumps when a route is locked or chosen: the message box ripples once, and from then on messages are questions
    const [pulse, setPulse] = useState(0);
    const [pending, setPending] = useState(false);
    const [text, setText] = useState('');
    // The home screen (view 'home') or the map (view 'map'). A ride described on the home screen waits in pendingAsk
    // until its start and destination are tapped, then it is planned.
    const [view, setView] = useState('home');
    const [homeText, setHomeText] = useState('');
    const [pendingAsk, setPendingAsk] = useState('');

    // The cells on the map. heat: off | scan (predicting) | settle (done, fading by itself) | hidden | shown (toggle)
    const [heat, setHeat] = useState('off');
    const [scanKey, setScanKey] = useState(null);
    const [basemap, setBasemap] = useState('satellite');
    const [labels, setLabels] = useState(true);
    // Cell colours: {id: aurora | viridis | custom, custom: {poor, middle, good}}
    const [scheme, setScheme] = useState({ id: 'aurora', custom: DEFAULT_CUSTOM });
    const scale = useMemo(() => makeScale(scheme), [scheme]);
    // Colours of the Map basemap, one per kind of feature (mapStyle.js)
    const [mapColours, setMapColours] = useState(DEFAULT_MAP_COLOURS);
    const composerInput = useRef(null);

    // Layout. sidebarOpen is null until the screen size is known (CSS decides meanwhile). The sidebar's width can be
    // dragged; the conversation on the right can be hidden.
    const [sidebarOpen, setSidebarOpen] = useState(null);
    const [sideWidth, setSideWidth] = useState(SIDE_DEFAULT);
    const [resizing, setResizing] = useState(false);
    const [convoHidden, setConvoHidden] = useState(false);
    const appRef = useRef(null);
    const [narrow, setNarrow] = useState(false);
    const [panelW, setPanelW] = useState(380);
    const sideOpen = sidebarOpen ?? !narrow;

    const [rides, setRides] = useState([]);
    const [ridesLoaded, setRidesLoaded] = useState(false);

    // Light around the message box while the app works: 'on' springs in and turns, 'settle' swells once and fades
    const busy = phase === 'running' || pending;
    const [glow, setGlow] = useState('off');
    useEffect(() => {
        if (busy) setGlow('on');
        else setGlow(g => (g === 'on' ? 'settle' : g));
    }, [busy]);
    useEffect(() => {
        if (glow !== 'settle') return undefined;
        const t = setTimeout(() => setGlow('off'), 900);
        return () => clearTimeout(t);
    }, [glow]);

    useEffect(() => {
        setRideId(newId());
        const phone = window.matchMedia('(max-width: 600px)');
        const apply = () => { setNarrow(phone.matches); setSidebarOpen(!phone.matches); };
        const resize = () => setPanelW(panelWidth());
        apply();
        resize();
        phone.addEventListener('change', apply);
        window.addEventListener('resize', resize);
        try {
            const width = Number(localStorage.getItem(WIDTH_KEY));
            if (width >= SIDE_MIN && width <= SIDE_MAX) setSideWidth(width);
            const painted = JSON.parse(localStorage.getItem(MAP_COLOURS_KEY) || 'null');
            if (painted && typeof painted === 'object') setMapColours({ ...DEFAULT_MAP_COLOURS, ...painted });
            const colours = JSON.parse(localStorage.getItem(SCHEME_KEY) || 'null');
            if (colours && ['aurora', 'viridis', 'custom'].includes(colours.id)) setScheme({ id: colours.id, custom: { ...DEFAULT_CUSTOM, ...colours.custom } });
            const saved = JSON.parse(localStorage.getItem(RIDES_KEY) || '[]');
            if (Array.isArray(saved)) setRides(saved.filter(r => r?.id && typeof r.text === 'string'));
        } catch { /* no saved rides */ }
        setRidesLoaded(true);
        return () => { phone.removeEventListener('change', apply); window.removeEventListener('resize', resize); };
    }, []);

    useEffect(() => {
        if (!ridesLoaded) return;
        try { localStorage.setItem(RIDES_KEY, JSON.stringify(rides)); } catch { /* storage full or blocked: keep them in memory */ }
    }, [rides, ridesLoaded]);

    useEffect(() => {
        if (!ridesLoaded) return;
        try { localStorage.setItem(WIDTH_KEY, String(sideWidth)); } catch { /* not kept */ }
    }, [sideWidth, ridesLoaded]);

    useEffect(() => {
        if (!ridesLoaded) return;
        try { localStorage.setItem(SCHEME_KEY, JSON.stringify(scheme)); } catch { /* not kept */ }
    }, [scheme, ridesLoaded]);

    useEffect(() => {
        if (!ridesLoaded) return;
        try { localStorage.setItem(MAP_COLOURS_KEY, JSON.stringify(mapColours)); } catch { /* not kept */ }
    }, [mapColours, ridesLoaded]);

    // Drag the sidebar's edge: it follows the pointer 1:1 (no animation while dragging), resists past the ends, and on
    // release either settles at the new width or, dragged most of the way closed, springs into the icon rail.
    function startResize(event) {
        if (narrow || event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const startW = sideOpen ? sideWidth : SIDE_RAIL;
        const app = appRef.current;
        let width = startW;
        setResizing(true);
        const move = e => {
            const raw = startW + e.clientX - startX;
            width = raw > SIDE_MAX ? SIDE_MAX + rubber(raw - SIDE_MAX) : raw < SIDE_RAIL ? SIDE_RAIL - rubber(SIDE_RAIL - raw, 40) : raw;
            app.style.setProperty('--left', `${width}px`);
            app.dataset.side = width < SIDE_COLLAPSE ? 'closed' : 'open';
        };
        const end = () => {
            handle.removeEventListener('pointermove', move);
            const open = width >= SIDE_COLLAPSE;
            app.dataset.side = open ? 'open' : 'closed';      // React only writes the attribute when its value changes
            app.style.removeProperty('--left');
            setResizing(false);
            setSidebarOpen(open);
            if (open) setSideWidth(Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, width))));
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end, { once: true });
        handle.addEventListener('pointercancel', end, { once: true });
    }

    function resizeByKey(event) {
        const step = event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0;
        if (!step) return;
        event.preventDefault();
        if (!sideOpen) { if (step > 0) setSidebarOpen(true); return; }
        const next = sideWidth + step;
        if (next < SIDE_MIN) setSidebarOpen(false);
        else setSideWidth(Math.min(SIDE_MAX, next));
    }

    // Keep the ride on screen in the history once it has something to show (not while the routes are being planned)
    useEffect(() => {
        if (!rideId || (!asked && !messages.length && !history.length) || phase === 'running' || phase === 'planning') return;
        const ride = {
            id: rideId, at: Date.now(), text: history.find(m => m.role === 'user')?.text || asked || messages.find(m => m.role === 'user')?.text || 'Ride',
            points, plan, result, values: result ? collected.current : {}, understood, expand, thinking,
            selected, chosen, locked, messages: messages.filter(m => !m.error), history, asked,
        };
        setRides(list => {
            // Opening an earlier ride keeps its place in the list; new routes or messages move it to the top
            const before = list.find(r => r.id === rideId);
            const grew = !before || before.result !== ride.result || (before.messages?.length ?? 0) !== ride.messages.length
                || (before.history?.length ?? 0) !== ride.history.length;
            const saved = { ...ride, at: grew ? ride.at : before.at };
            return [saved, ...list.filter(r => r.id !== rideId)].sort((x, y) => y.at - x.at).slice(0, MAX_RIDES);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rideId, asked, result, messages, history, selected, chosen, locked, phase]);

    // Locking or choosing a route turns the message box from "describe a ride" into "ask about this route": ripple once
    const talking = !!(locked || chosen);
    const wasTalking = useRef(false);
    useEffect(() => {
        if (talking && !wasTalking.current) setPulse(n => n + 1);
        wasTalking.current = talking;
    }, [talking]);

    // Esc stops moving a point
    useEffect(() => {
        if (!adjusting) return undefined;
        const key = e => { if (e.key === 'Escape') setAdjusting(null); };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [adjusting]);

    function nextJob() {
        job.current.abort?.abort();
        job.current = { id: job.current.id + 1, abort: new AbortController() };
        return job.current;
    }

    // Clear the ride on screen (the history keeps it)
    function clearRide() {
        nextJob();
        collected.current = {};
        setPoints({ origin: null, destination: null }); setPhase('idle'); setPlan(null); setValues({});
        setProgress({ done: 0, total: 0 }); setUnderstood(null); setExpand(null); setResult(null); setAsked('');
        setThinking(null); setFailure(''); setMessage(''); setSelected(null); setPin(null); setHover(null);
        setChosen(null); setLocked(false); setMessages([]); setPending(false); setHeat('off'); setScanKey(null);
        setConvoHidden(false); setPendingAsk(''); setHistory([]); setAdjusting(null); setPointHover(null);
    }

    // Move the current turn (description and result, and any questions) into the history, before a new one starts
    function archiveTurn() {
        const items = [];
        if (asked) items.push({ id: uid(), role: 'user', text: asked });
        if (result) items.push({ id: uid(), role: 'assistant', text: resultSummary(result) });
        else if (failure) items.push({ id: uid(), role: 'assistant', text: failure, error: true });
        items.push(...messages.filter(m => !m.error));
        if (items.length) setHistory(list => [...list, ...items]);
        setMessages([]);
    }

    function newRide() {
        clearRide();
        setText('');
        setRideId(newId());
        setView('map');
        if (narrow) setSidebarOpen(false);
    }

    // The Cycleur logo: back to the home screen with a fresh ride
    function goHome() {
        newRide();
        setHomeText('');
        setView('home');
    }

    // A ride described on the home screen: open the map and wait for the two taps
    function startFromHome(description) {
        newRide();
        setHomeText('');
        setPendingAsk(description);
    }

    // The two taps are done and the shortest route is in: plan the ride that was described on the home screen
    useEffect(() => {
        if (phase !== 'ready' || !pendingAsk || asked || !plan) return;
        const description = pendingAsk;
        setPendingAsk('');
        planRoutes(description);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, plan, pendingAsk]);

    function restore(ride) {
        clearRide();
        setView('map');
        const current = job.current;
        collected.current = ride.values || {};
        setRideId(ride.id);
        setPoints(ride.points || { origin: null, destination: null });
        setPlan(ride.plan || null);
        setValues(collected.current);
        setUnderstood(ride.understood || null);
        setExpand(ride.expand || null);
        setResult(ride.result || null);
        setAsked(ride.result ? (ride.asked ?? ride.text) : '');
        setThinking(ride.thinking || null);
        setMessages(ride.messages || []);
        setHistory(ride.history || []);
        setChosen(ride.chosen || null);
        setLocked(!!ride.locked);
        if (ride.result) {
            const kind = ride.selected || ride.result.recommended;
            setSelected(kind);
            const route = ride.result.routes.find(r => r.kind === kind);
            if (route) setPin({ latlng: middleOf(route), delay: 700 });
            setPhase('done');
            setHeat('hidden');
            setScanKey(`ride-${current.id}`);
            setFocus({ key: `ride-${current.id}`, points: toLatLng(ride.result.routes) });
        } else if (ride.plan) {
            setPhase('ready');
            setFocus({ key: `ride-${current.id}`, points: toLatLng([ride.plan.shortest]) });
        }
        if (narrow) setSidebarOpen(false);
    }

    // Two taps set the start and the destination. After that a tap only matters while a point is being moved (its
    // "Adjust" button); a new ride starts from the sidebar.
    async function pickPoint(latlng) {
        if (adjusting) { movePoint(adjusting, latlng); return; }
        if (phase !== 'idle' || points.destination) return;
        if (!inArea(latlng)) { setMessage('Tap inside the dashed outline: that is the area we cover.'); return; }
        setMessage('');
        if (!points.origin) { setPoints({ origin: latlng, destination: null }); return; }
        const current = nextJob();
        setPoints({ ...points, destination: latlng });
        setPhase('planning');
        try {
            const planned = await DataService.RoutePlan({
                origin: { lat: points.origin.lat, lon: points.origin.lng },
                destination: { lat: latlng.lat, lon: latlng.lng },
            }, current.abort.signal);
            if (current.id !== job.current.id) return;
            setPlan(planned);
            setFocus({ key: `plan-${current.id}`, points: toLatLng([planned.shortest]) });
            setPhase('ready');
        } catch (error) {
            if (current.id !== job.current.id) return;
            setPoints({ origin: points.origin, destination: null });
            setPhase('idle');
            setMessage(error.status === 422 ? 'No route between those two spots. Try another pair.' : 'Could not plan a route. Please try again.');
        }
    }

    // Move the start or the destination: the earlier turn goes to the history and a new shortest route is planned
    async function movePoint(which, latlng) {
        if (!inArea(latlng)) { setMessage('Tap inside the dashed outline: that is the area we cover.'); return; }
        const before = points;
        const moved = { ...points, [which]: latlng };
        archiveTurn();
        const current = nextJob();
        collected.current = {};
        setMessage(''); setAdjusting(null); setPointHover(null);
        setPoints(moved); setPhase('planning');
        setResult(null); setValues({}); setUnderstood(null); setExpand(null); setAsked(''); setThinking(null); setFailure('');
        setSelected(null); setPin(null); setHover(null); setChosen(null); setLocked(false); setHeat('off'); setScanKey(null);
        try {
            const planned = await DataService.RoutePlan({
                origin: { lat: moved.origin.lat, lon: moved.origin.lng },
                destination: { lat: moved.destination.lat, lon: moved.destination.lng },
            }, current.abort.signal);
            if (current.id !== job.current.id) return;
            setPlan(planned);
            setFocus({ key: `plan-${current.id}`, points: toLatLng([planned.shortest]) });
            setPhase('ready');
        } catch (error) {
            if (current.id !== job.current.id) return;
            setPoints(before);
            setPhase('ready');
            setMessage(error.status === 422 ? 'No route to that spot. Try another one.' : 'Could not plan a route. Please try again.');
        }
    }

    // The pointer over the start or the destination shows its "Adjust" button; it stays a moment so the pointer can reach it
    function hoverPoint(which, latlng) {
        clearTimeout(pointTimer.current);
        if (which) setPointHover({ which, latlng });
        else pointTimer.current = setTimeout(() => setPointHover(null), 320);
    }

    // The description of the ride: the cells around the route are scanned and coloured as predictions arrive, then the
    // routes grow in, the recommended one's card pops up, and the heatmap fades away
    async function planRoutes(description) {
        const kept = plan, from = points;
        if (asked || messages.length || failure) archiveTurn();
        const current = nextJob();
        collected.current = {};
        setSelected(null); setPin(null); setHover(null); setChosen(null); setLocked(false); setAdjusting(null);
        setAsked(description);
        setText('');
        setFailure('');
        setThinking({ start: Date.now(), end: null });
        setValues({}); setUnderstood(null); setExpand(null); setResult(null);
        setPhase('running');
        setHeat('scan');
        setScanKey(`scan-${current.id}`);
        // The conversation opens on the right: frame the route again so it stays clear of it
        setFocus({ key: `ask-${current.id}`, points: toLatLng([kept.shortest]) });
        setProgress({ done: 0, total: kept.cells.length });
        try {
            await DataService.RouteStream({
                origin: { lat: from.origin.lat, lon: from.origin.lng },
                destination: { lat: from.destination.lat, lon: from.destination.lng },
                text: description,
            }, (e) => {
                if (current.id !== job.current.id) return;
                if (e.type === 'start') setProgress({ done: 0, total: e.cells_total });
                else if (e.type === 'preference') setUnderstood(e);
                else if (e.type === 'expand') {
                    setExpand(e);
                    setProgress(p => ({ ...p, total: p.total + e.cells_added }));
                } else if (e.type === 'cells') {
                    collected.current = { ...collected.current, ...Object.fromEntries(e.values) };
                    setValues(collected.current);
                    setProgress(p => ({ ...p, done: p.done + e.values.length }));
                } else if (e.type === 'result') {
                    const recommended = e.routes.find(r => r.kind === e.recommended) || e.routes[0];
                    setResult(e);
                    setSelected(recommended.kind);
                    setPin({ latlng: middleOf(recommended), delay: 900 });
                    setFocus({ key: `result-${current.id}`, points: toLatLng(e.routes) });
                    setThinking(t => ({ ...t, end: Date.now() }));
                    setPhase('done');
                    setHeat('settle');
                }
            }, current.abort.signal);
        } catch (error) {
            if (current.id !== job.current.id) return;
            setPhase('ready');
            setHeat('hidden');
            setThinking(t => (t ? { ...t, end: Date.now() } : t));
            setFailure(error.message || 'Something went wrong. Please try again.');
            setText(description);
        }
    }

    // A question for the assistant, answered in the conversation on the right
    async function ask(question, retryId) {
        const id = rideRef.current;
        setText('');
        setPending(true);
        setMessages(list => (retryId ? list.filter(m => m.id !== retryId) : [...list, { id: uid(), role: 'user', text: question }]));
        try {
            const reply = await DataService.RagChat(question);
            if (rideRef.current !== id) return;
            if (typeof reply.answer !== 'string' || !reply.answer.trim()) throw new Error('No answer came back. Please try again.');
            setMessages(list => [...list, { id: uid(), role: 'assistant', text: reply.answer, question, sources: Array.isArray(reply.sources) ? reply.sources : [] }]);
        } catch (error) {
            if (rideRef.current !== id) return;
            setMessages(list => [...list, { id: uid(), role: 'assistant', error: true, text: error.message || 'Could not connect. Please try again.', question }]);
        } finally {
            if (rideRef.current === id) setPending(false);
        }
    }

    function submit(event) {
        event.preventDefault();
        const sent = text.trim();
        if (!sent || phase === 'planning' || phase === 'running' || pending || adjusting) return;
        setConvoHidden(false);
        // Before the points are set, the words wait for them; with a route but nothing locked or chosen, they describe
        // the ride again for the same points; once a route is locked or chosen, they are questions about it
        if (phase === 'idle' && !points.destination) { setPendingAsk(sent); setText(''); }
        else if (plan && (phase === 'ready' || phase === 'done') && !talking) planRoutes(sent);
        else ask(sent);
    }

    // Quote a piece of the conversation in the message box, Markdown style, and put the cursor after it
    function quote(passage) {
        const lines = passage.trim().split('\n').filter(Boolean).slice(0, 6).map(line => `> ${line}`);
        if (!lines.length) return;
        setText(current => `${lines.join('\n')}\n\n${current}`);
        requestAnimationFrame(() => {
            const el = composerInput.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        });
    }

    function selectRoute(kind, latlng) {
        if (locked && kind !== selected) return;
        const route = result?.routes.find(r => r.kind === kind);
        if (!route) return;
        setSelected(kind);
        setPin({ latlng: latlng || middleOf(route), delay: 0 });
    }

    const routes = useMemo(() => result?.routes ?? (plan ? [plan.shortest] : []), [result, plan]);
    const scan = useMemo(() => (scanKey && plan
        ? { key: scanKey, cells: plan.cells, route: plan.shortest.geometry.coordinates.map(([lon, lat]) => [lat, lon]) }
        : null), [scanKey, plan]);
    const hasValues = useMemo(() => Object.keys(values).length > 0, [values]);
    const hasConvo = !!asked || messages.length > 0 || !!failure || !!pendingAsk || history.length > 0;
    const convoOpen = hasConvo && !convoHidden;
    const hint = message
        || (adjusting ? `Tap the map to move the ${adjusting === 'origin' ? 'start' : 'destination'} · Esc to cancel`
        : phase === 'idle' ? (points.origin ? 'Tap the map to set the destination' : 'Tap the map to set the start')
            : phase === 'planning' ? 'Finding the shortest route…'
                : phase === 'ready' && !asked ? `Shortest route ${(plan.shortest.distance_m / 1000).toFixed(1)} km. Now describe your ride` : '');
    const placeholder = pendingAsk ? (points.origin ? 'Tap the destination on the map…' : 'Tap the start on the map…')
        : phase === 'planning' ? 'Finding the shortest route…'
        : phase === 'running' ? 'Working on your routes…'
            : talking ? `Ask for advice on the ${ROUTE_LABELS[chosen || selected] || 'chosen'} route…`
                : phase === 'ready' && !asked ? 'Describe the ride you want'
                    : phase === 'done' ? 'Describe a different ride for these two points…'
                        : 'Describe the ride you want, then tap the start and the destination';
    const canSend = !!text.trim() && phase !== 'planning' && phase !== 'running' && !pending && !adjusting;
    const legendOn = hasValues && (heat === 'scan' || heat === 'settle' || heat === 'shown');
    const heatToggle = phase === 'done' && hasValues && (heat === 'hidden' || heat === 'shown');
    // Pixels the panels cover, so the map frames the routes in the open part
    const inset = narrow
        ? { top: 130, right: 16, bottom: convoOpen ? window.innerHeight * 0.48 : 120, left: 16 }
        : { top: 72, right: 16, bottom: 120, left: (sideOpen ? sideWidth : SIDE_RAIL) + (convoOpen ? PANEL_GAP + panelW : 0) + 16 };

    // The cards over the route lines: the pinned one, and the one under the pointer
    const routeCards = project => !adjusting && result && result.routes.map(r => {
        if (locked && r.kind !== selected) return null;
        const pinned = r.kind === selected && !!pin;
        const hovered = hover?.kind === r.kind;
        const anchor = pinned ? pin.latlng : hovered ? hover.latlng : null;
        return (
            <RouteInfo key={r.kind} route={r} show={pinned || hovered} point={anchor && project(anchor)} pinned={pinned}
                delay={pinned ? pin.delay : 0} chosen={chosen === r.kind} locked={locked && r.kind === selected}
                onChoose={() => setChosen(c => (c === r.kind ? null : r.kind))} onLock={() => setLocked(l => !l)} />
        );
    });

    return (
        <main ref={appRef} className="app" data-view={view} data-side={sidebarOpen === null ? 'auto' : sideOpen ? 'open' : 'closed'} data-convo={convoOpen ? 'open' : 'closed'}
            data-tone={basemap === 'satellite' ? 'dark' : 'light'} data-resizing={resizing || undefined} data-adjusting={adjusting || undefined} style={{ '--side-w': `${sideWidth}px` }}>
            <div className="map-area">
                <HexMap scan={scan} values={values} heat={heat} colors={scale.color} onHeatSettled={() => setHeat(h => (h === 'settle' ? 'hidden' : h))}
                    points={points} onPick={pickPoint} routes={routes} selected={selected ?? 'shortest'} chosen={chosen} locked={locked}
                    onRouteHover={(kind, latlng) => setHover(kind ? { kind, latlng } : null)} onRouteSelect={selectRoute}
                    adjustable={!!points.destination && (phase === 'ready' || phase === 'done') && !adjusting} onPointHover={hoverPoint} faded={!!adjusting || phase === 'planning'}
                    basemap={basemap} labels={labels} mapColours={mapColours} area={AREA} focus={focus} inset={inset} overlay={project => (
                        <>
                            {routeCards(project)}
                            {pointHover && !adjusting && (
                                <PointMenu which={pointHover.which} point={project(pointHover.latlng)}
                                    onEnter={() => clearTimeout(pointTimer.current)} onLeave={() => hoverPoint(null)}
                                    onAdjust={() => { setAdjusting(pointHover.which); setPointHover(null); }} />
                            )}
                        </>
                    )} />

                {hint && (
                    <div key={`${phase}-${message ? 'm' : ''}`} className={message ? 'status warn' : 'status'} role="status">
                        {phase === 'planning' && <span className="spinner" />}{hint}
                    </div>
                )}

                <div className="map-controls">
                    <div className="segmented three" role="group" aria-label="Map style" data-pos={BASEMAP_NAMES.findIndex(([id]) => id === basemap)}>
                        <span className="segmented-thumb" aria-hidden="true" />
                        {BASEMAP_NAMES.map(([id, name]) => (
                            <button key={id} type="button" className={basemap === id ? 'on' : ''} aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{name}</button>
                        ))}
                    </div>
                    <button type="button" className={labels ? 'ctl-button on' : 'ctl-button'} aria-pressed={labels} onClick={() => setLabels(v => !v)}
                        title={labels ? 'Hide place names' : 'Show place names'}>
                        <Icon name="labels" size={18} />Place names
                    </button>
                    {heatToggle && (
                        <button type="button" className={heat === 'shown' ? 'ctl-button pop on' : 'ctl-button pop'}
                            aria-pressed={heat === 'shown'} onClick={() => setHeat(h => (h === 'shown' ? 'hidden' : 'shown'))}>
                            <Icon name="hex" size={18} />Heatmap
                        </button>
                    )}
                    <div className="legend" data-visible={legendOn} aria-hidden={!legendOn}>
                        <i style={{ background: scale.gradient }} />
                        <span>Poor match</span><span>Good match</span>
                    </div>
                </div>

                {hasConvo && convoHidden && (
                    <button type="button" className="ctl-button convo-tab pop" onClick={() => setConvoHidden(false)} aria-controls="conversation">
                        <Icon name="chat" size={18} />Conversation
                    </button>
                )}

                <div className="dock">
                    <Composer inputRef={composerInput} pulse={pulse} value={text} onChange={setText} onSubmit={submit} placeholder={placeholder} disabled={false}
                        canSend={canSend} running={busy} glow={glow} failed={!!message} />
                </div>
            </div>

            <HomeScreen open={view === 'home'} value={homeText} onChange={setHomeText} onStart={startFromHome} onExplore={() => setView('map')} />

            <ConversationPanel open={convoOpen} history={history} waiting={pendingAsk} asked={asked} phase={phase} plan={plan} understood={understood} progress={progress}
                expand={expand} result={result} selected={selected} chosen={chosen} locked={locked} thinking={thinking} failure={failure}
                messages={messages} pending={pending} onSelect={kind => selectRoute(kind)} onRetry={m => ask(m.question, m.id)}
                onRetryRoutes={phase === 'done' && plan ? () => planRoutes(asked) : null} onQuote={quote} onClose={() => setConvoHidden(true)} />

            <div className="side-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
            <div className="side-resizer" role="separator" aria-orientation="vertical" aria-label="Sidebar width" tabIndex={0}
                aria-valuemin={SIDE_RAIL} aria-valuemax={SIDE_MAX} aria-valuenow={sideOpen ? sideWidth : SIDE_RAIL}
                onPointerDown={startResize} onKeyDown={resizeByKey} onDoubleClick={() => { setSidebarOpen(true); setSideWidth(SIDE_DEFAULT); }}
                title="Drag to resize · double-click to reset" />
            <Sidebar open={sideOpen} onToggle={() => setSidebarOpen(!sideOpen)} rides={rides} currentId={rideId}
                onRestore={ride => (ride.id === rideId ? setConvoHidden(false) : restore(ride))} onNewRide={newRide}
                basemap={basemap} setBasemap={setBasemap} labels={labels} setLabels={setLabels}
                scheme={scheme} setScheme={setScheme} gradient={scale.gradient} mapColours={mapColours} setMapColours={setMapColours}
                onClearRides={() => setRides([])} onHome={goHome} />
            <button type="button" className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open rides" aria-controls="sidebar">
                <Icon name="sidebar" />
            </button>

            {/* The "goo" filter behind the route card's liquid buttons: blur the shapes, then sharpen the alpha again */}
            <svg className="svg-defs" width="0" height="0" aria-hidden="true" focusable="false">
                <defs>
                    <filter id="goo">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
                        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7.5" />
                    </filter>
                </defs>
            </svg>
        </main>
    );
}
