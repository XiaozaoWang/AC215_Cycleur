'use client';
// The conversation, in a floating panel next to the sidebar: plain text on frosted white, with no bubbles or boxes.
// It holds what you asked, the thinking while routes are planned (collapsible, like a reasoning trace), the result in
// words, and the follow-up questions and answers. New lines rise in with a spring. Under each message, a row of small
// actions (copy, quote into the message box, retry), shown on hover and always on the latest reply.
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Icon } from './icons';
import { ROUTE_COLORS, ROUTE_LABELS } from './palette';

const pretty = name => name.replace(/_/g, ' ');
const pct = value => `${Math.round(value * 100)}%`;
const km = metres => `${(metres / 1000).toFixed(1)} km`;
const signed = value => `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;

function list(parts) {
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

// What Gemini understood, in words: "more tree canopy, less traffic"
function wishes(weights) {
    return list([...weights].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 4)
        .map(w => `${w.weight > 0 ? 'more' : 'less'} ${pretty(w.dimension)}`));
}

// The thinking steps so far, each with a stable key so a line keeps its place while its text updates
function thinkingSteps({ plan, understood, progress, expand, result, running }) {
    const steps = [];
    if (plan) steps.push({ key: 'plan', text: `Found the shortest route: ${km(plan.shortest.distance_m)} on bike-friendly roads, with ${plan.cells.length} places around it to look at.` });
    if (understood) {
        const weights = [...(understood.weights || [])].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
        steps.push({
            key: 'wish',
            text: weights.length ? `You want ${wishes(weights)}.` : 'No clear wish found in your words, so only the shortest route can be offered.',
            // What Gemini returned: a weight per quality (−1 avoid … +1 seek), how strongly the ride should follow them,
            // and any must-haves
            scores: weights.length ? [
                ...weights.map(w => [pretty(w.dimension), signed(w.weight)]),
                ...(understood.intensity !== undefined ? [['strength of the wish', understood.intensity.toFixed(2)]] : []),
                ...(understood.must_have?.length ? [['must have', understood.must_have.map(pretty).join(', ')]] : []),
            ] : null,
            note: understood.used_fallback ? 'Gemini was not reachable, so a simple keyword reader filled in.' : '',
        });
    } else if (running) steps.push({ key: 'wish', text: 'Reading your description…', live: true });
    if (understood && progress.total > 0) {
        const busy = running && progress.done < progress.total;
        steps.push({ key: 'scan', text: `Reading the satellite images of every place around the route: ${Math.min(progress.done, progress.total)} of ${progress.total}.`, live: busy });
    }
    if (expand) steps.push({ key: 'wider', text: `Looking further, allowing routes up to ${pct(expand.max_detour)} longer to find more options.` });
    if (result) steps.push({ key: 'compare', text: `Compared ${result.candidates.length} candidate routes and kept ${result.routes.length} that differ.` });
    else if (running && understood && progress.total > 0 && progress.done >= progress.total) steps.push({ key: 'compare', text: 'Weighing length against how well each road fits…', live: true });
    return steps;
}

// The result of a turn in a few lines of text: kept in the history when the ride is described again
export function resultSummary(result) {
    const shortest = result.routes.find(r => r.kind === 'shortest');
    const best = result.routes.find(r => r.kind === result.recommended) || shortest;
    return [
        `I found ${result.routes.length} route${result.routes.length > 1 ? 's' : ''}. ${ROUTE_LABELS[best.kind]}: ${km(best.distance_m)}, ${pct(best.match)} match${best.kind !== 'shortest' ? ` (shortest ${km(shortest.distance_m)}, ${pct(shortest.match)})` : ''}.`,
        ...result.routes.map(r => `- ${ROUTE_LABELS[r.kind]}: ${km(r.distance_m)}${r.kind !== 'shortest' ? `, +${pct(r.detour)}` : ''}, ${pct(r.match)} match`),
    ].join('\n');
}

// Copy / quote / retry under a message
function Actions({ text, onQuote, onRetry, retryLabel = 'Retry', always }) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return undefined;
        const t = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(t);
    }, [copied]);
    async function copy() {
        try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked */ }
    }
    return (
        <div className={always ? 'msg-actions always' : 'msg-actions'}>
            <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy'} title={copied ? 'Copied' : 'Copy'}>
                <Icon name={copied ? 'check' : 'copy'} size={15} />
            </button>
            {onQuote && (
                <button type="button" onClick={() => onQuote(text)} aria-label="Quote in your message" title="Quote">
                    <Icon name="quote" size={15} />
                </button>
            )}
            {onRetry && (
                <button type="button" onClick={onRetry} aria-label={retryLabel} title={retryLabel}>
                    <Icon name="retry" size={15} />
                </button>
            )}
        </div>
    );
}

function Thinking({ running, steps, seconds }) {
    const [open, setOpen] = useState(true);
    useEffect(() => { setOpen(running); }, [running]);
    return (
        <section className="think rise">
            <button type="button" className="think-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
                {running ? <span className="shimmer">Thinking</span> : <span>Thought for {seconds}s</span>}
                <Icon name="chevron" size={14} />
            </button>
            <div className="think-body" data-open={open}>
                <ol>
                    {steps.map(step => (
                        <li key={step.key} className="rise">
                            <span className={step.live ? 'shimmer' : undefined}>{step.text}</span>
                            {step.scores && (
                                <dl className="scores">
                                    {step.scores.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
                                </dl>
                            )}
                            {step.note && <small>{step.note}</small>}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
}

// The result in words: how many routes, why the selected one, and the options as a short list
function Result({ result, selected, chosen, locked, onSelect, onQuote, onRetry, latest }) {
    const shortest = result.routes.find(r => r.kind === 'shortest');
    const route = result.routes.find(r => r.kind === selected) || shortest;
    const name = ROUTE_LABELS[route.kind];
    const noBetter = result.weights.length > 0 && !result.improved;
    let i = 0;
    const rise = () => ({ '--i': i++ });

    let summary;
    if (route.kind === 'shortest') summary = `The shortest route matches your ride ${pct(route.match)}.`;
    else if (route.alternative) summary = `The ${name} route takes different streets: ${km(route.distance_m - shortest.distance_m)} longer, ${pct(route.match)} match.`;
    else summary = `The ${name} route adds ${km(route.distance_m - shortest.distance_m)} (${pct(route.detour)}) and raises the match from ${pct(shortest.match)} to ${pct(route.match)}.`;

    const compared = route.kind === 'shortest' ? [] : [...result.weights]
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 3)
        .filter(w => shortest.profile?.[w.dimension] !== undefined && route.profile?.[w.dimension] !== undefined)
        .map(w => {
            const a = shortest.profile[w.dimension], b = route.profile[w.dimension];
            const way = b > a + 0.01 ? 'more' : b < a - 0.01 ? 'less' : 'about the same';
            return `${way} ${pretty(w.dimension)} (${a.toFixed(2)} → ${b.toFixed(2)})`;
        });

    const lead = `I found ${result.routes.length} route${result.routes.length > 1 ? 's' : ''}. ${summary}`;
    const plain = [
        lead,
        compared.length ? `Compared with the shortest route it has ${list(compared)}.` : '',
        ...result.routes.map(r => `${ROUTE_LABELS[r.kind]}: ${km(r.distance_m)}${r.kind !== 'shortest' ? `, +${pct(r.detour)}` : ''}, ${pct(r.match)} match`),
    ].filter(Boolean).join('\n');

    return (
        <section className="result msg">
            <p className="rise" style={rise()}>{lead}</p>
            {compared.length > 0 && <p className="rise" style={rise()}>Compared with the shortest route it has {list(compared)}.</p>}
            {noBetter && (
                <p className="rise" style={rise()}>
                    No route within {pct(result.max_detour)} extra length fits your ride better than the shortest one, so the others are simply different streets.
                </p>
            )}
            <ul className="route-list rise" style={rise()}>
                {result.routes.map(r => (
                    <li key={r.kind}>
                        <button type="button" aria-pressed={r.kind === selected} onClick={() => onSelect(r.kind)}>
                            <span className={r.kind === 'shortest' ? 'route-name dashed' : 'route-name'} style={{ '--c': ROUTE_COLORS[r.kind] }}>{ROUTE_LABELS[r.kind]}</span>
                            <span>{km(r.distance_m)}{r.kind !== 'shortest' && ` · +${pct(r.detour)}`} · {pct(r.match)} match</span>
                        </button>
                    </li>
                ))}
            </ul>
            <p className="note rise" style={rise()}>
                {chosen
                    ? `You chose the ${ROUTE_LABELS[chosen]} route, so I will keep the conversation on it.${locked ? ' It is locked: the other routes are hidden.' : ''}`
                    : 'Hover a route on the map to see its details. Click it to pin the card, then choose it with ✓ and I will focus on it.'}
            </p>
            <Actions text={plain} onQuote={onQuote} onRetry={onRetry} retryLabel="Plan the routes again" always={latest} />
        </section>
    );
}

function safeUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
}

function Sources({ sources = [] }) {
    const unique = sources.filter((s, i) => sources.findIndex(o =>
        (o.metadata?.source_id || o.metadata?.source_url || o.chunk_id) === (s.metadata?.source_id || s.metadata?.source_url || s.chunk_id)) === i);
    if (!unique.length) return null;
    return (
        <details className="sources">
            <summary>Sources · {unique.length}</summary>
            <ul>
                {unique.map((s, i) => {
                    const meta = s.metadata || {};
                    const href = safeUrl(meta.source_url);
                    const title = meta.title || meta.publisher || 'Cycling reference';
                    return (
                        <li key={s.chunk_id || i}>
                            {href ? <a href={href} target="_blank" rel="noopener noreferrer">{title}</a> : <span>{title}</span>}
                            {meta.publisher && <small> · {meta.publisher}</small>}
                        </li>
                    );
                })}
            </ul>
        </details>
    );
}

function Message({ message, onRetry, onQuote, pending, latest }) {
    if (message.role === 'user') {
        return (
            <div className="msg msg-user">
                <p className="ask rise">{message.text}</p>
                <Actions text={message.text} onQuote={onQuote} />
            </div>
        );
    }
    if (message.error) {
        return (
            <p className="answer error rise" role="alert">
                {message.text}{onRetry && message.question && <> <button type="button" className="text-button" disabled={pending} onClick={() => onRetry(message)}>Try again</button></>}
            </p>
        );
    }
    return (
        <div className="answer msg">
            <div className="md">
                <ReactMarkdown skipHtml components={{
                    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                    img: () => null,
                }}>{message.text}</ReactMarkdown>
            </div>
            <Sources sources={message.sources} />
            <Actions text={message.text} onQuote={onQuote} onRetry={!pending && message.question ? () => onRetry(message) : null} always={latest} />
        </div>
    );
}

export default function ConversationPanel({
    open, history = [], waiting, asked, phase, plan, understood, progress, expand, result, selected, chosen, locked, thinking, failure,
    messages, pending, onSelect, onRetry, onRetryRoutes, onQuote, onClose,
}) {
    const scroll = useRef(null);
    const running = phase === 'running';
    const steps = thinkingSteps({ plan, understood, progress, expand, result, running });
    const seconds = thinking?.end ? Math.max(1, Math.round((thinking.end - thinking.start) / 1000)) : 0;

    // Keep the newest line in view
    useEffect(() => {
        const el = scroll.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, [messages.length, pending, !!result, steps.length, open]);

    return (
        <aside id="conversation" className="convo" data-open={open} aria-label="Conversation" inert={!open || undefined}>
            <button type="button" className="convo-close" onClick={onClose} aria-label="Hide the conversation" title="Hide">
                <Icon name="close" size={16} />
            </button>
            <div className="convo-scroll" ref={scroll}>
                <div className="convo-text" role="log" aria-live="polite" aria-relevant="additions">
                    {history.map(m => <Message key={m.id} message={m} onQuote={onQuote} pending={pending} />)}
                    {history.length > 0 && (asked || waiting || messages.length > 0) && <hr className="turn-break" />}
                    {waiting && !asked && (
                        <>
                            <div className="msg msg-user"><p className="ask rise">{waiting}</p></div>
                            <p className="note rise">Tap the start and the destination on the map, and I will plan this ride.</p>
                        </>
                    )}
                    {asked && (
                        <div className="msg msg-user">
                            <p className="ask rise">{asked}</p>
                            <Actions text={asked} onQuote={onQuote} />
                        </div>
                    )}
                    {asked && <Thinking running={running} steps={steps} seconds={seconds} />}
                    {failure && <p className="answer error rise" role="alert">{failure}</p>}
                    {result && <Result result={result} selected={selected} chosen={chosen} locked={locked} onSelect={onSelect}
                        onQuote={onQuote} onRetry={running ? null : onRetryRoutes} latest={!messages.length && !pending} />}
                    {messages.map((m, i) => (
                        <Message key={m.id} message={m} onRetry={onRetry} onQuote={onQuote} pending={pending}
                            latest={i === messages.length - 1 && m.role === 'assistant' && !pending} />
                    ))}
                    {pending && <p className="answer shimmer rise" role="status">Finding guidance…</p>}
                </div>
            </div>
        </aside>
    );
}
