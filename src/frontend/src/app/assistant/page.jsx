import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Old bookmarks: the assistant now answers in the conversation next to the map.
export default function Assistant() {
    redirect('/');
}
