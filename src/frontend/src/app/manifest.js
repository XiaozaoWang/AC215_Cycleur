// Web app manifest: lets phones install Cycleur to the home screen and open it full screen, without the browser bar.
// Next.js serves it at /manifest.webmanifest and links it from every page.
export default function manifest() {
    return {
        name: 'Cycleur',
        short_name: 'Cycleur',
        description: 'Scenic cycling routes for the views you want',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1b4332',
        icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
    };
}
