'use client';
// The card that floats above a route line: its name, length and match. Hovering a line shows it; clicking pins it.
// On a pinned card, two round buttons flow out of its right end like drops of liquid (the shapes sit under an SVG
// "goo" filter that blurs them and sharpens the alpha again, so they merge while close and pull apart as they move):
// a lock (only this route stays on the map) and a check (choose this route; the conversation follows it).
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { ROUTE_COLORS, ROUTE_LABELS } from './palette';

const EXIT_MS = 200;

// show: whether the card should be visible; point: {x, y} pixels of the anchor on the line (kept while it leaves);
// pinned: clicked (the actions are available); delay: ms before it appears (lets the routes grow first).
export default function RouteInfo({ route, show, point, pinned, chosen, locked, delay = 0, onChoose, onLock }) {
    const [mounted, setMounted] = useState(show);
    const [open, setOpen] = useState(false);            // actions out (hover with a mouse, tap on touch)
    const last = useRef(point);
    if (point) last.current = point;

    useEffect(() => {
        if (show) { setMounted(true); return undefined; }
        setOpen(false);
        const t = setTimeout(() => setMounted(false), EXIT_MS);
        return () => clearTimeout(t);
    }, [show]);
    useEffect(() => { if (!pinned) setOpen(false); }, [pinned]);

    if (!mounted || !last.current) return null;
    const { x, y } = last.current;
    const name = ROUTE_LABELS[route.kind];
    const cls = ['route-info', show ? 'in' : 'out', pinned && 'pinned', open && 'open'].filter(Boolean).join(' ');

    return (
        <div className={cls} style={{ transform: `translate(${x}px, ${y}px)`, '--c': ROUTE_COLORS[route.kind], '--delay': `${delay}ms` }}>
            <span className="ri-anchor" aria-hidden="true" />
            <div className="ri-pop">
                <div className="ri-body"
                    onMouseEnter={() => pinned && setOpen(true)}
                    onMouseLeave={() => setOpen(false)}
                    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
                    onPointerUp={e => { if (pinned && e.pointerType !== 'mouse' && e.target === e.currentTarget) setOpen(o => !o); }}>
                    <div className="ri-shadow" aria-hidden="true">
                        <div className="ri-goo">
                            <span className="ri-blob ri-pill" />
                            <span className="ri-blob ri-dot one" />
                            <span className="ri-blob ri-dot two" />
                        </div>
                    </div>
                    <span className="ri-label">
                        <i className="ri-swatch" />
                        <strong>{name}</strong>
                        <span className="ri-meta">{(route.distance_m / 1000).toFixed(1)} km{route.kind !== 'shortest' && ` · +${Math.round(route.detour * 100)}%`} · {Math.round(route.match * 100)}%</span>
                        {locked && <span className="ri-state" title="Locked"><Icon name="lock" size={14} /></span>}
                        {chosen && <span className="ri-state chosen" title="Chosen"><Icon name="check" size={14} /></span>}
                    </span>
                    {pinned && <>
                        <button type="button" className={locked ? 'ri-action one on' : 'ri-action one'}
                            aria-pressed={locked} aria-label={locked ? `Unlock the ${name} route` : `Lock the ${name} route`}
                            onClick={onLock} onFocus={() => setOpen(true)}>
                            <Icon name="lock" size={17} />
                        </button>
                        <button type="button" className={chosen ? 'ri-action two on' : 'ri-action two'}
                            aria-pressed={chosen} aria-label={chosen ? `Stop following the ${name} route` : `Choose the ${name} route`}
                            onClick={onChoose} onFocus={() => setOpen(true)}>
                            <Icon name="check" size={17} />
                        </button>
                    </>}
                </div>
            </div>
        </div>
    );
}
