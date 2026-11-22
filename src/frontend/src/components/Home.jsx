'use client';
// The home screen: a soft white landscape flying down a winding river of light (HomeLandscape), the logo, a question,
// and the message box.
// Describing a ride here opens the map; once the start and the destination are tapped, the routes are planned for it.
import Composer from './Composer';
import HomeLandscape from './HomeLandscape';
import { Icon } from './icons';
import Wordmark from './Wordmark';

const IDEAS = ['Quiet streets under big trees', 'Along the water, away from traffic', 'Wide, calm roads through parks'];

export default function Home({ open, value, onChange, onStart, onExplore }) {
    function submit(event) {
        event.preventDefault();
        if (value.trim()) onStart(value.trim());
    }
    return (
        <section className="home" data-open={open} aria-label="Start a ride" inert={!open || undefined}>
            <HomeLandscape running={open} />
            <div className="home-center">
                <Wordmark height={40} />
                <h1>What <span>scenery</span> would you like to see?</h1>
                <Composer value={value} onChange={onChange} onSubmit={submit} placeholder="Describe the ride you want…"
                    disabled={false} canSend={!!value.trim()} running={false} glow="off" failed={false} />
                <div className="home-ideas">
                    {IDEAS.map(idea => <button key={idea} type="button" onClick={() => onStart(idea)}>{idea}</button>)}
                </div>
                <button type="button" className="home-explore" onClick={onExplore}>
                    Or open the map first <Icon name="chevron" size={14} />
                </button>
            </div>
        </section>
    );
}
