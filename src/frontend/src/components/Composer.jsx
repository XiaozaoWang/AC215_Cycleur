'use client';
// The message box at the bottom, sized like the input of a chat app: grows with the text up to a few lines, Enter sends,
// Shift+Enter starts a new line. While the app is working, light runs around its edge: only the lit side glows, as if a
// light were passing by, with a soft halo behind it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';

// glow: off | on (calculating: the glow springs in and turns) | settle (done: one last swell, then it fades)
// inputRef: optional, lets the page focus the box (for example after quoting into it).
// pulse: a number; each time it changes the box ripples once, like a drop falling into water (a quick swell, a ring
// spreading out and a brief light), to say "this box now does something new".
export default function Composer({ inputRef, pulse = 0, value, onChange, onSubmit, placeholder, disabled, canSend, running, glow, failed }) {
    const own = useRef(null);
    const input = inputRef || own;
    const [rippling, setRippling] = useState(0);
    useEffect(() => {
        if (!pulse) return undefined;
        setRippling(pulse);
        const t = setTimeout(() => setRippling(0), 1100);
        return () => clearTimeout(t);
    }, [pulse]);

    // Grow with the text; an empty box is one line (Chrome counts a long placeholder in scrollHeight, which would
    // otherwise make the empty box taller)
    useLayoutEffect(() => {
        const el = input.current;
        el.style.height = 'auto';
        if (value) el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
    }, [value, input, placeholder]);

    return (
        <div className={['composer-shell', glow === 'on' && 'thinking', glow === 'settle' && 'settle', rippling && 'activate'].filter(Boolean).join(' ')}>
            {rippling ? <span key={rippling} className="ripple" aria-hidden="true" /> : null}
            <span className="glow glow-halo" aria-hidden="true" />
            <form className={failed ? 'composer failed' : 'composer'} onSubmit={onSubmit}>
                <textarea
                    ref={input}
                    rows={1}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            e.currentTarget.form.requestSubmit();
                        }
                    }}
                    placeholder={placeholder}
                    aria-label="Message"
                    disabled={disabled}
                />
                <button type="submit" className="send" aria-label="Send" disabled={!canSend}>
                    {running ? <span className="spinner" /> : <Icon name="enter" size={20} />}
                </button>
            </form>
            <span className="glow glow-rim" aria-hidden="true" />
        </div>
    );
}
