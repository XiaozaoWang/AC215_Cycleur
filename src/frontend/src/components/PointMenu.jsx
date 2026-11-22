'use client';
// The button that pops up above the start or the destination when the pointer is over it: "Adjust start" / "Adjust end".
// Choosing it fades the routes; the next tap on the map moves that point and plans a new shortest route.
import { Icon } from './icons';

export default function PointMenu({ which, point, onAdjust, onEnter, onLeave }) {
    if (!point) return null;
    return (
        <div className="point-menu" style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
            <button type="button" className="point-menu-button" onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onAdjust}>
                <Icon name="move" size={15} />{which === 'origin' ? 'Adjust start' : 'Adjust end'}
            </button>
        </div>
    );
}
