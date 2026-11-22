// Small line icons in the spirit of SF Symbols: 20 x 20, drawn with the current text colour.
const PATHS = {
    sidebar: <><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="3" /><path d="M8 4v12" /></>,
    compose: <><path d="M9.5 4.25H6.5a2.75 2.75 0 0 0-2.75 2.75v6.5A2.75 2.75 0 0 0 6.5 16.25H13a2.75 2.75 0 0 0 2.75-2.75v-3" /><path d="m8.75 11.25.4-2.1 6.1-6.1a1.2 1.2 0 0 1 1.7 1.7l-6.1 6.1-2.1.4Z" /></>,
    arrowUp: <path d="M10 15.5v-11M5.25 9 10 4.25 14.75 9" />,
    hex: <><path d="m10 2.75 6.25 3.6v7.3L10 17.25l-6.25-3.6v-7.3Z" /><path d="m10 7.25 2.4 1.38v2.74L10 12.75l-2.4-1.38V8.63Z" /></>,
    labels: <><path d="M3.75 15.25 7.5 4.75h.5l3.75 10.5" /><path d="M5.1 11.5h5.3" /><path d="M13.25 9.5c.5-.6 1.2-.9 2-.9 1.3 0 2 .8 2 2v4.65" /><path d="M17.25 12.25h-1.9c-1.2 0-2.1.6-2.1 1.55 0 .9.7 1.5 1.7 1.5 1.3 0 2.3-.9 2.3-2.3" /></>,
    lock: <><rect x="4.75" y="8.75" width="10.5" height="8" rx="2.25" /><path d="M7 8.75V6.5a3 3 0 0 1 6 0v2.25" /></>,
    check: <path d="m4.75 10.5 3.5 3.5 7-8" />,
    gear: <><circle cx="10" cy="10" r="2.5" /><path d="M10 2.75v1.6M10 15.65v1.6M17.25 10h-1.6M4.35 10h-1.6M15.13 4.87l-1.13 1.13M6 14l-1.13 1.13M15.13 15.13 14 14M6 6 4.87 4.87" /></>,
    chevron: <path d="m7.5 5 5 5-5 5" />,
    close: <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />,
    enter: <><path d="M15.75 4.5v5.25a2.5 2.5 0 0 1-2.5 2.5H4.75" /><path d="m8.25 8.75-3.5 3.5 3.5 3.5" /></>,
    copy: <><rect x="7.25" y="7.25" width="9" height="9" rx="2" /><path d="M12.75 7.25V5.5a1.75 1.75 0 0 0-1.75-1.75H5.5A1.75 1.75 0 0 0 3.75 5.5V11a1.75 1.75 0 0 0 1.75 1.75h1.75" /></>,
    quote: <><path d="M4.25 9.25c0-2.2 1.2-3.75 3-4.5M4.25 9.25v3.5h3.5v-3.5Z" /><path d="M11.25 9.25c0-2.2 1.2-3.75 3-4.5M11.25 9.25v3.5h3.5v-3.5Z" /></>,
    retry: <><path d="M15.25 10a5.25 5.25 0 1 1-1.54-3.71" /><path d="M15.5 3.75v3h-3" /></>,
    chat: <path d="M10 3.75c-3.6 0-6.25 2.3-6.25 5.2 0 1.6.8 3 2.1 3.95l-.5 2.6 2.9-1.45c.55.1 1.15.15 1.75.15 3.6 0 6.25-2.3 6.25-5.25S13.6 3.75 10 3.75Z" />,
    move: <><circle cx="10" cy="10" r="2" /><path d="M10 2.75v3.5M10 13.75v3.5M2.75 10h3.5M13.75 10h3.5" /><circle cx="10" cy="10" r="5.75" /></>,
    wheel: <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="1.6" /><path d="M10 3v5.4M10 11.6V17M3.94 6.5l4.67 2.7M11.39 10.8l4.67 2.7M3.94 13.5l4.67-2.7M11.39 9.2l4.67-2.7" /></>,
    bike: <><circle cx="5.25" cy="13" r="3" /><circle cx="14.75" cy="13" r="3" /><path d="M5.25 13 8.5 7.5h4.25l2 5.5M8.5 7.5 10.5 13h-5.25M11.25 5.25h2" /></>,
};

export function Icon({ name, size = 20 }) {
    return (
        <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            {PATHS[name]}
        </svg>
    );
}
