'use client';
// The home screen's background: a soft monochrome landscape, flying forever down a winding white river.
//
// It is a pre-rendered, seamlessly looping video (tools/landscape-video renders it): playing a video costs the browser
// almost nothing, while drawing the landscape live kept the GPU busy. It plays only while the home screen is open. With
// reduced motion, or where the browser will not autoplay (iOS Low Power Mode), the first frame stays as a still picture.
import { useEffect, useRef } from 'react';

export default function HomeLandscape({ running }) {
    const videoRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return undefined;
        const reduce = matchMedia('(prefers-reduced-motion: reduce)');
        const sync = () => {
            if (running && !reduce.matches) {
                video.muted = true;                     // autoplay is only allowed without sound
                video.play().catch(() => {});           // refused: the poster stays
            } else {
                video.pause();
            }
        };
        sync();
        reduce.addEventListener('change', sync);
        return () => reduce.removeEventListener('change', sync);
    }, [running]);

    return (
        <div className="home-art" aria-hidden="true">
            <video ref={videoRef} src="/home-landscape.mp4" poster="/home-landscape.jpg" muted loop playsInline preload="auto"
                disablePictureInPicture tabIndex={-1} />
        </div>
    );
}
