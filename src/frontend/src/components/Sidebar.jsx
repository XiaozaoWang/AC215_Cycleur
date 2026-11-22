'use client';
// The left sidebar, full height and solid white like a chat app's: start a new ride, open an earlier ride (each ride
// is one conversation), and settings. Collapsed, it narrows to a rail of icons.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import Wordmark from './Wordmark';
import { DEFAULT_MAP_COLOURS, MAP_COLOURS } from './mapStyle';

function Switch({ checked, onChange, label, disabled }) {
    return (
        <button type="button" role="switch" aria-checked={checked} className="switch" disabled={disabled} onClick={() => onChange(!checked)}
            title={disabled ? 'Names are part of this map' : undefined}>
            <span>{label}</span><i aria-hidden="true" />
        </button>
    );
}

const SCHEME_NAMES = [['aurora', 'Aurora'], ['viridis', 'Viridis'], ['custom', 'Custom']];
const STOP_NAMES = [['poor', 'Poor'], ['middle', 'Middle'], ['good', 'Good']];

function Settings({ basemap, setBasemap, labels, setLabels, scheme, setScheme, gradient, mapColours, setMapColours, rideCount, onClear, onClose }) {
    const [confirm, setConfirm] = useState(false);
    const [palette, setPalette] = useState(false);
    const box = useRef(null);
    useEffect(() => {
        const away = e => { if (!box.current?.contains(e.target) && !e.target.closest?.('[data-settings-trigger]')) onClose(); };
        const key = e => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('pointerdown', away);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
    }, [onClose]);
    return (
        <div className="settings" ref={box} role="dialog" aria-label="Settings">
            <div className="settings-row">
                <span>Map</span>
                <div className="segmented small three" role="group" aria-label="Map style" data-pos={['satellite', 'street', 'plain'].indexOf(basemap)}>
                    <span className="segmented-thumb" aria-hidden="true" />
                    {[['satellite', 'Satellite'], ['street', 'Map'], ['plain', 'Plain']].map(([id, name]) => (
                        <button key={id} type="button" className={basemap === id ? 'on' : ''} aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{name}</button>
                    ))}
                </div>
            </div>
            <Switch checked={labels} onChange={setLabels} label="Place names" />
            <hr />
            <div className="settings-row">
                <span>Heatmap</span>
                <div className="segmented small three" role="group" aria-label="Heatmap colours" data-pos={SCHEME_NAMES.findIndex(([id]) => id === scheme.id)}>
                    <span className="segmented-thumb" aria-hidden="true" />
                    {SCHEME_NAMES.map(([id, name]) => (
                        <button key={id} type="button" className={scheme.id === id ? 'on' : ''} aria-pressed={scheme.id === id}
                            onClick={() => setScheme(current => ({ ...current, id }))}>{name}</button>
                    ))}
                </div>
            </div>
            <div className="settings-scale">
                <i style={{ background: gradient }} aria-hidden="true" />
                {scheme.id === 'custom' ? (
                    <div className="colour-picks">
                        {STOP_NAMES.map(([key, name]) => (
                            <label key={key} className="colour-pick">
                                <input type="color" value={scheme.custom[key]} aria-label={`${name} match colour`}
                                    onChange={e => setScheme(current => ({ ...current, custom: { ...current.custom, [key]: e.target.value } }))} />
                                <span>{name}</span>
                            </label>
                        ))}
                    </div>
                ) : <div className="scale-ends"><span>Poor match</span><span>Good match</span></div>}
            </div>
            <hr />
            <button type="button" className="settings-disclosure" aria-expanded={palette} onClick={() => setPalette(p => !p)}>
                <span>Map colours</span><small>for the Map style</small><Icon name="chevron" size={14} />
            </button>
            {palette && (
                <div className="map-colours">
                    {MAP_COLOURS.map(entry => (
                        <label key={entry.key} className="colour-pick">
                            <input type="color" value={mapColours[entry.key] || entry.value} aria-label={`${entry.name} colour`}
                                onChange={e => setMapColours(current => ({ ...current, [entry.key]: e.target.value }))} />
                            <span>{entry.name}</span>
                        </label>
                    ))}
                    <button type="button" className="text-button" onClick={() => setMapColours(DEFAULT_MAP_COLOURS)}>Reset to default</button>
                </div>
            )}
            <hr />
            <button type="button" className={confirm ? 'settings-danger armed' : 'settings-danger'} disabled={!rideCount}
                onClick={() => { if (confirm) { onClear(); setConfirm(false); } else setConfirm(true); }}>
                {confirm ? 'Click again to clear all rides' : 'Clear ride history'}
            </button>
        </div>
    );
}

export default function Sidebar({
    open, onToggle, rides, currentId, onRestore, onNewRide, basemap, setBasemap, labels, setLabels, scheme, setScheme, gradient,
    mapColours, setMapColours, onClearRides, onHome,
}) {
    const [settings, setSettings] = useState(false);
    return (
        <nav id="sidebar" className="sidebar" aria-label="Rides">
            <div className="side-top">
                <button type="button" className="side-brand" onClick={onHome} aria-label="Cycleur home" title="Home">
                    <Wordmark height={21} />
                </button>
                <button type="button" className="side-icon" onClick={onToggle} aria-expanded={open} aria-controls="sidebar"
                    aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'} title={open ? 'Collapse sidebar' : 'Expand sidebar'}>
                    <Icon name="sidebar" />
                </button>
            </div>
            {/* The wheel rolls as the sidebar opens and closes */}
            <button type="button" className="side-item side-new" onClick={onNewRide} title="New ride">
                <Icon name="wheel" /><span>New ride</span>
            </button>
            <div className="side-rides">
                {rides.length > 0 && <h3>Rides</h3>}
                <ul>
                    {rides.map(ride => (
                        <li key={ride.id}>
                            <button type="button" className={ride.id === currentId ? 'side-ride on' : 'side-ride'} aria-current={ride.id === currentId || undefined}
                                onClick={() => onRestore(ride)} title={ride.text}>
                                <span>{ride.text}</span><Icon name="chevron" size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="side-bottom">
                <button type="button" className="side-item" data-settings-trigger aria-expanded={settings} onClick={() => setSettings(s => !s)} title="Settings">
                    <Icon name="gear" /><span>Settings</span>
                </button>
                {settings && (
                    <Settings basemap={basemap} setBasemap={setBasemap} labels={labels} setLabels={setLabels}
                        scheme={scheme} setScheme={setScheme} gradient={gradient} mapColours={mapColours} setMapColours={setMapColours} rideCount={rides.length}
                        onClear={onClearRides} onClose={() => setSettings(false)} />
                )}
            </div>
        </nav>
    );
}
