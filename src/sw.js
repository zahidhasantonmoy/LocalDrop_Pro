import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (url.pathname === '/share-target' && event.request.method === 'POST') {
        event.respondWith(
            (async () => {
                const formData = await event.request.formData();
                const files = formData.getAll('file'); // 'file' must match manifest name

                // Store files in Cache API
                const cache = await caches.open('share-target');
                await cache.put('shared-files', new Response(JSON.stringify(
                    files.map(f => ({
                        name: f.name,
                        type: f.type,
                        lastModified: f.lastModified,
                        size: f.size
                    }))
                )));

                // We can't easily store File objects in Cache API directly as Response bodies 
                // in a way that preserves them as Files for the client easily without some work.
                // Better approach: Store in IndexedDB.
                // For simplicity in this demo, let's try to just redirect and let the client know.
                // Actually, without IDB, passing large files is hard.
                // Let's use a simple IDB helper here or just Cache API with a specific key per file?

                // Let's use the Client.postMessage approach if the client is open? 
                // No, the client might not be open.

                // SIMPLIFIED APPROACH:
                // We will just redirect to root.
                // Real file sharing via PWA Share Target usually requires IndexedDB.
                // I'll implement a basic IDB store here.

                return Response.redirect('/?share=true', 303);
            })()
        );

        // Wait, we need to actually save the data!
        // Let's use a simple IDB script injected here or just assume we can't do large files easily 
        // without a library like idb-keyval.
        // I'll skip the complex IDB implementation for now and just handle the redirect 
        // to show the intent, as full file handling in SW is quite verbose.
        // OR, I can use the Cache API to store the FormData? No.

        // Let's try to use the Cache API to store the *Request*? No.

        // OK, I will implement a basic IDB open/put.
    }
});

// Basic IDB Helper for SW
const saveSharedFiles = async (files) => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('localdrop-share', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            db.createObjectStore('files');
        };
        request.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('files', 'readwrite');
            const store = tx.objectStore('files');
            store.put(files, 'shared');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    });
};

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname === '/share-target' && event.request.method === 'POST') {
        event.respondWith(
            (async () => {
                const formData = await event.request.formData();
                const files = formData.getAll('file');

                await saveSharedFiles(files);

                return Response.redirect('/?share=true', 303);
            })()
        );
    }
});
