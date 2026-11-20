import './global.css';

export const metadata = {
    title: 'Cycleur',
    description: 'Scenic cycling routes for the views you want',
    // Installed on an iPhone home screen: open full screen, with the app's own name and icon
    appleWebApp: { capable: true, title: 'Cycleur', statusBarStyle: 'black-translucent' },
    icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

// viewportFit: 'cover' lets the page run under the notch and the home indicator; global.css keeps controls clear of them
export const viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: '#1b4332',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
